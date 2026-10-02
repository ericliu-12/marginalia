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
