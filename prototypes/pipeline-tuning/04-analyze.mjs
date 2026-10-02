// PROTOTYPE step 4: apply strength floor / per-run cap to stored judge output, sweep the Louvain
// resolution, then replay Books being added one at a time to check Cluster identity (Jaccard match)
// and the rename threshold. Cluster naming uses Sonnet (counted in the ledger).
import { z } from 'zod';
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';
import { ORDER } from './data.mjs';
import { llm, loadJson, saveJson, spent } from './lib.mjs';

const books = Object.fromEntries(loadJson('books.json').map((b) => [b.slug, b]));
const RANK = { strong: 3, moderate: 2, weak: 1 };
const WEIGHT = { strong: 2, moderate: 1, weak: 0.5 };
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// floor: minimum strength kept. cap: max Connections stored per Book judged (per run).
function edgesFrom(judge, floor, cap) {
  const edges = [];
  for (const r of judge.results) {
    const kept = r.connections.filter((c) => RANK[c.strength] >= RANK[floor])
      .map((c) => ({ ...c, rank: r.candidates.indexOf(c.other) }))
      .sort((a, b) => RANK[b.strength] - RANK[a.strength] || a.rank - b.rank)
      .slice(0, cap);
    for (const c of kept) edges.push({ a: r.slug, b: c.other, strength: c.strength, type: c.type });
  }
  return edges;
}

function stats(edges, slugs) {
  const deg = Object.fromEntries(slugs.map((s) => [s, 0]));
  for (const e of edges) { deg[e.a]++; deg[e.b]++; }
  const same = edges.filter((e) => books[e.a].theme === books[e.b].theme && books[e.a].theme !== 'isolated').length;
  const themed = slugs.filter((s) => books[s].theme !== 'isolated');
  const withSame = themed.filter((s) => edges.some((e) => (e.a === s || e.b === s) &&
    books[e.a].theme === books[e.b].theme)).length;
  return { edges: edges.length, meanDegree: +(2 * edges.length / slugs.length).toFixed(2),
    maxDegree: Math.max(...Object.values(deg)), noConnections: slugs.filter((s) => !deg[s]),
    sameThemeEdgeShare: +(same / (edges.length || 1)).toFixed(2),
    themedBooksWithSameThemeEdge: `${withSame}/${themed.length}` };
}

function communities(edges, slugs, resolution, seed = 42) {
  const g = new Graph({ type: 'undirected' });
  slugs.forEach((s) => g.addNode(s));
  for (const e of edges) {
    const w = WEIGHT[e.strength];
    if (g.hasEdge(e.a, e.b)) g.updateEdgeAttribute(g.edge(e.a, e.b), 'weight', (x) => x + w);
    else g.addEdge(e.a, e.b, { weight: w });
  }
  const map = louvain(g, { resolution, rng: mulberry(seed), getEdgeWeight: 'weight' });
  const groups = {};
  for (const [s, c] of Object.entries(map)) (groups[c] ??= []).push(s);
  return Object.values(groups).filter((m) => m.length >= 3).map((m) => m.sort());
}
const purity = (members) => {
  const t = {}; members.forEach((m) => (t[books[m].theme] = (t[books[m].theme] ?? 0) + 1));
  return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
};

const files = { sonnet12: 'judge-sonnet-k12-b600', sonnet6: 'judge-sonnet-k6-b600', sonnet3: 'judge-sonnet-k3-b600', haiku12: 'judge-haiku-k12-b600' };
const judges = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, loadJson(f + '.json')]));
const all = ORDER;
const analysis = { floorCapSweep: {}, resolutionSweep: {}, incremental: [] };

// 1. floor x cap sweep per judge run
for (const [name, j] of Object.entries(judges))
  for (const floor of ['strong', 'moderate', 'weak'])
    for (const cap of [3, 5, 8])
      analysis.floorCapSweep[`${name} floor=${floor} cap=${cap}`] = stats(edgesFrom(j, floor, cap), all);

