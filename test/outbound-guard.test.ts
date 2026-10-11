import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { voyageEmbedder } from "../src/lib/voyage";
import { guardedHost, takeBlockedRequests } from "./outbound-guard.mjs";

// The guard (test/outbound-guard.mjs, loaded by test/setup.ts) fails any test that calls a paid or
// real-user API. These calls are blocked on purpose, so each test takes its blocked requests back
// before the after-each check sees them.

describe("outbound guard", () => {
  it.each([
    "https://api.anthropic.com/v1/messages",
    "https://api.voyageai.com/v1/embeddings",
    "https://api.resend.com/emails",
    "https://www.googleapis.com/books/v1/volumes?q=x",
    "https://oauth2.googleapis.com/token",
    "https://accounts.google.com/o/oauth2/v2/auth",
  ])("refuses %s, naming the host", async (url) => {
    const host = new URL(url).hostname;
    await expect(fetch(url)).rejects.toThrow(`Blocked outbound request to ${host}`);
    expect(takeBlockedRequests()).toEqual([host]);
  });

  it("trips through the Anthropic SDK and the Voyage embedder's default fetch", async () => {
    const claude = new Anthropic({ apiKey: "test-no-calls", maxRetries: 0 });
    const call = claude.messages.create({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] });
    await expect(call).rejects.toMatchObject({ cause: { message: expect.stringContaining("Blocked outbound request to api.anthropic.com") } });
    await expect(voyageEmbedder("test-no-calls").embed(["a"], "query")).rejects.toThrow("Blocked outbound request to api.voyageai.com");
    expect(takeBlockedRequests()).toEqual(["api.anthropic.com", "api.voyageai.com"]);
  });

  it("leaves other hosts alone", () => {
    expect(guardedHost("http://localhost:3100/api/search")).toBeNull();
    expect(guardedHost("https://openlibrary.org/search.json")).toBeNull();
    expect(guardedHost("https://challenges.cloudflare.com/turnstile/v0/siteverify")).toBeNull();
    expect(guardedHost("https://notgoogleapis.com/")).toBeNull();
    expect(guardedHost("/api/search")).toBeNull();
  });
});
