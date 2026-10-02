// PROTOTYPE step 5: write results/REPORT.md for the reader to review.
import { ORDER } from './data.mjs';
import { ledger, loadJson, out } from './lib.mjs';

const books = Object.fromEntries(loadJson('books.json').map((b) => [b.slug, b]));
const neighbors = loadJson('neighbors.json');
const bake = loadJson('bakeoff.json');
const an = loadJson('analysis.json');
const sonnet = loadJson('judge-sonnet-k12-b600.json');
const haiku = loadJson('judge-haiku-k12-b600.json');
const L = ledger();
const t = (s) => books[s].title;
const usd = (x, d = 4) => '$' + x.toFixed(d);
const md = [];
const p = (...x) => md.push(x.join(''));

// ---- cost
const sum = (f) => L.filter(f).reduce((s, r) => s + r.usd, 0);
const cnt = (f) => L.filter(f).length;
const total = sum(() => true);
const per = (label, n) => usd(sum((r) => r.label === label) / n);
const judged = sonnet.results.filter((r) => r.usd).length;
const steady = (j) => { const r = j.results.filter((x) => x.usd && x.candidates.length === 12); return r.reduce((s, x) => s + x.usd, 0) / r.length; };
p('# Pipeline tuning results (PROTOTYPE, ticket #13)\n');
p(`Sample: ${ORDER.length} Finished Books, ${Object.values(books).filter((b) => b.notes).length} with Notes. Judge run in finish order (each Book vs the Books finished before it). Total spend **${usd(total, 3)}** of the $15 cap. OpenAI \`text-embedding-3-small\` was **not tested** (no key); the bake-off is voyage-4 vs voyage-4-lite.\n`);
p('## 1. Measured cost per finished Book\n');
p('| Step | Tier / model | Cost per Book |\n|---|---|---|');
p(`| Enrichment | Haiku 4.5 | ${per('enrich:haiku', ORDER.length)} |`);
p(`| Enrichment | Sonnet 5.5 | ${per('enrich:sonnet', ORDER.length)} |`);
p(`| Connection judge, average over the run | Sonnet 5.5 | ${usd(sonnet.results.reduce((s, r) => s + (r.usd ?? 0), 0) / judged)} |`);
p(`| Connection judge, steady state (12 candidates) | Sonnet 5.5 | ${usd(steady(sonnet))} |`);
p(`| Connection judge, steady state (12 candidates) | Haiku 4.5 | ${usd(steady(haiku))} |`);
p(`| Embeddings (Enrichment + Notes) | voyage-4 / lite | ~$0.0000 (${sum((r) => r.label.startsWith('embed')).toFixed(5)} total) |`);
p(`| Cluster naming/description | Sonnet 5.5 | ${usd(sum((r) => r.label === 'cluster-name') / (an.namingCalls ?? 1))} per call, ${an.namingCalls} calls over the replay |\n`);
const full = (e, j) => usd(e + j);
const eH = sum((r) => r.label === 'enrich:haiku') / ORDER.length, eS = sum((r) => r.label === 'enrich:sonnet') / ORDER.length;
p(`**Running cost per finished Book (steady state): Haiku Enrichment + Sonnet judge ≈ ${full(eH, steady(sonnet))}; Haiku + Haiku ≈ ${full(eH, steady(haiku))}; Sonnet + Sonnet ≈ ${full(eS, steady(sonnet))}.** Notes in this sample are short, so the judge input is small; real Notes at the 600-token-per-candidate budget would raise the judge cost (worst case roughly 2-3x). A Refresh costs one judge call.\n`);

// ---- enrichment
p('## 2. Low-confidence rule (no usable Open Library description, < 200 chars)\n');
p('| Book | OL description chars | Flagged |\n|---|---|---|');
for (const b of Object.values(books)) p(`| ${b.title} | ${b.descChars} | ${b.lowConf ? 'LOW' : ''} |`);
const flagged = Object.values(books).filter((b) => b.lowConf);
p(`\n**${flagged.length}/${ORDER.length} flagged.** Six of them are famous books Claude knows well with a 0-character OL description, so changing the threshold would not fix this; the rule is checking the wrong thing. Conservative vs normal Enrichment for each flagged Book:\n`);
for (const b of flagged) {
  p(`### ${b.title}\n- Conservative: ${b.enrichment.summary} _Themes:_ ${b.enrichment.themes.join('; ')}`);
  p(`- Normal: ${b.enrichmentNormal.summary} _Themes:_ ${b.enrichmentNormal.themes.join('; ')}\n`);
}

