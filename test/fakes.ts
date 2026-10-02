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

// Fake Google Books and Open Library descriptions; records calls. `gbError`/`olError` simulate outages.
export function fakeDescriptions(opts: {
  volumes?: GoogleBooksVolume[];
  openLibrary?: string;
  gbError?: boolean;
  olError?: boolean;
}): DescriptionGateway & { queries: string[]; olCalls: string[] } {
  const queries: string[] = [];
  const olCalls: string[] = [];
  return {
    queries,
    olCalls,
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
  reply: Partial<EnrichmentResult> | ((input: EnrichInput) => Partial<EnrichmentResult> | Promise<never>) = {},
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
