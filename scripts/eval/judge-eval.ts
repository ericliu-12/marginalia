// Eval harness for the Connection judge (and the Enrichment it reads). Run it, and report its output,
// after any change to the Enrichment or judge prompts or the judge call settings (see CLAUDE.md).
//
//   pnpm eval
//
// Feeds the 19-book set (fixtures/books.json: the reader's real Finished Books, saved Enrichment and
// Notes) through the real pipeline in finish order: the Pipeline's jobs over the in-memory queue, real
// Claude judge, real Voyage. It runs in a scratch database that it creates and drops, never the dev DB. Costs about $0.20.
// Compares against fixtures/baseline.json (the p2 prompt, from prototype/pipeline-tuning).
import fs from "node:fs";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { seedUser } from "@/db/seed";
import { addBook } from "@/domain/add-book";
import type { JudgeInput, JudgeResult } from "@/domain/connections";
import type { Embedder } from "@/domain/embeddings";
import { enrichBook } from "@/domain/enrichment";
import { addNote } from "@/domain/notes";
import { createPipeline } from "@/domain/pipeline";
import type { OpenLibraryWork } from "@/domain/search";
import { claudeJudge } from "@/lib/claude";
import { memoryQueue } from "@/lib/memory-queue";
import { voyageEmbedder } from "@/lib/voyage";

type Fixture = {
  order: string[];
  books: { slug: string; title: string; author: string; enrichment: { recognised: boolean; summary: string; themes: string[] }; notes: string[] }[];
};
type Baseline = { connections: { book: string; other: string; type: string; strength: string; explanation: string }[] };

