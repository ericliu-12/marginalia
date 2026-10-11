// Eval harness for the Connection judge (and the Enrichment it reads). Run it, and report its output,
// after any change to the Enrichment or judge prompts or the judge call settings (see CLAUDE.md).
//
//   pnpm eval [--runs N] [--cap USD]
//
// Feeds the 19-book set (fixtures/books.json: the reader's real Finished Books, saved Enrichment and
// Notes) through the real pipeline in finish order: the Pipeline's jobs over the in-memory queue, real
// Claude judge, real Voyage. It runs in a scratch database that it creates and drops, never the dev DB.
// The judge answers each input N times (default 3) and the pipeline carries on with the first answer;
// a pair is flagged against the baseline only when most runs agree. Costs about $0.20 per run, read
// from paid_call, and stops once spend reaches the cap (default $1.50).
// Compares against fixtures/baseline.json (the p2 prompt, from prototype/pipeline-tuning).
import fs from "node:fs";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { user } from "@/db/schema";
import { addBook } from "@/domain/add-book";
import type { JudgeInput, JudgeResult } from "@/domain/connections";
import type { Embedder } from "@/domain/embeddings";
import { enrichBook } from "@/domain/enrichment";
import { addNote } from "@/domain/notes";
import { createPipeline } from "@/domain/pipeline";
import type { OpenLibraryWork } from "@/domain/search";
import { spendLog } from "@/domain/spend";
import { claudeJudge } from "@/lib/claude";
import { memoryQueue } from "@/lib/memory-queue";
import { voyageEmbedder } from "@/lib/voyage";
import { cappedSpend, evalOptions, majority, tally } from "./vote";

type Fixture = {
  order: string[];
  books: { slug: string; title: string; author: string; enrichment: { recognised: boolean; summary: string; themes: string[] }; notes: string[] }[];
};
type Baseline = { connections: { book: string; other: string; type: string; strength: string; explanation: string }[] };

