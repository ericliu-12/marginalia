# Embeddings provider for connection candidates

Resolves GitHub issue #2. Researched 2026-10-01. All sources are first-party docs; fetched on that date.

## Recommendation

Use **Voyage AI `voyage-4`** (or `voyage-4-lite` if cost or latency matters more) at **1024 dimensions**, stored as pgvector `vector(1024)` with an **HNSW cosine** index. Embed **both Enrichment and Notes**, as separate vectors. Anthropic's own docs point to Voyage as the embeddings option to use alongside Claude.

OpenAI `text-embedding-3-small` is a reasonable fallback. It is just as cheap but has no shared-space upgrade path and a smaller context window.

## Why Voyage

- Anthropic offers no embedding model and names Voyage AI as its suggested provider ([Anthropic embeddings docs](https://platform.claude.com/docs/en/build-with-claude/embeddings), accessed 2026-10-01). It also says to "assess a variety of embeddings vendors."
- The voyage-4 family (`voyage-4-large`, `voyage-4`, `voyage-4-lite`, open-weight `voyage-4-nano`) shares one embedding space. Documents can be indexed with a bigger model and queried with a smaller one, so you can start cheap and upgrade without re-embedding everything ([Voyage 4 post, 2026-01-15](https://blog.voyageai.com/2026/01/15/voyage-4/)).
- Voyage claims `voyage-4-large` beats OpenAI `text-embedding-3-large` by an average of 14.05% NDCG on RTEB across 29 datasets (same post). This is a vendor claim. No independent benchmark on book themes or personal notes was found, so validate on real data (see Open items).

## Comparison

| | voyage-4-lite | voyage-4 | voyage-4-large | OpenAI text-embedding-3-small | OpenAI text-embedding-3-large |
|---|---|---|---|---|---|
| Price / 1M tokens | $0.02 | $0.06 | $0.12 | $0.02 | $0.13 |
| Free allowance | 200M tokens | 200M | 200M | none stated | none stated |
| Default dims | 1024 | 1024 | 1024 | 1536 | 3072 |
| Selectable dims | 256, 512, 1024, 2048 | same | same | any via `dimensions` param | any via `dimensions` param |
| Max input | 32K tokens | 32K | 32K | 8192 | 8192 |
| Quantization | float/int8/binary | same | same | no | no |
| Tier 1 rate limit | 16M TPM, 2000 RPM | 8M TPM, 2000 RPM | 3M TPM, 2000 RPM | not found in public docs | not found in public docs |
| MTEB (vendor-reported) | not published | not published | not published | 62.3% | 64.6% |

Sources: Voyage [models](https://docs.voyageai.com/docs/embeddings), [pricing](https://docs.voyageai.com/docs/pricing), [rate limits](https://docs.voyageai.com/docs/rate-limits); OpenAI [embeddings guide](https://developers.openai.com/api/docs/guides/embeddings), [pricing](https://developers.openai.com/api/docs/pricing). All accessed 2026-10-01. OpenAI's rate-limits guide says per-model limits are shown in the account dashboard, so they could not be verified publicly.

Cost at personal scale: even 1,000 Books at about 500 tokens of Enrichment plus 10,000 Notes at about 150 tokens is roughly 2M tokens. That is free under Voyage's 200M allowance, and under $0.30 on any paid model above. Cost does not drive this decision. Rate limits at Tier 1 are far above single-user needs.

## pgvector compatibility

From the [pgvector README](https://github.com/pgvector/pgvector/blob/master/README.md) (v0.8.x, accessed 2026-10-01):

- `vector` columns hold up to 16,000 dimensions, but **HNSW and IVFFlat indexes on `vector` cap at 2,000 dimensions**. `halfvec` indexes up to 4,000, and `bit` up to 64,000.
- Consequences: Voyage at 1024 and OpenAI-small at 1536 index fine as `vector`. Voyage at 2048 and OpenAI-large at its default 3072 cannot be indexed as `vector`. They would need `halfvec` or fewer dimensions.
- Operators: `<=>` is cosine, `<#>` is negative inner product. Voyage embeddings are unit-normalized, so cosine, dot product and L2 all rank identically ([Anthropic/Voyage FAQ](https://platform.claude.com/docs/en/build-with-claude/embeddings)).
- **Index choice: HNSW.** It needs no training step and works on an empty table. IVFFlat needs data present at build time to pick good lists, which suits a library that starts empty poorly. At hundreds to a few thousand vectors even a sequential scan is fast, so the index is a nicety.
- Neon documents pgvector support, including HNSW ([Neon pgvector docs](https://neon.com/docs/extensions/pgvector)). Neon notes its version can be one behind the latest pgvector. Local Docker should use a `pgvector/pgvector` image.

## What to embed

Embed both, as separate rows, keeping each vector tied to its source:

1. **Enrichment** (one vector per Book: summary plus themes concatenated). This covers the Book-to-Book candidate pass, including Books with no Notes. Embedding Enrichment text rather than raw titles or descriptions matches the themes the Claude judge reasons about.
2. **Notes** (one vector per Note, with its quoted passage if any). Notes are short, personal and often vague. Retrieving Note-to-Note and Note-to-Enrichment matches is what lets a Connection explanation quote the reader's own words, which PRODUCT.md names as the core positioning. Do not average Notes into the Book vector. That blurs the specific thought.

Candidate retrieval for a newly read Book: query with its Enrichment vector and each of its Notes against all other Books' Enrichment and Notes, aggregate by Book, and pass the top N to Claude to judge and explain.

Suggested schema details:
- Record `model` and `dimensions` beside each vector. With Voyage's shared space, a model upgrade of the query side needs no re-index. Switching families does.
- Use `input_type="document"` when storing and `"query"` when searching. Voyage says not to omit it.
- Notes are short and the 32K context handles any Enrichment, so no chunking is needed for the MVP.

## Tradeoffs

- **Voyage:** an extra vendor and API key, and a smaller ecosystem than OpenAI. In return you get a 200M free allowance, a larger context window, a shared-space upgrade path, and a vendor Anthropic points to.
- **OpenAI small:** the most familiar API and the same price. It has a smaller context window, a lower reported MTEB score, no shared-space property, and no free allowance.
- **1024 vs 2048 dims:** 1024 is the default and is plenty at this scale. 2048 exceeds the 2,000-dimension index cap for `vector`, so avoid it unless using `halfvec`.
- **Provider lock-in:** vectors are not portable across providers. Keep the source text so re-embedding stays cheap, which at this scale is cents.

## Open items

- No primary-source benchmark covers long-form book themes versus short personal notes. Before locking in, run a small bake-off on about 20 real Books and Notes once data exists, comparing `voyage-4-lite`, `voyage-4` and `text-embedding-3-small` by eyeballing top-5 candidates.
- OpenAI per-model rate limits were not publicly documented. This is irrelevant at single-user scale.
- Voyage pricing and model lineup change often. Re-check the [pricing page](https://docs.voyageai.com/docs/pricing) before building.