const dir = new URL("./", import.meta.url).pathname;
const fixture: Fixture = JSON.parse(fs.readFileSync(dir + "fixtures/books.json", "utf8"));
const baseline: Baseline = JSON.parse(fs.readFileSync(dir + "fixtures/baseline.json", "utf8"));
const books = Object.fromEntries(fixture.books.map((b) => [b.slug, b]));

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl || !["localhost", "127.0.0.1"].includes(new URL(adminUrl).hostname)) {
  throw new Error("pnpm eval only runs against a local DATABASE_URL (it creates and drops a scratch database).");
}
const SCRATCH = "marginalia_eval";
const admin = new Pool({ connectionString: adminUrl });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH}`);
const scratchUrl = new URL(adminUrl);
scratchUrl.pathname = `/${SCRATCH}`;
const { db, pool } = createDb(scratchUrl.toString());

try {
  await runMigrations(db);
  const user = await seedUser(db);

  // Voyage rate limits clear within minutes: retry rather than abort a paid run.
  const voyage = voyageEmbedder();
  const embedder: Embedder = {
    model: voyage.model,
    async embed(texts, inputType) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await voyage.embed(texts, inputType);
        } catch (err) {
          if (attempt >= 5) throw err;
          console.log("Voyage failed, retrying:", String(err).slice(0, 80));
          await new Promise((r) => setTimeout(r, 25_000));
        }
      }
    },
  };

  // Records every judge call: what it was shown and what it answered, before the pipeline's own filtering.
  const inner = claudeJudge();
  const raw: { slug: string; input: JudgeInput; result: JudgeResult }[] = [];
  let current = "";
  const judge = {
    model: inner.model,
    promptVersion: inner.promptVersion,
    async judge(input: JudgeInput) {
      const result = await inner.judge(input);
      raw.push({ slug: current, input, result });
      return result;
    },
  };

  // Each Book's jobs (its embeddings, then its Connections) are drained before the next Book is added.
  const jobs = memoryQueue(db);
  const pipeline = createPipeline(db, jobs);
  const unused = { model: "unused", promptVersion: "x", async enrich(): Promise<never> { throw new Error("Enrichment should already be seated"); } };
  // Cluster names are not under evaluation; every Cluster gets the same one, at no cost.
  const namer = { model: "unused", promptVersion: "x", async name() { return { name: "Unnamed", description: "Not named in the eval.", inputTokens: 0, outputTokens: 0, costUsd: 0 }; } };
  for (const slug of fixture.order) {
    const b = books[slug];
    const work: OpenLibraryWork = { workKey: `/works/${slug}`, title: b.title, authors: [b.author], firstPublishedYear: null, editionCount: 1, coverId: null, subjects: [] };
    const entry = await addBook(db, pipeline, user.id, work, "read");
    // Seat the saved Enrichment through the real Enrichment module (hashes included), so the job does not redo it.
    const saved = { model: "eval", promptVersion: "saved", async enrich() {
      return { ...b.enrichment, author: b.author, firstPublishedYear: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    } };
    await enrichBook(db, { model: saved }, entry.bookId);
    for (const body of b.notes) await addNote(db, pipeline, user.id, entry.bookId, { body });
    current = slug;
    await jobs.drain({ model: unused, judge, embedder, descriptions: null, namer });
    console.log(`${b.title}: ${raw.filter((r) => r.slug === slug).length ? "judged" : "no candidates"}`);
  }

  const { rows: stored } = await db.execute<{ a: string; b: string; type: string; strength: string; grounding: string; explanation: string }>(sql`
    SELECT a.title AS a, b.title AS b, c.type, c.strength, c.grounding, c.explanation
    FROM connection c JOIN book a ON a.id = c.book_a_id JOIN book b ON b.id = c.book_b_id`);
  const { rows: [spend] } = await db.execute<{ runs: number; cost: number; tin: number; tout: number }>(sql`
    SELECT count(*)::int AS runs, sum(cost_usd)::float8 AS cost, sum(input_tokens)::int AS tin, sum(output_tokens)::int AS tout FROM connection_run`);

  // --- Quote validity: every double-quoted span in the judge's raw answers against the Notes it was shown.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const QUOTED = /["“]([^"”]{8,})["”]/g;
  const RECOMMENDS = /\b(if you (liked|enjoyed|loved)|you might (enjoy|like)|consider (reading|revisiting)|worth (reading|revisiting)|offers? (a |another )?(similar|further|more))\b/i;
  let spans = 0, invalid = 0, quoting = 0, recommends = 0, unnamed = 0, rawCount = 0;
  const strengths: Record<string, number> = {};
  const rawPairs = new Map<string, { explanation: string; strength: string; type: string; quoted: boolean }>();
  for (const { input, result } of raw) {
    const notes = new Map<string, { body: string; title: string }>();
    for (const n of input.book.notes) notes.set(n.id, { body: n.body, title: input.book.title });
    for (const c of input.candidates) for (const n of c.notes) notes.set(n.id, { body: n.body, title: c.title });
    for (const c of result.connections) {
      rawCount++;
      strengths[c.strength] = (strengths[c.strength] ?? 0) + 1;
      if (RECOMMENDS.test(c.explanation)) recommends++;
      const found = [...c.explanation.matchAll(QUOTED)].map((m) => m[1]);
      if (found.length) quoting++;
      for (const span of found) {
        spans++;
        const sources = [...notes.values()].filter((n) => norm(n.body).includes(norm(span)));
        if (sources.length === 0) invalid++;
        else if (!sources.some((n) => c.explanation.toLowerCase().includes(n.title.toLowerCase().split(":")[0]))) unnamed++;
      }
      const other = input.candidates.find((x) => x.id === c.candidateId)?.title;
      if (other) rawPairs.set([input.book.title, other].sort().join(" | "), { explanation: c.explanation, strength: c.strength, type: c.type, quoted: found.length > 0 });
    }
  }

  // --- Against the baseline: pairs in both, flagged when an explanation may have got vaguer.
  const baseKey = (c: Baseline["connections"][number]) => [c.book, c.other].sort().join(" | ");
  const basePairs = new Map(baseline.connections.map((c) => [baseKey(c), c]));
  const baseQuoting = baseline.connections.filter((c) => [...c.explanation.matchAll(QUOTED)].length > 0).length;
  const common = [...rawPairs.keys()].filter((k) => basePairs.has(k));
  const maybeVaguer = common.filter((k) => {
    const n = rawPairs.get(k)!, o = basePairs.get(k)!;
    const lostQuote = [...o.explanation.matchAll(QUOTED)].length > 0 && !n.quoted;
    return lostQuote || n.explanation.length < o.explanation.length * 0.7;
  });
  const comparison = common
    .sort()
    .map((k) => {
      const n = rawPairs.get(k)!, o = basePairs.get(k)!;
      return `## ${k}${maybeVaguer.includes(k) ? "  [check: possibly vaguer]" : ""}\nBASELINE ${o.strength} ${o.type}: ${o.explanation}\nNEW      ${n.strength} ${n.type}: ${n.explanation}\n`;
    })
    .join("\n");
  fs.mkdirSync(dir + "out", { recursive: true });
  fs.writeFileSync(dir + "out/comparison.md", comparison);
  fs.writeFileSync(dir + "out/raw.json", JSON.stringify({ raw, stored, spend }, null, 1));

  const count = (k: string) => stored.filter((s) => s.strength === k).length;
  console.log(`
Judge ${inner.model} (${inner.promptVersion}), ${spend.runs} jobs, $${spend.cost.toFixed(3)} (${spend.tin} in / ${spend.tout} out tokens)

Quote validity:        ${invalid} invalid of ${spans} quoted spans (baseline: 0 of 24 quoting Connections)
Source Book unnamed:   ${unnamed} of ${spans} quoted spans
Recommend-reading:     ${recommends} of ${rawCount} explanations
Raw Connections:       ${rawCount} (strong ${strengths.strong ?? 0} / moderate ${strengths.moderate ?? 0} / weak ${strengths.weak ?? 0}); baseline ${baseline.connections.length}
Quoting Notes (raw):   ${quoting} of ${rawCount}; baseline ${baseQuoting} of ${baseline.connections.length}
Stored:                ${stored.length} (strong ${count("strong")} / moderate ${count("moderate")} / weak ${count("weak")}); note-grounded ${stored.filter((s) => s.grounding === "notes").length}, enrichment ${stored.filter((s) => s.grounding === "enrichment").length}
Pairs in both runs:    ${common.length} of ${rawPairs.size}; possibly vaguer: ${maybeVaguer.length}${maybeVaguer.length ? "\n  " + maybeVaguer.join("\n  ") : ""}

Read scripts/eval/out/comparison.md (side by side) before calling an explanation vaguer or not.`);
} finally {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.end();
}
process.exit(0);
