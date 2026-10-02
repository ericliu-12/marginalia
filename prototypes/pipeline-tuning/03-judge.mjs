// PROTOTYPE step 3: the Connection judge. One structured call per Book, judged against the Books
// finished before it (ORDER), over the top-K candidates from voyage-4 retrieval.
//   node 03-judge.mjs <sonnet|haiku> <K> <notesTokenBudgetPerCandidate> [slug,slug,...]
import { z } from 'zod';
import { ORDER } from './data.mjs';
import { llm, loadJson, saveJson, spent } from './lib.mjs';

const [tier = 'sonnet', K = '12', BUDGET = '600', only] = process.argv.slice(2);
const k = Number(K), budget = Number(BUDGET);
const PROMPT_VERSION = 'p1';

const books = Object.fromEntries(loadJson('books.json').map((b) => [b.slug, b]));
const neighbors = loadJson('neighbors.json')['voyage-4'];

const Out = z.object({
  connections: z.array(z.object({
    candidate_id: z.string(),
    type: z.enum(['thematic', 'contrast', 'context']),
    strength: z.enum(['strong', 'moderate', 'weak']),
    explanation: z.string(),
    quoted_note_ids: z.array(z.string()),
  })),
});

// Static-first so prompt caching is a one-line change later.
const SYSTEM = `You decide which of a reader's earlier-finished books connect to a book they have just finished, for a private reading journal. The reader will read your explanations, so they must be specific and true.

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
- You may quote the reader's own Notes. Quote verbatim, inside double quotation marks, and list the id of each Note you quoted in quoted_note_ids. Never put anything inside double quotation marks that is not copied exactly from a Note. Do not put book titles in quotation marks.
- Never claim the reader thought or felt something their Notes do not say. If a book has no Notes, rely on its Enrichment only and do not imply the reader said anything about it.
- If a book's Enrichment is unavailable, say little about its content; only link it through its Notes.`;

const approxTokens = (s) => Math.ceil(s.length / 4);
let noteSeq = 0;
function noteBlock(slug, cap) {
  const ids = [];
  let used = 0;
  const lines = (books[slug].notes ?? []).flatMap((body, i) => {
    if (used + approxTokens(body) > cap) return [];
    used += approxTokens(body);
    const id = `n${++noteSeq}`;
    ids.push({ id, slug, idx: i, body });
    return [`  [${id}] ${body}`];
  });
  return { text: lines.length ? lines.join('\n') : '  (no Notes)', ids };
}
const enrich = (b) => b.enrichment.themes.length <= 2 ? '(unavailable)' : `${b.enrichment.summary} Themes: ${b.enrichment.themes.join('; ')}`;

const position = (s) => ORDER.indexOf(s);
const results = [];
for (const [i, slug] of ORDER.entries()) {
  if (only && !only.split(',').includes(slug)) continue;
  const cands = (neighbors[slug] ?? []).filter((n) => position(n.slug) < i).slice(0, k).map((n) => n.slug);
  if (!cands.length) { results.push({ slug, position: i, candidates: [], connections: [], skipped: 'no candidates' }); continue; }
  noteSeq = 0;
  const noteIndex = [];
  const self = noteBlock(slug, 1e9);
  noteIndex.push(...self.ids);
  const cblocks = cands.map((c, j) => {
    const nb = noteBlock(c, budget);
    noteIndex.push(...nb.ids);
    return `[C${j + 1}] ${books[c].title} by ${books[c].author}\n  Enrichment: ${enrich(books[c])}\n  Notes:\n${nb.text}`;
  });
  const user = `NEWLY FINISHED BOOK\n${books[slug].title} by ${books[slug].author}\nEnrichment: ${enrich(books[slug])}\nReader's Notes:\n${self.text}\n\nEARLIER-FINISHED CANDIDATES\n${cblocks.join('\n\n')}`;
  const r = await llm({ label: `judge:${tier}`, tier, system: SYSTEM, user, schema: Out, maxTokens: 8000 });
  const byId = Object.fromEntries(noteIndex.map((n) => [n.id, n]));
  const conns = [];
  let malformed = 0;
  for (const c of r.parsed.connections) {
    const idx = Number(c.candidate_id.replace(/^C/i, '')) - 1;
    const other = cands[idx];
    if (!other) { malformed++; continue; }
    // quote validation: every double-quoted span must appear verbatim (normalised) in a cited Note
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const cited = c.quoted_note_ids.map((id) => byId[id]).filter(Boolean);
    const pool = cited.length ? cited : noteIndex;
    const spans = [...c.explanation.matchAll(/["“]([^"”]{8,})["”]/g)].map((m) => m[1]);
    const invalid = spans.filter((sp) => !pool.some((n) => norm(n.body).includes(norm(sp))));
    conns.push({ other, type: c.type, strength: c.strength, explanation: c.explanation,
      quoted: cited.map((n) => ({ slug: n.slug, idx: n.idx })),
      quotes: { total: spans.length, invalid, badIds: c.quoted_note_ids.length - cited.length } });
  }
  results.push({ slug, position: i, candidates: cands, connections: conns, malformed, usage: r.usage, usd: r.usd, cached: !!r.cached });
  console.log(`${String(i).padStart(2)} ${slug.padEnd(18)} cands=${cands.length} conns=${conns.length} $${r.usd.toFixed(4)}${r.cached ? ' (cached)' : ''}`);
}
const name = `judge-${tier}-k${k}-b${budget}${only ? '-sample' : ''}.json`;
saveJson(name, { tier, k, budget, promptVersion: PROMPT_VERSION, results });
console.log(`wrote ${name}; ledger $${spent().toFixed(3)}`);
await (await import('./lib.mjs')).pool.end();
