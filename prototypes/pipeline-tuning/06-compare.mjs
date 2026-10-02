// PROTOTYPE step 6: Open Library vs Google Books description source (both under the p2 prompts).
import { loadJson, out } from './lib.mjs';

const S = ['ol', 'gb'];
const books = Object.fromEntries(S.map((s) => [s, Object.fromEntries(loadJson(`p2-${s}-books.json`).map((b) => [b.slug, b]))]));
const judge = Object.fromEntries(S.map((s) => [s, loadJson(`p2-${s}-judge-sonnet-k12-b600.json`)]));
const an = Object.fromEntries(S.map((s) => [s, loadJson(`p2-${s}-analysis.json`)]));
const slugs = Object.keys(books.ol);
const title = (x) => books.ol[x].title;
const RANK = { strong: 3, moderate: 2, weak: 1 };
const md = [];
const p = (...x) => md.push(x.join(''));
const USABLE = 200;

p('# Open Library vs Google Books descriptions (p2 prompts, Sonnet judge, K=12)\n');
p('## 1. Usable descriptions\n');
p('| Book | Open Library chars | Google Books chars | GB match |\n|---|---|---|---|');
for (const x of slugs) p(`| ${title(x)} | ${books.ol[x].descChars} | ${books.gb[x].descChars} | ${books.gb[x].gb.picked ? books.gb[x].gb.picked.title : '(none)'} |`);
const usable = (s) => slugs.filter((x) => books[s][x].descChars >= USABLE).length;
const mean = (s) => Math.round(slugs.filter((x) => books[s][x].descChars).reduce((a, x) => a + books[s][x].descChars, 0) / slugs.filter((x) => books[s][x].descChars).length);
p(`\nUsable (>= ${USABLE} chars): **Open Library ${usable('ol')}/19, Google Books ${usable('gb')}/19.** Mean length where present: OL ${mean('ol')}, GB ${mean('gb')}.\n`);

