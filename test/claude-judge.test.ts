import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { claudeJudge, JUDGE_PROMPT_VERSION, judgePrompt } from "../src/lib/claude";

const input = {
  book: { title: "Stoner", authors: ["John Williams"], enrichment: "A professor's life.", notes: [{ id: "n1", body: "Quiet and sad." }] },
  candidates: [{ id: "C1", title: "Lonely", authors: [], enrichment: null, notes: [] }],
};

function clientReplying(parsed_output: unknown) {
  const calls: unknown[] = [];
  const client = {
    messages: {
      async parse(req: unknown) {
        calls.push(req);
        return { parsed_output, stop_reason: "end_turn", usage: { input_tokens: 2000, output_tokens: 500 } };
      },
    },
  } as unknown as Anthropic;
  return { client, calls };
}

describe("Claude Connection judge", () => {
  it("lays the Books out for the model, with unavailable Enrichment and missing Notes said plainly", () => {
    const prompt = judgePrompt(input);
    expect(prompt).toContain("NEWLY FINISHED BOOK\nStoner by John Williams\nEnrichment: A professor's life.");
    expect(prompt).toContain("  [n1] Quiet and sad.");
    expect(prompt).toContain("[C1] Lonely by (unknown)\n  Enrichment: (unavailable)\n  Notes:\n  (no Notes)");
  });

  it("returns the model's Connections with tokens and cost, and the prompt version", async () => {
    const { client, calls } = clientReplying({
      connections: [{ candidate_id: "C1", type: "contrast", strength: "weak", explanation: "x", quoted_note_ids: ["n1"] }],
    });
    const judge = claudeJudge(client);
    const result = await judge.judge(input);
    expect(judge.promptVersion).toBe(JUDGE_PROMPT_VERSION);
    expect(result).toEqual({
      connections: [{ candidateId: "C1", type: "contrast", strength: "weak", explanation: "x", quotedNoteIds: ["n1"] }],
      inputTokens: 2000,
      outputTokens: 500,
      costUsd: (2000 * 2 + 500 * 10) / 1e6,
    });
    expect(calls).toHaveLength(1);
  });

  it("throws on output it could not parse, so the queue retries", async () => {
    await expect(claudeJudge(clientReplying(null).client).judge(input)).rejects.toThrow(/Unparsed judge output/);
  });
});
