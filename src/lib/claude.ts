import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { NAME_MAX_WORDS, type ClusterNamer, type NamingInput } from "@/domain/clusters";
import type { ConnectionJudge, JudgeInput } from "@/domain/connections";
import type { EnrichmentInput, EnrichmentModel } from "@/domain/enrichment";
import type { PaidCall, SpendLog } from "@/domain/spend";
import { MODELS } from "./models";

// Bump when SYSTEM or the output schema changes; per the Evals rule in CLAUDE.md, run `pnpm eval`
// before committing a change.
export const ENRICHMENT_PROMPT_VERSION = "enrichment-v1";

// Ported from prototype/pipeline-tuning (01-enrich.mjs, p2), plus the author and year the model believes,
// which feed the deterministic cross-check.
export const ENRICHMENT_SYSTEM_PROMPT = `You write Enrichment for a personal reading app: a short summary and themes for one book.
- recognised: true only if you clearly recognise this specific book, the work itself and not an adaptation, study guide or similarly titled book, from the metadata provided or your own knowledge. If false, set summary to "" and themes to [].
- author: the author you believe wrote the book with this title, from your own knowledge. If you know the title as the work of a different author than the one given, report that author. "" if you do not recognise the book.
- first_published_year: the approximate year you believe the book was first published, or null if unsure.
- summary: 2-3 sentences on what the book is about and how it reads. Plain, specific, no marketing language.
- themes: 4-6 short phrases naming the book's central ideas and concerns.
- Do not name characters, and do not state plot events, unless you are confident they are correct for this book. Prefer describing premise, setting, form and ideas.
Only state what you are confident is true about this specific book.`;

const Output = z.object({
  recognised: z.boolean(),
  author: z.string(),
  first_published_year: z.number().int().nullable(),
  summary: z.string(),
  themes: z.array(z.string()),
});

// $ per 1M tokens, first-party list prices.
const PRICE: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

// What a reply cost at list price, reported to `spend` before the reply is used.
async function paidFor(spend: SpendLog | undefined, model: string, purpose: PaidCall["purpose"], usage: Anthropic.Usage) {
  const price = PRICE[model];
  const costUsd = (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1e6;
  await spend?.record({ provider: "anthropic", model, purpose, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd });
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costUsd };
}

export function enrichmentPrompt(input: EnrichmentInput) {
  return [
    `Title: ${input.title}`,
    `Author: ${input.authors.join(", ") || "(unknown)"}`,
    `Description: ${input.description || "(none)"}`,
    `Subjects: ${input.subjects.join("; ") || "(none)"}`,
  ].join("\n");
}

export function claudeEnricher(client = new Anthropic(), spend?: SpendLog): EnrichmentModel {
  const model = MODELS.enrichment;
  const price = PRICE[model];
  // Fail at startup, not after a paid call, when the model has no known price.
  if (!price) throw new Error(`No price recorded for ${model}; add it to PRICE in src/lib/claude.ts.`);
  return {
    model,
    promptVersion: ENRICHMENT_PROMPT_VERSION,
    async enrich(input) {
      const res = await client.messages.parse({
        model,
        max_tokens: 800,
        system: ENRICHMENT_SYSTEM_PROMPT,
        messages: [{ role: "user", content: enrichmentPrompt(input) }],
        output_config: { format: zodOutputFormat(Output) },
      });
      const paid = await paidFor(spend, model, "enrichment", res.usage);
      if (!res.parsed_output) throw new Error(`Unparsed Enrichment output (stop_reason=${res.stop_reason})`);
      const o = res.parsed_output;
      return {
        recognised: o.recognised,
        summary: o.summary,
        themes: o.themes,
        author: o.author.trim() || null,
        firstPublishedYear: o.first_published_year,
        ...paid,
      };
    },
  };
}

// Bump when JUDGE_SYSTEM_PROMPT, the input layout or the output schema changes; per the Evals rule in
// CLAUDE.md, run `pnpm eval` before committing a change.
export const JUDGE_PROMPT_VERSION = "judge-p2";

// Ported verbatim from prototype/pipeline-tuning (03-judge.mjs, p2). Static-first so prompt caching
// is a one-line change later.
export const JUDGE_SYSTEM_PROMPT = `You decide which of a reader's earlier-finished books connect to a book they have just finished, for a private reading journal. The reader will read your explanations, so they must be specific and true.

Connection types:
- thematic: the books share a central idea or concern.
- contrast: the books treat a similar subject in opposed or answering ways.
- context: the books share a setting, historical frame, influence, form, or author.
Choose the single strongest type for a pair.

Strength:
- strong: a reader would say "these belong together"; a specific shared idea, not just a shared topic.
- moderate: a real but narrower link.
- weak: borderline or superficial. Use only when you are unsure it is worth reporting.

Rules:
- Report only candidates with a real link. Omit the rest. An empty list is a valid answer. Report at most 8.
- explanation: one or two sentences addressed to the reader, grounded in the Enrichment and the reader's Notes.
- Describe the connection only. Both books are already read, so never recommend, suggest reading, or use phrasing such as "if you liked X, Y offers".
- You may quote the reader's own Notes. Quote verbatim, inside double quotation marks, and list the id of each Note you quoted in quoted_note_ids. Never put anything inside double quotation marks that is not copied exactly from a Note. Do not put book titles in quotation marks.
- Every time you quote a Note, name the book it was written about by title in the same sentence, for example: your note on Intermezzo, "...". Never write "this one", "that book" or "the other" for a quoted Note.
- A link that rests on the reader's Notes for both books is worth reporting even if it is only weak.
- Never claim the reader thought or felt something their Notes do not say. If a book has no Notes, rely on its Enrichment only and do not imply the reader said anything about it.
- If a book's Enrichment is unavailable, say little about its content; only link it through its Notes.
- Do not attribute character names or plot events to a book unless its Enrichment or the reader's Notes state them.`;

