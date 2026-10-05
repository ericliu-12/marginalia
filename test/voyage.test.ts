import { describe, expect, it } from "vitest";
import { voyageEmbedder } from "../src/lib/voyage";

const vec = (x: number) => Array.from({ length: 1024 }, (_, i) => (i === 0 ? x : 0));
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("Voyage embedder", () => {
  it("asks for 1024-dimension vectors with the input type, and returns them in input order", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const embedder = voyageEmbedder("key", async (url, init) => {
      sent = { url: String(url), init: init! };
      return new Response(JSON.stringify({ data: [{ index: 1, embedding: vec(2) }, { index: 0, embedding: vec(1) }] }));
    });
    const out = await embedder.embed(["a", "b"], "query");
    expect(out.map((v) => v[0])).toEqual([1, 2]);
    expect(sent!.url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(JSON.parse(sent!.init.body as string)).toEqual({ input: ["a", "b"], model: embedder.model, input_type: "query", output_dimension: 1024 });
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe("Bearer key");
  });

  it("throws on an error status or a wrong-sized vector, so the queue retries", async () => {
    await expect(voyageEmbedder("k", reply({ detail: "rate limited" }, 429)).embed(["a"], "document")).rejects.toThrow(/429/);
    await expect(voyageEmbedder("k", reply({ data: [{ index: 0, embedding: [1, 2] }] })).embed(["a"], "document")).rejects.toThrow(/unexpected shape/);
  });

  it("refuses to start without an API key", () => {
    expect(() => voyageEmbedder("")).toThrow(/VOYAGE_API_KEY/);
  });
});
