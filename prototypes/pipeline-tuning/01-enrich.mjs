// PROTOTYPE step 1: Open Library lookup + Enrichment (Haiku used; Sonnet run for cost-per-tier and quality).
// Measures the low-confidence rule (no usable OL description, < 200 chars) per Book.
import { z } from 'zod';
import { BOOKS } from './data.mjs';
import { llm, saveJson, loadJson, spent } from './lib.mjs';
import fs from 'node:fs';

const UA = { 'User-Agent': 'marginalia-prototype' };
const LOW_CONF_CHARS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

async function openLibrary(b) {
  const q = new URLSearchParams({ title: b.title, author: b.author, limit: '5',
    fields: 'key,title,author_name,first_publish_year,subject,edition_count' });
  const s = await (await fetch(`https://openlibrary.org/search.json?${q}`, { headers: UA })).json();
  await sleep(1100);
  const doc = s.docs.find((d) => norm(d.title) === norm(b.title)) ?? s.docs[0];
  if (!doc) return { found: false };
  const w = await (await fetch(`https://openlibrary.org${doc.key}.json`, { headers: UA })).json();
  await sleep(1100);
  const d = typeof w.description === 'string' ? w.description : w.description?.value ?? '';
  return { found: true, ol_key: doc.key, ol_title: doc.title, year: doc.first_publish_year,
    description: d.trim(), subjects: (w.subjects ?? doc.subject ?? []).slice(0, 15) };
}

const Enrich = z.object({ summary: z.string(), themes: z.array(z.string()) });
const SYSTEM = `You write Enrichment for a personal reading app: a short summary and themes for one book.
- summary: 2-3 sentences on what the book is about and how it reads. Plain, specific, no marketing language.
- themes: 4-6 short phrases naming the book's central ideas and concerns.
Only state what you are confident is true about this specific book.`;

function userPrompt(b, ol, conservative) {
  return [
    `Title: ${b.title}`, `Author: ${b.author}`,
    `Open Library description: ${ol.description || '(none)'}`,
    `Open Library subjects: ${ol.subjects?.join('; ') || '(none)'}`,
    conservative
      ? 'Metadata is thin. Be conservative: do not invent plot details; if you do not clearly recognise this book, say so in the summary and give fewer, more general themes.'
      : '',
  ].filter(Boolean).join('\n');
}

const cachePath = new URL('./results/ol-cache.json', import.meta.url).pathname;
const olCache = fs.existsSync(cachePath) ? loadJson('ol-cache.json') : {};

const books = [];
for (const b of BOOKS) {
  if (!olCache[b.slug]) { olCache[b.slug] = await openLibrary(b); saveJson('ol-cache.json', olCache); }
  const ol = olCache[b.slug];
  const lowConf = !ol.found || ol.description.length < LOW_CONF_CHARS;
  const call = (tier, conservative, label) =>
    llm({ label, tier, system: SYSTEM, user: userPrompt(b, ol, conservative), schema: Enrich, maxTokens: 800 });
  const haiku = await call('haiku', lowConf, 'enrich:haiku');
  const sonnet = await call('sonnet', lowConf, 'enrich:sonnet');
  const haikuNormal = lowConf ? await call('haiku', false, 'enrich:haiku-normal') : null;
  books.push({ ...b, ol, lowConf, descChars: ol.description?.length ?? 0,
    enrichment: haiku.parsed, enrichmentSonnet: sonnet.parsed,
    enrichmentNormal: haikuNormal?.parsed ?? null,
    cost: { haiku: haiku.usd, sonnet: sonnet.usd } });
  console.log(`${lowConf ? 'LOW ' : 'ok  '} ${String(books.at(-1).descChars).padStart(5)}ch  ${b.title}`);
}
saveJson('books.json', books);
console.log(`\nflagged ${books.filter((b) => b.lowConf).length}/${books.length}; ledger total $${spent().toFixed(3)}`);
await (await import('./lib.mjs')).pool.end();
