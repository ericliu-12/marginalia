// PROTOTYPE step 1 (p2): description source (SRC=ol|gb) + Enrichment on Haiku.
// Open Library always supplies identity; SRC decides where the description comes from.
// p2 changes: the model reports `recognised`, the length-based low-confidence rule is gone, and
// Enrichment avoids character names and plot details unless confident.
//   SRC=ol node 01-enrich.mjs     SRC=gb node 01-enrich.mjs
import fs from 'node:fs';
import { z } from 'zod';
import { BOOKS } from './data.mjs';
import { llm, saveJson, loadJson, spent } from './lib.mjs';

const SRC = process.env.SRC ?? 'ol';
const UA = { 'User-Agent': 'marginalia-prototype' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
const stripHtml = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const resPath = (n) => new URL('./results/' + n, import.meta.url).pathname;
const readCache = (n) => (fs.existsSync(resPath(n)) ? loadJson(n) : {});

// ---- Open Library (identity, subjects; description when SRC=ol). Cache is shared with p1.
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

// ---- Google Books description: match title + primary author, prefer the original work.
const BAD_TITLE = /study guide|summary|sparknotes|cliffs|analysis|graphic novel|workbook|companion|box set|collection|critical|essays|notes on/i;
const BAD_CAT = /study aids|comics|graphic novels|literary criticism|language arts/i;
async function googleBooks(b) {
  const lastName = norm(b.author).split(' ').at(-1);
  const q = `${b.title} ${b.author}`; // field-restricted intitle:/inauthor: queries returned 0 results
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=20&langRestrict=en&key=${process.env.GOOGLE_BOOKS_API_KEY}`;
  let res;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(url);
    if (res.ok || attempt >= 4 || ![429, 503].includes(res.status)) break;
    await sleep(2000 * attempt);
  }
  if (!res.ok) throw new Error(`google books ${res.status}`);
  const items = (await res.json()).items ?? [];
  const cands = items.map((it) => {
    const v = it.volumeInfo ?? {};
    const desc = stripHtml(v.description ?? '');
    const titleOk = norm(v.title ?? '').startsWith(norm(b.title).slice(0, 18)) || norm(b.title).startsWith(norm(v.title ?? '').slice(0, 18));
    const authorOk = (v.authors ?? []).some((a) => norm(a).includes(lastName));
    const bad = BAD_TITLE.test(`${v.title} ${v.subtitle ?? ''}`) || BAD_CAT.test((v.categories ?? []).join(' '));
    return { id: it.id, title: v.title, subtitle: v.subtitle, authors: v.authors, published: v.publishedDate,
      categories: v.categories, lang: v.language, desc, descChars: desc.length, titleOk, authorOk, bad };
  });
  const good = cands.filter((c) => c.titleOk && c.authorOk && !c.bad && c.lang === 'en' && c.descChars > 0);
  good.sort((a, c) => c.descChars - a.descChars);
  return { query: q, picked: good[0] ?? null, considered: cands.length,
    rejected: cands.filter((c) => !good.includes(c)).slice(0, 5).map((c) => ({ title: c.title, authors: c.authors, why: c.bad ? 'adaptation/guide' : !c.titleOk ? 'title' : !c.authorOk ? 'author' : c.lang !== 'en' ? 'not English' : 'no description' })) };
}

const Enrich = z.object({ recognised: z.boolean(), summary: z.string(), themes: z.array(z.string()) });
const SYSTEM = `You write Enrichment for a personal reading app: a short summary and themes for one book.
- recognised: true only if you clearly recognise this specific book, the work itself and not an adaptation, study guide or similarly titled book, from the metadata provided or your own knowledge. If false, set summary to "" and themes to [].
- summary: 2-3 sentences on what the book is about and how it reads. Plain, specific, no marketing language.
- themes: 4-6 short phrases naming the book's central ideas and concerns.
- Do not name characters, and do not state plot events, unless you are confident they are correct for this book. Prefer describing premise, setting, form and ideas.
Only state what you are confident is true about this specific book.`;

const olCache = readCache('ol-cache.json');
const gbCachePath = 'gb-cache.json';
const gbCache = readCache(gbCachePath);
const books = [];
for (const b of BOOKS) {
  if (!olCache[b.slug]) { olCache[b.slug] = await openLibrary(b); saveJson('ol-cache.json', olCache); }
  const ol = olCache[b.slug];
  let desc = ol.description ?? '', descFrom = 'Open Library', gb = null;
  if (SRC === 'gb') {
    if (!gbCache[b.slug]) { gbCache[b.slug] = await googleBooks(b); saveJson(gbCachePath, gbCache); await sleep(300); }
    gb = gbCache[b.slug];
    desc = gb.picked?.desc ?? ''; descFrom = gb.picked ? `Google Books (${gb.picked.title})` : 'none';
  }
  const user = [`Title: ${b.title}`, `Author: ${b.author}`,
    `Description: ${desc || '(none)'}`, `Subjects: ${ol.subjects?.join('; ') || '(none)'}`].join('\n');
  const r = await llm({ label: `enrich:${SRC}`, tier: 'haiku', system: SYSTEM, user, schema: Enrich, maxTokens: 800 });
  books.push({ ...b, ol, gb, desc, descFrom, descChars: desc.length, enrichment: r.parsed, enrichCost: r.usd, enrichUsage: r.usage });
  console.log(`${r.parsed.recognised ? 'ok     ' : 'UNKNOWN'} ${String(desc.length).padStart(5)}ch  ${b.title}  <- ${descFrom}`);
}
saveJson(`p2-${SRC}-books.json`, books);
console.log(`\nunrecognised ${books.filter((b) => !b.enrichment.recognised).length}/${books.length}; ledger total $${spent().toFixed(3)}`);
await (await import('./lib.mjs')).pool.end();
