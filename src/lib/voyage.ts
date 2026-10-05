import type { Embedder } from "@/domain/embeddings";
import { EMBEDDING_DIMENSIONS, MODELS } from "./models";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";

export function voyageEmbedder(apiKey = process.env.VOYAGE_API_KEY, fetchImpl: typeof fetch = fetch): Embedder {
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
      const { data } = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const vectors = [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== texts.length || vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)) {
        throw new Error(`Voyage returned an unexpected shape for ${texts.length} texts`);
      }
      return vectors;
    },
  };
}
