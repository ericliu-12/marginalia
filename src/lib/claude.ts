import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { EnrichmentInput, EnrichmentModel } from "@/domain/enrichment";
import { MODELS } from "./models";

// Bump when SYSTEM or the output schema changes; per the Evals rule in CLAUDE.md, re-run the
// pipeline-tuning harness (19-book set) before committing a change.
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
const PRICE: Record<string, { input: number; output: number }> = { "claude-haiku-4-5-20251001": { input: 1, output: 5 } };

export function enrichmentPrompt(input: EnrichmentInput) {
  return [
    `Title: ${input.title}`,
    `Author: ${input.authors.join(", ") || "(unknown)"}`,
    `Description: ${input.description || "(none)"}`,
    `Subjects: ${input.subjects.join("; ") || "(none)"}`,
  ].join("\n");
}

export function claudeEnricher(client = new Anthropic()): EnrichmentModel {
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
      if (!res.parsed_output) throw new Error(`Unparsed Enrichment output (stop_reason=${res.stop_reason})`);
      const { input_tokens, output_tokens } = res.usage;
      const o = res.parsed_output;
      return {
        recognised: o.recognised,
        summary: o.summary,
        themes: o.themes,
        author: o.author.trim() || null,
        firstPublishedYear: o.first_published_year,
        inputTokens: input_tokens,
        outputTokens: output_tokens,
        costUsd: (input_tokens * price.input + output_tokens * price.output) / 1e6,
      };
    },
  };
}