// 2. resolution sweep on the primary run (sonnet K=12, floor=moderate, cap=5)
const base = edgesFrom(judges.sonnet12, 'moderate', 5);
for (const res of [0.5, 0.75, 1, 1.5, 2]) {
  const cl = communities(base, all, res);
  analysis.resolutionSweep[res] = cl.map((m) => ({ size: m.length, members: m, themes: purity(m) }));
}

// 3. incremental replay at the default resolution
const RES = 1, JACCARD = 0.5, RENAME_AT = 0.3;
const Name = z.object({ name: z.string(), description: z.string() });
async function nameCluster(members, why) {
  const lines = members.map((s) => `- ${books[s].title} by ${books[s].author}: ${books[s].enrichment.themes.join('; ')}`).join('\n');
  const r = await llm({ label: 'cluster-name', tier: 'sonnet', maxTokens: 2000, schema: Name,
    system: 'You name a cluster of books from a reader\'s library. Give a short evocative name (2-4 words, no quotes) and a 1-2 sentence description of what ties the books together. Name the idea, not the genre.',
    user: `Books in the cluster:\n${lines}` });
  analysis.namingCalls = (analysis.namingCalls ?? 0) + 1;
  return { ...r.parsed, why };
}
let prev = []; // {id, members, name, description}
let nextId = 1;
for (let n = 4; n <= all.length; n++) {
  const slugs = all.slice(0, n);
  const inSet = new Set(slugs);
  const edges = base.filter((e) => inSet.has(e.a) && inSet.has(e.b));
  const cur = communities(edges, slugs, RES);
  const pairs = [];
  cur.forEach((m, i) => prev.forEach((p, j) => {
    const inter = m.filter((x) => p.members.includes(x)).length;
    pairs.push({ i, j, jac: inter / (m.length + p.members.length - inter) });
  }));
  pairs.sort((a, b) => b.jac - a.jac);
  const usedI = new Set(), usedJ = new Set(), next = [], events = [];
  for (const p of pairs) {
    if (p.jac < JACCARD || usedI.has(p.i) || usedJ.has(p.j)) continue;
    usedI.add(p.i); usedJ.add(p.j);
    const old = prev[p.j], change = 1 - p.jac;
    let { name, description } = old;
    if (change >= RENAME_AT) {
      ({ name, description } = await nameCluster(cur[p.i], 'rename'));
      events.push(`RENAME #${old.id} "${old.name}" -> "${name}" (change ${(change * 100).toFixed(0)}%, J=${p.jac.toFixed(2)})`);
    } else if (change > 0) events.push(`kept #${old.id} "${old.name}" (change ${(change * 100).toFixed(0)}%, J=${p.jac.toFixed(2)})`);
    next.push({ id: old.id, members: cur[p.i], name, description });
  }
  for (const [i, m] of cur.entries()) if (!usedI.has(i)) {
    const c = { id: nextId++, members: m, ...(await nameCluster(m, 'new')) };
    next.push(c); events.push(`NEW #${c.id} "${c.name}" (${m.length} Books)`);
  }
  for (const [j, p] of prev.entries()) if (!usedJ.has(j)) events.push(`DISSOLVED #${p.id} "${p.name}"`);
  prev = next;
  analysis.incremental.push({ n, added: slugs.at(-1), edges: edges.length, clusters: next.map((c) => ({ id: c.id, name: c.name, description: c.description, members: c.members, themes: purity(c.members) })), events });
  console.log(`n=${String(n).padStart(2)} +${slugs.at(-1).padEnd(18)} clusters=${next.length}  ${events.join(' | ')}`);
}
saveJson('analysis.json', analysis);
console.log('\nresolution sweep:');
for (const [r, cl] of Object.entries(analysis.resolutionSweep)) console.log(r, cl.map((c) => `[${c.size}: ${c.themes}]`).join(' '));
console.log(`ledger $${spent().toFixed(3)}`);
await (await import('./lib.mjs')).pool.end();