const JudgeOutput = z.object({
  connections: z.array(
    z.object({
      candidate_id: z.string(),
      type: z.enum(["thematic", "contrast", "context"]),
      strength: z.enum(["strong", "moderate", "weak"]),
      explanation: z.string(),
      quoted_note_ids: z.array(z.string()),
    }),
  ),
});

export function judgePrompt({ book, candidates }: JudgeInput) {
  const enrichment = (e: string | null) => e ?? "(unavailable)";
  const notes = (ns: { id: string; body: string }[]) => (ns.length ? ns.map((n) => `  [${n.id}] ${n.body}`).join("\n") : "  (no Notes)");
  const blocks = candidates.map(
    (c) => `[${c.id}] ${c.title} by ${c.authors.join(", ") || "(unknown)"}\n  Enrichment: ${enrichment(c.enrichment)}\n  Notes:\n${notes(c.notes)}`,
  );
  return `NEWLY FINISHED BOOK\n${book.title} by ${book.authors.join(", ") || "(unknown)"}\nEnrichment: ${enrichment(book.enrichment)}\nReader's Notes:\n${notes(book.notes)}\n\nEARLIER-FINISHED CANDIDATES\n${blocks.join("\n\n")}`;
}

export function claudeJudge(client = new Anthropic(), spend?: SpendLog): ConnectionJudge {
  const model = MODELS.judge;
  const price = PRICE[model];
  if (!price) throw new Error(`No price recorded for ${model}; add it to PRICE in src/lib/claude.ts.`);
  return {
    model,
    promptVersion: JUDGE_PROMPT_VERSION,
    async judge(input) {
      const res = await client.messages.parse({
        model,
        max_tokens: 8000,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: judgePrompt(input) }],
        output_config: { format: zodOutputFormat(JudgeOutput), effort: "medium" },
      });
      const paid = await paidFor(spend, model, "judge", res.usage);
      if (!res.parsed_output) throw new Error(`Unparsed judge output (stop_reason=${res.stop_reason})`);
      return {
        connections: res.parsed_output.connections.map((c) => ({
          candidateId: c.candidate_id,
          type: c.type,
          strength: c.strength,
          explanation: c.explanation,
          quotedNoteIds: c.quoted_note_ids,
        })),
        ...paid,
      };
    },
  };
}

// Bump when CLUSTER_NAMING_SYSTEM_PROMPT, the input layout or the output schema changes.
export const CLUSTER_NAMING_PROMPT_VERSION = "cluster-naming-v4";

export const CLUSTER_NAMING_SYSTEM_PROMPT = `You name a Cluster in a private reading journal: a group of books the reader has finished that their connections bind together. The reader sees the name as a label on their graph of books, and the description when they open it.

- name: at most ${NAME_MAX_WORDS} words, short and evocative, naming what holds these books together. Not a book title or author name, and not a generic word such as "books", "reads", "collection" or "cluster". No quotation marks.
- description: one or two sentences addressed to the reader on what these books share, specific to them. Describe what they share and stop there: do not draw conclusions, interpret what the books argue or where they lean, or say what they add up to. Never recommend or suggest reading.
- Ground both in the themes and connection explanations given. Do not claim the reader thought or felt anything.
- The connections were found by the app, not by the reader: never say the reader drew, made, chose or found them.
- State no fact about a book, such as its setting, plot or characters, that the themes and connection explanations do not support, even if you believe it to be true.
- When a previous name is given, keep it exactly if it still fits the books as they are now; change it only when the group's centre has moved.`;

const NamingOutput = z.object({ name: z.string(), description: z.string() });

export function clusterNamingPrompt({ previousName, books, connections }: NamingInput) {
  const bookLines = books.map((b) => `- ${b.title} by ${b.authors.join(", ") || "(unknown)"}; themes: ${b.themes.join("; ") || "(unavailable)"}`);
  const connectionLines = connections.map((c) => `- ${c.a} / ${c.b}: ${c.explanation}`);
  return [
    `PREVIOUS NAME: ${previousName ?? "(none, a new Cluster)"}`,
    "",
    `BOOKS\n${bookLines.join("\n")}`,
    "",
    `CONNECTIONS\n${connectionLines.join("\n") || "(none)"}`,
  ].join("\n");
}

export function claudeClusterNamer(client = new Anthropic(), spend?: SpendLog): ClusterNamer {
  const model = MODELS.clusterNaming;
  const price = PRICE[model];
  if (!price) throw new Error(`No price recorded for ${model}; add it to PRICE in src/lib/claude.ts.`);
  return {
    model,
    promptVersion: CLUSTER_NAMING_PROMPT_VERSION,
    async name(input) {
      const res = await client.messages.parse({
        model,
        max_tokens: 4000,
        system: CLUSTER_NAMING_SYSTEM_PROMPT,
        messages: [{ role: "user", content: clusterNamingPrompt(input) }],
        output_config: { format: zodOutputFormat(NamingOutput), effort: "low" },
      });
      const paid = await paidFor(spend, model, "cluster-naming", res.usage);
      if (!res.parsed_output) throw new Error(`Unparsed Cluster naming output (stop_reason=${res.stop_reason})`);
      return {
        ...res.parsed_output,
        ...paid,
      };
    },
  };
}
