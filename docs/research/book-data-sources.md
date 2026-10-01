# Book data sources: what Open Library and Google Books actually return

Resolves issue #3. Research date: 2026-10-01. Live calls were made without API keys, one at a time, with a `User-Agent` of the form `Marginalia-research/0.1 (contact email)`, about 1 request per second, roughly 20 calls total.

## Summary

| Need | Open Library | Google Books |
|---|---|---|
| Identify a Book (work-level) | Reliable. Search returns works, with a stable `/works/OL…W` key. | Volume-level (an edition), no work concept. Not tested live (see Quota). |
| Description | Present for popular works, often missing for obscure or translated ones. Format varies (string or `{type,value}`). | Documented field `description`, usually the strongest of the two. Not verified live. |
| Subjects | Present but noisy: mixed languages, call numbers, award tags, duplicate FAST strings. | `categories` is documented, coarse. Not verified live. |
| Authors | Names in search, keys to author records. Author records can be bare. | `authors` array of strings only. |
| Covers | Free by ID, ISBN or OLID. Placeholder behaviour needs `?default=false`. | `imageLinks`, several sizes. |
| Rate limits | 1 req/s anonymous, 3 req/s identified. Cover-by-ISBN: 100 req/IP per 5 min. | Keyless calls returned HTTP 429 in testing. A key is required. |
| Terms | Open data. No bulk crawling via the API, dumps available. | Google API ToS. Free-use only unless Google agrees otherwise. |

**Reliable:** title, primary author, first publish year, cover, and (for well-known works) a usable description and a usable subject list from Open Library.
**Thin:** descriptions for obscure and translated works, clean subjects, anything about the translated/original-language relationship, ratings, page counts at work level, author biographies.

Implication for Marginalia: Open Library is a good identity and cover source and is the right primary. Its subjects should not be used as Enrichment themes directly. The Enrichment step (Claude) should generate themes and treat Open Library subjects as hints. Google Books as a description and cover fallback needs an API key, which contradicts "no key" in PRODUCT.md. This is the main finding to act on.

## Open Library

### Search endpoint (`/search.json`)

