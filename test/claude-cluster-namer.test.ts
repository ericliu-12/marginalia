import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { claudeClusterNamer, CLUSTER_NAMING_PROMPT_VERSION, clusterNamingPrompt } from "../src/lib/claude";
import { MODELS } from "../src/lib/models";

const input = {
  previous: { name: "Quiet Lives", description: "Books about quiet lives." },
  books: [
    { title: "Stoner", authors: ["John Williams"], themes: ["work", "solitude"] },
    { title: "Lonely", authors: [], themes: [] },
  ],
  connections: [{ a: "Stoner", b: "Lonely", explanation: "Both are quiet." }],
};

function clientReplying(parsed_output: unknown) {
  const calls: { model: string }[] = [];
  const client = {
    messages: {
      async parse(req: { model: string }) {
        calls.push(req);
        return { parsed_output, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("Claude Cluster namer", () => {
  it("lays out the previous name, the Books with their themes, and the Connections", () => {
    const prompt = clusterNamingPrompt(input);
    expect(prompt).toContain("PREVIOUS NAME: Quiet Lives\nPREVIOUS DESCRIPTION: Books about quiet lives.");
    expect(prompt).toContain("- Stoner by John Williams; themes: work; solitude\n- Lonely by (unknown); themes: (unavailable)");
    expect(prompt).toContain("CONNECTIONS\n- Stoner / Lonely: Both are quiet.");
    expect(clusterNamingPrompt({ ...input, previous: null })).toContain("PREVIOUS NAME: (none, a new Cluster)\n\nBOOKS");
  });

  it("returns the name and description with tokens and cost, on the naming model", async () => {
    const { client, calls } = clientReplying({ name: "Lives Held Still", description: "Two quiet books." });
    const namer = claudeClusterNamer(client);
    expect(namer.promptVersion).toBe(CLUSTER_NAMING_PROMPT_VERSION);
    expect(await namer.name(input)).toEqual({
      name: "Lives Held Still",
      description: "Two quiet books.",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd: (1000 * 2 + 100 * 10) / 1e6,
    });
    expect(calls[0].model).toBe(MODELS.clusterNaming);
  });

  it("throws on output it could not parse", async () => {
    await expect(claudeClusterNamer(clientReplying(null).client).name(input)).rejects.toThrow(/Unparsed Cluster naming output/);
  });
});
