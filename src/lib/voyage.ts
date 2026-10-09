import type { Embedder } from "@/domain/embeddings";
import type { SpendLog } from "@/domain/spend";
import { EMBEDDING_DIMENSIONS, MODELS } from "./models";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
// $ per 1M tokens, list price. The account's free tokens are not counted, so this overstates early spend.
const PRICE_PER_MILLION = 0.06;

export function voyageEmbedder(apiKey = process.env.VOYAGE_API_KEY, fetchImpl: typeof fetch = fetch, spend?: SpendLog): Embedder {
  // Fail at startup, not on the first job.
  if (!apiKey) throw new Error("VOYAGE_API_KEY is not set.");
  const model = MODELS.embedding;
  return {
    model,
    async embed(texts, inputType) {
      const res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: texts, model, input_type: inputType, output_dimension: EMBEDDING_DIMENSIONS }),
      });
      if (!res.ok) throw new Error(`Voyage embeddings failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const { data, usage } = (await res.json()) as { data: { index: number; embedding: number[] }[]; usage?: { total_tokens: number } };
      const tokens = usage?.total_tokens ?? 0;
      await spend?.record({ provider: "voyage", model, purpose: "embedding", inputTokens: tokens, outputTokens: 0, costUsd: (tokens * PRICE_PER_MILLION) / 1e6 });
      const vectors = [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error(`Voyage returned an unexpected shape for ${texts.length} texts`);
      }
      return vectors;
    },
  };
}