Docs (https://openlibrary.org/dev/docs/api/search, fetched 2026-10-01): results are works by default, not editions. `fields=` selects returned fields. Pagination is `limit`/`offset` or `limit`/`page`. `lang` only biases results, it does not filter. Queries are Solr syntax.

Observed:

- **Stoner** (`q=stoner john williams`): `/works/OL3511459W`, author John Williams, first published 1965, 49 editions, languages listed across 15 (ger, rum, dut, ita, cat, spa, nob, pol, rus, fre, eng, chi, por, swe, dan), cover ID present, and 23 subjects (e.g. "College teachers", "Missouri, fiction", "Adultery"). Two further hits are separate works for the same book: a Greek edition titled "Ο Στόουνερ" (1 edition) and a second English "Stoner" (2014, 1 edition, no subjects). **Duplicate works for one Book are normal.**
- **The Remains of the Day** (`q=... ishiguro`): `/works/OL59048W`, 87 editions, first publish year 1989. Subjects include useful ones ("Butlers", "Household employees", "Country homes") alongside noise: award tags (`award:man_booker_prize=1989`), a Library of Congress call number (`Pr6059.s5 r46 1993x`), and Danish and French strings ("Samfundsskildringer", "Employés de maison"). A second work "Remains of the Day" (2000, 1 edition) is a duplicate. Searching without the author name found the work (top hit) too.
- **Austerlitz** (Sebald, translated from German): `/works/OL46615W`, authors `["W. G. Sebald","Anthea Bell"]`. The translator is listed as an author. Subjects include raw FAST strings with URIs ("Holocaust, Jewish (1939-1945) fast (OCoLC)fst00958866 (uri) http://id.worldcat.org/...").
- **Kallocain** (Karin Boye, Swedish, 1940): three works. The 1952 work (`OL1265023W`, 11 editions, first publish 1952, languages swe/eng/por/ita/ger) is the English translation, while the Swedish original is a separate work `OL24681944W` (1940, `swe` only). A third (`OL21333571W`) credits translator David McDuff as author. **Translation and original are not unified at work level**, which matters for a Marginalia Book, which ignores editions and translations.
- **The Wind-Up Bird Chronicle** (Murakami): `q=wind-up bird chronicle murakami` did not return the novel. The hits were a critical study, a Korean-language work (title romanised "T'aeyŏp kamnŭn sae", author 村上春樹) and an unrelated anthology. A structured query (`title=wind-up bird chronicle&author=murakami`) found `OL25111252W` with only 2 editions, authors "Jay Rubin" (the translator) and "村上春樹". **Translated titles can fail free-text search and need a fallback query form, and author data mixes translators and native-script names.**
- **Obscure translated title** (`the bridge of beyond simone schwarz-bart`): the English title was not matched. The result at the top was the French original, "Pluie et vent sur Télumée Miracle" (`OL4666925W`, 11 editions), found via the author name. The other hits were scholarship. A reader who types the English title gets no direct hit.

### Work endpoint (`/works/OL…W.json`)

- Stoner: `description` is an object `{"type":"/type/text","value":"..."}` with a full publisher blurb, plus `links` to reviews, `subject_places`, `subject_people`, and `covers` (4 IDs).
- Remains of the Day: `description` is a plain **string** (a different shape from Stoner), `covers` has 19 IDs, `first_publish_date` reads "1994", while the search endpoint says 1989 (first publish year disagrees between endpoints/records).
- Kallocain (`OL1265023W`): **no `description` at all**. Only title, 4 subjects ("Scientists", "Fiction", "Swedish fiction", "Translations into English"), one cover, and Dewey number.
- `/works/OL59048W/ratings.json`: average 4.21 from 28 ratings. Ratings are sparse and not useful as a quality signal.
- Author records (`/authors/OL…A.json`) are linked by key from the work. I did not retrieve a verified author record for the books above, so author-data depth is not confirmed here. Read the author record docs before relying on bios.

The description field type varies, so parsing code must handle both `string` and `{value}`, and also absence.

### Rate limits and terms

Docs (https://openlibrary.org/developers/api, fetched 2026-10-01):

- 1 request per second by default, 3 per second if the app sends a `User-Agent` with app name and contact email.
- "Please do not use our APIs to bulk download metadata"; use the monthly dumps instead. Hundreds of single-book requests, scraping HTML and distributing requests across IPs are called out as prohibited, with "aggressive rate limiting or blocking" as the consequence.

Covers docs (https://openlibrary.org/dev/docs/api/covers, fetched 2026-10-01): URL `https://covers.openlibrary.org/b/{key}/{value}-{S|M|L}.jpg`. Lookup by ISBN, OCLC, LCCN is limited to 100 requests per IP per 5 minutes (403 beyond that). Lookup by cover ID is the alternative. A blank image is returned for a missing cover unless `?default=false` (then 404). Don't crawl, and add a courtesy link back.

Licensing (https://openlibrary.org/developers/licensing, fetched 2026-10-01): "The Internet Archive does not assert any new copyright or other proprietary rights over any of the material in the Open Library database." The page gives no explicit licence name for data or covers, and individual cover images may carry their own rights. This was not resolved from the primary source and needs a closer read before shipping cover hotlinking at scale.

A single-user MVP with a lookup per added Book sits far below these limits. Use the cover ID from the work, and store it, rather than calling the ISBN cover endpoint repeatedly.

## Google Books

Docs: https://developers.google.com/books/docs/v1/using (fetched 2026-10-01).

- Search: `q` supports `intitle:`, `inauthor:`, `inpublisher:`, `subject:`, `isbn:`, `lccn:`, `oclc:`. `langRestrict` takes ISO-639-1. `maxResults` default 10, max 40.
- Volume fields: title, authors, publisher, publishedDate, description, categories, industryIdentifiers, pageCount, imageLinks (thumbnail up to extraLarge), language, averageRating, ratingsCount, and `accessInfo` for ebook availability.
- Results are **volumes (editions)**, not works, so deduplicating to a Book is Marginalia's job.
- Google "respects copyright, contract, and other legal restrictions associated with the end user's location", so results and previews vary by IP.
- Public-data requests must carry an API key or OAuth token ("a request that does not provide an OAuth 2.0 token must send an API key"; see also the Getting Started page, which says public requests need "an identifier, such as an API key").

**Live result: unusable keyless.** Three keyless calls (a title+author search, an ISBN search and a bare keyword search) all returned HTTP 429 `RATE_LIMIT_EXCEEDED` with `quota_limit: defaultPerDayPerProject`, `quota_limit_value: "0"` on a shared Google project. So I have **no live Google Books payloads** and the field coverage above is from documentation only, not observed. Whether a free key gives usable descriptions for Stoner, Austerlitz or Kallocain still needs testing with a key (open question below).

Default per-key quota figures were not found in the pages fetched. Check the Google Cloud console quota page for the real number before depending on it.

Terms (https://developers.google.com/books/terms, page dated 2012-04-25): you may not charge users a fee for the application without Google's agreement, you must remove infringing content on request, and users must be told that submitted content may be public. Caching and attribution rules are not on that page, so they sit in the general Google APIs Terms of Service, which I did not read. Treat as unresolved.

## Where metadata is thin

1. **Descriptions** for translated and obscure works (Kallocain has none in Open Library). Plan on Claude-generated Enrichment as the main summary source, not on these APIs.
2. **Subjects**: noisy and multilingual in Open Library. Needs filtering (drop strings with call numbers, `award:`, `nyt:`, `fast (OCoLC)`, `(uri)`) or ignoring.
3. **Work identity across translations**: original and translation are separate works, and translators are often listed as authors. Marginalia's Book (editions ignored) will need its own dedupe or a pick-the-best-hit rule.
4. **Free-text search** can miss a translated work whose indexed title is in another language (Wind-Up Bird, Bridge of Beyond). Searching title+author together helps.
5. **Duplicate works** for the same book (Stoner, Remains of the Day).
6. **Date disagreement**: search says 1989, work record says "1994" for Remains of the Day.
7. **Ratings** are sparse.

## Open questions

- What do Google Books responses look like for these same titles with a free key, and what is the default daily quota?
- Open Library edition-level data (`/works/{id}/editions.json`, ISBN lookup) and author records were not examined, so it is open whether they fix translator and original-language confusion.
- Google Books caching and attribution limits (general Google APIs ToS).
- Open Library cover rights for third-party scans.

## Sources (all fetched 2026-10-01)

- https://openlibrary.org/developers/api
- https://openlibrary.org/dev/docs/api/search
- https://openlibrary.org/dev/docs/api/covers
- https://openlibrary.org/developers/licensing
- https://developers.google.com/books/docs/v1/using
- https://developers.google.com/books/docs/v1/getting_started
- https://developers.google.com/books/terms
- Live calls to `openlibrary.org/search.json`, `/works/*.json`, and `googleapis.com/books/v1/volumes`, 2026-10-01.