// invented-name candidates: capitalised words in the summary that appear nowhere in the inputs
const words = (t) => new Set((t.match(/[A-Z][a-zà-ÿ'’-]+/g) ?? []));
p('## 2. Enrichment: possible invented names or details\n');
p('Capitalised words in the Enrichment that appear in neither the title, author, description nor subjects (candidates only; read them).\n');
for (const s of S) {
  p(`**${s === 'ol' ? 'Open Library' : 'Google Books'}**`);
  let n = 0;
  for (const x of slugs) {
    const b = books[s][x];
    const src = `${b.title} ${b.author} ${b.desc} ${(b.ol.subjects ?? []).join(' ')}`.toLowerCase();
    const odd = [...words(b.enrichment.summary)].filter((w) => !src.includes(w.toLowerCase()));
    if (odd.length) { n++; p(`- ${b.title}: ${odd.join(', ')}`); }
  }
  if (!n) p('- (none)');
  p('');
}
p('Summaries for the books whose source changed most:\n');
for (const x of ['brilliant-friend', 'set-my-heart', 'beautiful-world', 'norwegian-wood']) {
  p(`### ${title(x)}`);
  for (const s of S) p(`- ${s.toUpperCase()} (${books[s][x].descChars} chars, recognised=${books[s][x].enrichment.recognised}): ${books[s][x].enrichment.summary || '(unrecognised, no Enrichment)'}`);
  p('');
}

// judge metrics
const agg = (j) => { let c = 0, q = 0, bad = 0, un = 0, rec = 0, w = 0, wb = 0, none = 0; for (const r of j.results) { if (!r.connections.length) none++; for (const x of r.connections) { c++; q += x.quotes.total; bad += x.quotes.invalid.length; un += x.unnamed; rec += x.recommends ? 1 : 0; if (x.strength === 'weak') { w++; if (x.quotedBoth) wb++; } } } return { c, q, bad, un, rec, w, wb, none }; };
const A = Object.fromEntries(S.map((s) => [s, agg(judge[s])]));
p('## 3. Explanations\n');
p('| | Open Library | Google Books |\n|---|---|---|');
for (const [k, l] of [['c', 'Connections returned'], ['w', 'of which weak'], ['wb', 'weak quoting both Books\' Notes'], ['q', 'quotes'], ['bad', 'invalid quotes'], ['un', 'quoted Notes without the book named'], ['rec', 'recommending phrases'], ['none', 'Books with no Connections']]) p(`| ${l} | ${A.ol[k]} | ${A.gb[k]} |`);

// edge diff under the reader's rule
const edges = (j) => { const m = new Map(); for (const r of j.results) { const kept = r.connections.filter((c) => RANK[c.strength] >= 2 || (c.strength === 'weak' && c.quotedBoth)).map((c) => ({ ...c, rank: r.candidates.indexOf(c.other) })).sort((a, b) => RANK[b.strength] - RANK[a.strength] || a.rank - b.rank).slice(0, 5); for (const c of kept) m.set([r.slug, c.other].sort().join('|'), c); } return m; };
const E = Object.fromEntries(S.map((s) => [s, edges(judge[s])]));
const shared = [...E.ol.keys()].filter((k) => E.gb.has(k)), olOnly = [...E.ol.keys()].filter((k) => !E.gb.has(k)), gbOnly = [...E.gb.keys()].filter((k) => !E.ol.has(k));
const nm = (k) => k.split('|').map(title).join(' ↔ ');
p(`\n**Stored Connections (floor moderate + weak-with-both-Notes, cap 5):** OL ${E.ol.size}, GB ${E.gb.size}; ${shared.length} shared, ${olOnly.length} only with OL, ${gbOnly.length} only with GB.\n`);
p('Only with Open Library descriptions:'); olOnly.forEach((k) => p(`- ${nm(k)} (${E.ol.get(k).strength})`));
p('\nOnly with Google Books descriptions:'); gbOnly.forEach((k) => p(`- ${nm(k)} (${E.gb.get(k).strength}): ${E.gb.get(k).explanation}`));
p('\n### Isolated Books (should have none: The Course, Inverting the Pyramid)\n');
for (const s of S) { const deg = {}; for (const k of E[s].keys()) k.split('|').forEach((x) => (deg[x] = (deg[x] ?? 0) + 1)); p(`- ${s.toUpperCase()}: The Course ${deg['the-course'] ?? 0} edges, Inverting the Pyramid ${deg['inverting-pyramid'] ?? 0}, Set My Heart on Fire ${deg['set-my-heart'] ?? 0}`); }

// clusters
p('\n## 4. Clusters (resolution 1.0)\n');
for (const s of S) {
  const last = an[s].incremental.at(-1);
  p(`**${s === 'ol' ? 'Open Library' : 'Google Books'}** (${an[s].incremental.flatMap((i) => i.events).filter((e) => e.startsWith('RENAME')).length} renames, ${an[s].incremental.flatMap((i) => i.events).filter((e) => e.startsWith('DISSOLVED')).length} dissolutions over the replay)`);
  for (const c of last.clusters) p(`- **${c.name}**: ${c.members.map(title).join('; ')}. ${c.description}`);
  p('');
}

// cost
const sumC = (s, f) => slugs.reduce((a, x) => a + f(x), 0);
const enr = Object.fromEntries(S.map((s) => [s, sumC(s, (x) => books[s][x].enrichCost)]));
const jud = Object.fromEntries(S.map((s) => [s, judge[s].results.reduce((a, r) => a + (r.usd ?? 0), 0)]));
const inTok = Object.fromEntries(S.map((s) => [s, judge[s].results.reduce((a, r) => a + (r.usage?.in ?? 0), 0)]));
p('## 5. Cost\n');
p('| | Open Library | Google Books |\n|---|---|---|');
p(`| Enrichment (19 Books, Haiku) | $${enr.ol.toFixed(4)} | $${enr.gb.toFixed(4)} |`);
p(`| Judge (Sonnet) | $${jud.ol.toFixed(4)} | $${jud.gb.toFixed(4)} |`);
p(`| Judge input tokens | ${inTok.ol} | ${inTok.gb} |`);
p(`| Per finished Book (Enrichment + judge) | $${((enr.ol + jud.ol) / 19).toFixed(4)} | $${((enr.gb + jud.gb) / 19).toFixed(4)} |`);
out('COMPARE.md', md.join('\n') + '\n');
console.log(md.join('\n'));
await (await import('./lib.mjs')).pool.end();
