// PROTOTYPE step 2: embed Enrichment (per Book) and Notes (each separately) with voyage-4 and
// voyage-4-lite into pgvector (vector(1024), HNSW cosine), then rank candidate Books per Book via SQL.
// Candidate rule from the pipeline decision: query with the Book's Enrichment + each of its Notes
// against every other Book's Enrichment + Notes, collapse to Book level (max similarity).
import { embed, pool, vec, saveJson, loadJson, spent } from './lib.mjs';

const books = loadJson('books.json');
const VOYAGE = ['voyage-4', 'voyage-4-lite'];

// PROTOTYPE hack: an Enrichment that says the model doesn't know the book must not be embedded.
// (Real design finding: add a `recognised` flag to the Enrichment output instead of this heuristic.)
const unknown = (e) => e.themes.length <= 2 || /don't have reliable|unable to verify/i.test(e.summary + e.themes.join(' '));
const enrichText = (b) => `${b.enrichment.summary}\nThemes: ${b.enrichment.themes.join('; ')}`;

await pool.query(`create extension if not exists vector`);
await pool.query(`drop table if exists emb`);
await pool.query(`create table emb (id serial primary key, model text, kind text, slug text, note_idx int, vec vector(1024))`);
for (const m of VOYAGE)
  await pool.query(`create index on emb using hnsw (vec vector_cosine_ops) where model = '${m}'`);

const items = [];
for (const b of books) {
  if (!unknown(b.enrichment)) items.push({ kind: 'enrichment', slug: b.slug, idx: 0, text: enrichText(b) });
  (b.notes ?? []).forEach((n, i) => items.push({ kind: 'note', slug: b.slug, idx: i, text: n }));
}
console.log(`${items.length} texts; skipped Enrichment for:`, books.filter((b) => unknown(b.enrichment)).map((b) => b.title));

for (const model of VOYAGE) {
  const vectors = await embed(items.map((i) => i.text), model, 'document');
  for (const [k, it] of items.entries())
    await pool.query(`insert into emb (model, kind, slug, note_idx, vec) values ($1,$2,$3,$4,$5)`,
      [model, it.kind, it.slug, it.idx, vec(vectors[k])]);
}

const neighbors = {};
for (const model of VOYAGE) {
  neighbors[model] = {};
  const rows = (await pool.query(`select id, slug, kind, note_idx from emb where model=$1`, [model])).rows;
  for (const b of books) {
    const score = new Map();
    for (const q of rows.filter((r) => r.slug === b.slug)) {
      const hits = (await pool.query(
        `select e.slug, e.kind, 1 - (e.vec <=> q.vec) as sim
           from emb e, (select vec from emb where id=$2) q
          where e.model=$1 and e.slug <> $3 order by e.vec <=> q.vec limit 60`,
        [model, q.id, b.slug])).rows;
      for (const h of hits) score.set(h.slug, Math.max(score.get(h.slug) ?? -1, Number(h.sim)));
    }
    neighbors[model][b.slug] = [...score].sort((a, c) => c[1] - a[1]).map(([slug, sim]) => ({ slug, sim }));
  }
}
saveJson('neighbors.json', neighbors);

// bake-off metrics
const theme = Object.fromEntries(books.map((b) => [b.slug, b.theme]));
const prec3 = (m) => {
  let hit = 0, tot = 0;
  for (const b of books.filter((x) => x.theme !== 'isolated')) {
    for (const n of neighbors[m][b.slug].slice(0, 3)) { tot++; if (theme[n.slug] === b.theme) hit++; }
  }
  return (hit / tot).toFixed(2);
};
const overlap = (k) => {
  let s = 0;
  for (const b of books) {
    const a = new Set(neighbors['voyage-4'][b.slug].slice(0, k).map((n) => n.slug));
    s += neighbors['voyage-4-lite'][b.slug].slice(0, k).filter((n) => a.has(n.slug)).length / k;
  }
  return (s / books.length).toFixed(2);
};
const metrics = { theme_precision_at_3: Object.fromEntries(VOYAGE.map((m) => [m, prec3(m)])),
  model_overlap_at_3: overlap(3), model_overlap_at_5: overlap(5) };
saveJson('bakeoff.json', metrics);
console.log(metrics, `ledger $${spent().toFixed(3)}`);
await pool.end();