// ---- bake-off
p('## 3. Embeddings bake-off (voyage-4 vs voyage-4-lite)\n');
p('Theme precision@3 = share of a Book\'s top-3 candidates in the same expected theme (rough, provisional themes; cross-theme links can be legitimate). Overlap = share of top-k candidates both models agree on.\n');
p(`- voyage-4: ${bake.theme_precision_at_3['voyage-4']}  |  voyage-4-lite: ${bake.theme_precision_at_3['voyage-4-lite']}`);
p(`- Overlap@3 ${bake.model_overlap_at_3}, overlap@5 ${bake.model_overlap_at_5}\n`);
p('| Book | voyage-4 top 3 | voyage-4-lite top 3 |\n|---|---|---|');
for (const s of ORDER) p(`| ${t(s)} | ${neighbors['voyage-4'][s].slice(0, 3).map((n) => t(n.slug)).join('; ') || '(none: no embedding)'} | ${neighbors['voyage-4-lite'][s].slice(0, 3).map((n) => t(n.slug)).join('; ') || '(none)'} |`);

// ---- judge side by side
const agg = (j) => { let c = 0, q = 0, bad = 0, w = 0; for (const r of j.results) for (const x of r.connections) { c++; q += x.quotes.total; bad += x.quotes.invalid.length; if (x.strength === 'weak') w++; } return { c, q, bad, w }; };
const as = agg(sonnet), ah = agg(haiku);
p('\n## 4. Judge: Sonnet 5.5 vs Haiku 4.5 (same candidates, same prompt)\n');
p('| | Sonnet | Haiku |\n|---|---|---|');
p(`| Connections returned | ${as.c} | ${ah.c} |`);
p(`| Marked weak | ${as.w} | ${ah.w} |`);
p(`| Quotes in explanations | ${as.q} | ${ah.q} |`);
p(`| Quotes NOT verbatim in a cited Note | ${as.bad} | ${ah.bad} |\n`);
p('Quotes flagged invalid are shown as **[INVALID: …]**. Read both sides and judge whether Haiku\'s explanations are good enough.\n');
const fmt = (c) => `${c.type}/${c.strength} → ${t(c.other)}: ${c.explanation}` + (c.quotes.invalid.length ? ` **[INVALID: ${c.quotes.invalid.join(' | ')}]**` : '');
for (const s of ORDER) {
  const a = sonnet.results.find((r) => r.slug === s), b = haiku.results.find((r) => r.slug === s);
  if (!a?.connections.length && !b?.connections.length) { p(`### ${t(s)}\n_No Connections from either model._\n`); continue; }
  p(`### ${t(s)} ${books[s].notes ? '(has Notes)' : '(no Notes)'}`);
  p('**Sonnet**'); (a?.connections ?? []).forEach((c) => p(`- ${fmt(c)}`)); if (!a?.connections.length) p('- (none)');
  p('\n**Haiku**'); (b?.connections ?? []).forEach((c) => p(`- ${fmt(c)}`)); if (!b?.connections.length) p('- (none)');
  p('');
}

// ---- density
p('## 5. Strength floor, per-run cap, candidate count\n');
p('Edges and degree are over all 19 Books. "Books with same-theme edge" is how many of the 17 themed Books got at least one edge to a same-theme Book. Isolated Books (The Course, Inverting the Pyramid) should have none.\n');
p('| Run / floor / cap | Edges | Mean degree | Max degree | Same-theme edge share | Themed Books with same-theme edge | Books with no Connections |\n|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(an.floorCapSweep)) p(`| ${k} | ${v.edges} | ${v.meanDegree} | ${v.maxDegree} | ${v.sameThemeEdgeShare} | ${v.themedBooksWithSameThemeEdge} | ${v.noConnections.map(t).join(', ')} |`);
p('\nThe judge token budget (600 vs 150 tokens per candidate) made no difference: every Note here is shorter than 150 tokens, so the prompts were identical.\n');

// ---- clusters
p('## 6. Clusters\n');
p('### Louvain resolution sweep (all 19 Books, Sonnet K=12, floor=moderate, cap=5)\n');
for (const [r, cl] of Object.entries(an.resolutionSweep)) p(`- **resolution ${r}**: ${cl.map((c) => `${c.size} Books [${c.themes}]`).join(' · ')}`);
p('\n### Replay: Books added one at a time (resolution 1, Jaccard match ≥ 0.5, rename at ≥ 30% change)\n');
for (const s of an.incremental) p(`- n=${s.n} +${t(s.added)} → ${s.clusters.length} Cluster(s). ${s.events.join(' · ') || '(no change)'}`);
const last = an.incremental.at(-1);
p('\n### Final Clusters (generated names and descriptions)\n');
for (const c of last.clusters) p(`- **${c.name}** (${c.members.map(t).join('; ')}). ${c.description}`);
out('REPORT.md', md.join('\n') + '\n');
console.log('wrote results/REPORT.md', md.join('\n').length, 'chars');
await (await import('./lib.mjs')).pool.end();
