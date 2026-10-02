// Model ids live here so swapping a model is a data change, not a rewrite.
export const MODELS = {
  enrichment: "claude-haiku-4-5-20251001",
  judge: "claude-sonnet-5-5",
  clusterNaming: "claude-sonnet-5-5",
  embedding: "voyage-4",
} as const;

export const EMBEDDING_DIMENSIONS = 1024;
