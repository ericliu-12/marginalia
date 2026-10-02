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