const dir = new URL("./", import.meta.url).pathname;
const fixture: Fixture = JSON.parse(fs.readFileSync(dir + "fixtures/books.json", "utf8"));
const baseline: Baseline = JSON.parse(fs.readFileSync(dir + "fixtures/baseline.json", "utf8"));
const books = Object.fromEntries(fixture.books.map((b) => [b.slug, b]));
const { runs, capUsd } = evalOptions(process.argv.slice(2));

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
  const [reader] = await db.insert(user).values({ email: "eval@marginalia.local" }).returning();
  const spend = cappedSpend(capUsd, spendLog(db));

  // Voyage rate limits clear within minutes: retry rather than abort a paid run.
  const voyage = voyageEmbedder(undefined, undefined, spend);
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

  // Judges every input runs times and records what it was shown and each answer, before the pipeline's own
  // filtering. The pipeline carries on with the first answer, so every run sees the same inputs.
  const inner = claudeJudge(undefined, spend);
  const raw: { slug: string; input: JudgeInput; results: JudgeResult[] }[] = [];
  let current = "";
  const judge = {
    model: inner.model,
    promptVersion: inner.promptVersion,
    async judge(input: JudgeInput) {
      const results: JudgeResult[] = [];
      for (let run = 0; run < runs; run++) {
        spend.check();
        results.push(await inner.judge(input));
      }
      raw.push({ slug: current, input, results });
      return results[0];
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
    const work: OpenLibraryWork = { workKey: `/works/${slug}`, title: b.title, authors: [b.author], firstPublishedYear: null, editionCount: 1, readinglogCount: 0, coverId: null, subjects: [] };
    const entry = await addBook(db, pipeline, reader.id, work, "read");
    // Seat the saved Enrichment through the real Enrichment module (hashes included), so the job does not redo it.
    const saved = { model: "eval", promptVersion: "saved", async enrich() {
      return { ...b.enrichment, author: b.author, firstPublishedYear: null, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    } };
    await enrichBook(db, { model: saved }, entry.bookId);
    for (const body of b.notes) await addNote(db, pipeline, reader.id, entry.bookId, { body });
    current = slug;
    await jobs.drain({ model: unused, judge, embedder, descriptions: null, namer });
    // The queue retries a job whose judge call hit the cap and then gives up on it quietly, so stop here.
    spend.check();
    console.log(`${b.title}: ${raw.filter((r) => r.slug === slug).length ? "judged" : "no candidates"}`);
  }

  const { rows: stored } = await db.execute<{ a: string; b: string; type: string; strength: string; grounding: string; explanation: string }>(sql`
    SELECT a.title AS a, b.title AS b, c.type, c.strength, c.grounding, c.explanation
    FROM connection c JOIN book a ON a.id = c.book_a_id JOIN book b ON b.id = c.book_b_id`);
  const { rows: paid } = await db.execute<{ purpose: string; calls: number; cost: number; tin: number; tout: number }>(sql`
    SELECT purpose, count(*)::int AS calls, sum(cost_usd)::float8 AS cost, sum(input_tokens)::int AS tin, sum(output_tokens)::int AS tout
    FROM paid_call GROUP BY purpose`);
  const paidFor = (purpose: string) => paid.find((p) => p.purpose === purpose) ?? { calls: 0, cost: 0, tin: 0, tout: 0 };
  const judged = paidFor("judge"), embedded = paidFor("embedding");

  // --- Quote validity, per run: every double-quoted span in the judge's raw answers against the Notes it was shown.
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const QUOTED = /["“]([^"”]{8,})["”]/g;
  const RECOMMENDS = /\b(if you (liked|enjoyed|loved)|you might (enjoy|like)|consider (reading|revisiting)|worth (reading|revisiting)|offers? (a |another )?(similar|further|more))\b/i;
  type Pair = { explanation: string; strength: string; type: string; quoted: boolean };
  const perRun = Array.from({ length: runs }, (_, run) => {
    let spans = 0, invalid = 0, quoting = 0, recommends = 0, unnamed = 0, rawCount = 0;
    const strengths: Record<string, number> = {};
    const pairs = new Map<string, Pair>();
    for (const { input, results } of raw) {
      const notes = new Map<string, { body: string; title: string }>();
      for (const n of input.book.notes) notes.set(n.id, { body: n.body, title: input.book.title });
      for (const c of input.candidates) for (const n of c.notes) notes.set(n.id, { body: n.body, title: c.title });
      for (const c of results[run].connections) {
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
        if (other) pairs.set([input.book.title, other].sort().join(" | "), { explanation: c.explanation, strength: c.strength, type: c.type, quoted: found.length > 0 });
      }
    }
    return { spans, invalid, quoting, recommends, unnamed, rawCount, strengths, pairs };
  });

  // --- Against the baseline: pairs in both, flagged when a run's explanation may have got vaguer, or its
  // strength or type changed, and reported only when a majority of runs agree.
  const baseKey = (c: Baseline["connections"][number]) => [c.book, c.other].sort().join(" | ");
  const basePairs = new Map(baseline.connections.map((c) => [baseKey(c), c]));
  const baseQuoting = baseline.connections.filter((c) => [...c.explanation.matchAll(QUOTED)].length > 0).length;
  const common = [...new Set(perRun.flatMap((r) => [...r.pairs.keys()]))].filter((k) => basePairs.has(k)).sort();
  // How many runs flagged each pair, for a test of that run's Connection against the baseline's.
  const flaggedBy = (test: (n: Pair, o: Baseline["connections"][number]) => boolean) =>
    tally(perRun.map((r) => common.filter((k) => r.pairs.has(k) && test(r.pairs.get(k)!, basePairs.get(k)!))));
  const checks: [string, Map<string, number>][] = [
    ["possibly vaguer", flaggedBy((n, o) => ([...o.explanation.matchAll(QUOTED)].length > 0 && !n.quoted) || n.explanation.length < o.explanation.length * 0.7)],
    ["changed", flaggedBy((n, o) => n.strength !== o.strength || n.type !== o.type)],
  ];
  const agreement = (counts: Map<string, number>, k: string) => `${counts.get(k) ?? 0}/${runs}`;
  const flags = (k: string) =>
    checks
      .filter(([, counts]) => counts.has(k))
      .map(([label, counts]) => `[${majority(counts.get(k)!, runs) ? "check: " : ""}${label} ${agreement(counts, k)}]`)
      .join(" ");
  const comparison = common
    .map((k) => {
      const o = basePairs.get(k)!;
      const runLines = perRun.map((r, i) => {
        const n = r.pairs.get(k);
        return `RUN ${i + 1}    ${n ? `${n.strength} ${n.type}: ${n.explanation}` : "(no Connection)"}`;
      });
      return `## ${k}  ${flags(k)}\nBASELINE ${o.strength} ${o.type}: ${o.explanation}\n${runLines.join("\n")}\n`;
    })
    .join("\n");
  fs.mkdirSync(dir + "out", { recursive: true });
  fs.writeFileSync(dir + "out/comparison.md", comparison);
  fs.writeFileSync(dir + "out/raw.json", JSON.stringify({ raw, stored, paid }, null, 1));

  const count = (k: string) => stored.filter((s) => s.strength === k).length;
  const each = (f: (r: (typeof perRun)[number]) => string | number) => perRun.map(f).join(" / ");
  const voted = ([label, counts]: (typeof checks)[number]) => {
    const agreed = common.filter((k) => majority(counts.get(k) ?? 0, runs));
    const minority = common.filter((k) => counts.has(k) && !agreed.includes(k)).length;
    const lines = [`${(label + ":").padEnd(23)}${agreed.length}`, ...agreed.map((k) => `  ${k} (${agreement(counts, k)})`)];
    if (minority) lines.push(`  (${minority} more flagged by a minority of runs)`);
    return lines.join("\n");
  };
  console.log(`
Judge ${inner.model} (${inner.promptVersion}), ${raw.length} inputs judged ${runs} times each; figures per run are run 1 / run 2 / ...
Cost (paid_call):      $${(judged.cost + embedded.cost).toFixed(3)} of the $${capUsd.toFixed(2)} cap: judge $${judged.cost.toFixed(3)} ($${(judged.cost / runs).toFixed(3)} per run; ${judged.calls} calls, ${judged.tin} in / ${judged.tout} out tokens), Voyage $${embedded.cost.toFixed(4)}

Quote validity:        ${each((r) => r.invalid)} invalid of ${each((r) => r.spans)} quoted spans (baseline: 0 of 24 quoting Connections)
Source Book unnamed:   ${each((r) => r.unnamed)} of ${each((r) => r.spans)} quoted spans
Recommend-reading:     ${each((r) => r.recommends)} of ${each((r) => r.rawCount)} explanations
Raw Connections:       ${each((r) => `${r.rawCount} (${r.strengths.strong ?? 0}/${r.strengths.moderate ?? 0}/${r.strengths.weak ?? 0})`)} as total (strong/moderate/weak); baseline ${baseline.connections.length}
Quoting Notes (raw):   ${each((r) => r.quoting)} of ${each((r) => r.rawCount)}; baseline ${baseQuoting} of ${baseline.connections.length}
Stored (run 1):        ${stored.length} (strong ${count("strong")} / moderate ${count("moderate")} / weak ${count("weak")}); note-grounded ${stored.filter((s) => s.grounding === "notes").length}, enrichment ${stored.filter((s) => s.grounding === "enrichment").length}
Pairs in baseline:     ${common.length} found by any run
${checks.map(voted).join("\n")}

Majority means more than half of the ${runs} runs. Read scripts/eval/out/comparison.md (every run side by side) before calling an explanation vaguer or not.`);
} finally {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await admin.end();
}
process.exit(0);
