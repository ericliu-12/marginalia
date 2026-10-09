import type { ClusterNamer, NamingInput, NamingResult } from "../src/domain/clusters";
import type { ConnectionJudge, JudgeInput, JudgeResult } from "../src/domain/connections";
import type { Embedder } from "../src/domain/embeddings";
import { EMBEDDING_DIMENSIONS } from "../src/lib/models";
import type { EnrichmentModel, EnrichmentResult } from "../src/domain/enrichment";
import type { DescriptionGateway, GoogleBooksVolume } from "../src/domain/description";
import type { BookSearchGateway, OpenLibraryWork } from "../src/domain/search";

export function work(overrides: Partial<OpenLibraryWork> & { workKey: string }): OpenLibraryWork {
  return {
    title: "Untitled",
    authors: ["Anon"],
    firstPublishedYear: 2000,
    editionCount: 1,
    coverId: null,
    subjects: [],
    ...overrides,
  };
}

// Fake Open Library: returns the given works for any query and records queries.
export function fakeGateway(works: OpenLibraryWork[]): BookSearchGateway & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async searchWorks(query) {
      queries.push(query);
      return works;
    },
  };
}

const ENGLISH_FILLER = "The story follows her life and the people that she knew, as he said with care. ";
// Exactly `chars` long and ending in a non-space, so description trimming leaves it unchanged.
export const prose = (chars: number) =>
  ENGLISH_FILLER.repeat(Math.ceil(chars / ENGLISH_FILLER.length)).slice(0, chars - 1).trimEnd().padEnd(chars - 1, "x") + ".";

export function volume(id: string, v: NonNullable<GoogleBooksVolume["volumeInfo"]>): GoogleBooksVolume {
  return { id, volumeInfo: { title: "Stoner", authors: ["John Williams"], language: "en", description: prose(600), ...v } };
}

// Fake Google Books and Open Library descriptions; records calls. `gbError`/`olError` simulate outages;
// set `gbError` after adding a Book to have Google go down before it is enriched.
export function fakeDescriptions(opts: {
  volumes?: GoogleBooksVolume[];
  openLibrary?: string;
  gbError?: boolean;
  olError?: boolean;
}): DescriptionGateway & { queries: string[]; volumeCalls: string[]; olCalls: string[]; opts: typeof opts } {
  const queries: string[] = [];
  const volumeCalls: string[] = [];
  const olCalls: string[] = [];
  return {
    queries,
    volumeCalls,
    olCalls,
    opts,
    async googleBooksVolume(id) {
      volumeCalls.push(id);
      const found = opts.volumes?.find((v) => v.id === id);
      if (opts.gbError || !found) throw new Error(opts.gbError ? "Google Books is down" : "Google Books failed: 404");
      return found;
    },
    async googleBooksVolumes(q) {
      queries.push(q);
      if (opts.gbError) throw new Error("Google Books is down");
      return opts.volumes ?? [];
    },
    async openLibraryDescription(key) {
      olCalls.push(key);
      if (opts.olError) throw new Error("Open Library is down");
      return opts.openLibrary ?? "";
    },
  };
}

export type EnrichInput = { title: string; authors: string[]; description: string; subjects: string[] };

// Fake Claude for Enrichment: answers with `reply` (author/year default to the Book's own), records inputs.
export function fakeEnricher(
  reply: Partial<EnrichmentResult> | ((input: EnrichInput) => Partial<EnrichmentResult> | Promise<Partial<EnrichmentResult>>) = {},
): EnrichmentModel & { inputs: EnrichInput[] } {
  const inputs: EnrichInput[] = [];
  return {
    inputs,
    model: "fake-haiku",
    promptVersion: "test-1",
    async enrich(input) {
      inputs.push(input);
      const r = typeof reply === "function" ? await reply(input) : reply;
      return {
        recognised: true,
        summary: "A quiet novel about a life.",
        themes: ["work", "solitude"],
        author: input.authors[0] ?? null,
        firstPublishedYear: null,
        inputTokens: 300,
        outputTokens: 100,
        costUsd: 0.0008,
        ...r,
      };
    },
  };
}

// Fake Voyage: a text's vector points along the first of `axes` it mentions
// (so texts sharing a topic word are near, others orthogonal). Records every call.
export function fakeEmbedder(axes: string[], model = "fake-voyage"): Embedder & { calls: { texts: string[]; inputType: string }[] } {
  const calls: { texts: string[]; inputType: string }[] = [];
  return {
    model,
    calls,
    async embed(texts, inputType) {
      calls.push({ texts, inputType });
      return texts.map((t) => {
        const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        const i = axes.findIndex((a) => t.toLowerCase().includes(a));
        v[i < 0 ? axes.length : i] = 1;
        return v;
      });
    },
  };
}

export type FakeJudgeReply = (input: JudgeInput) => Partial<JudgeResult> & Pick<JudgeResult, "connections">;

// Fake Claude for the Connection judge: answers with `reply(input)`, records every input.
export function fakeJudge(reply: FakeJudgeReply = () => ({ connections: [] })): ConnectionJudge & { inputs: JudgeInput[] } {
  const inputs: JudgeInput[] = [];
  return {
    inputs,
    model: "fake-sonnet",
    promptVersion: "judge-test-1",
    async judge(input) {
      inputs.push(input);
      return { inputTokens: 1000, outputTokens: 200, costUsd: 0.004, ...reply(input) };
    },
  };
}

// Fake Claude for Cluster naming: answers with `reply(input)` (a fixed name by default), records every input.
export function fakeNamer(
  reply: (input: NamingInput) => Partial<NamingResult> | Promise<Partial<NamingResult>> = () => ({}),
): ClusterNamer & { inputs: NamingInput[] } {
  const inputs: NamingInput[] = [];
  return {
    inputs,
    model: "fake-sonnet",
    promptVersion: "naming-test-1",
    async name(input) {
      inputs.push(input);
      return { name: "Quiet Lives", description: "Books about quiet lives.", inputTokens: 500, outputTokens: 50, costUsd: 0.0015, ...(await reply(input)) };
    },
  };
}
