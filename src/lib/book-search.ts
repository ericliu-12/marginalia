import { readFileSync } from "node:fs";
import type { DescriptionGateway } from "@/domain/description";
import type { BookSearchGateway, OpenLibraryWork } from "@/domain/search";
import { createDescriptionGateway } from "./google-books";
import { createOpenLibraryGateway } from "./open-library";

let shared: BookSearchGateway | undefined;

// The browser tests' Open Library: the works in this file, read on every call, so a test can set them.
function fixtureGateway(file: string): BookSearchGateway {
  const works = (): OpenLibraryWork[] => {
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return [];
    }
  };
  return {
    async searchWorks(q) {
      return works().filter((w) => w.title.toLowerCase().includes(q.trim().toLowerCase()));
    },
    async findWork(workKey) {
      return works().find((w) => w.workKey === workKey) ?? null;
    },
  };
}

// One gateway per server process so its short query cache is shared across requests; the fixture file
// (OPEN_LIBRARY_FIXTURE_FILE) for the browser tests.
export function bookSearchGateway(): BookSearchGateway {
  if (process.env.OPEN_LIBRARY_FIXTURE_FILE) return fixtureGateway(process.env.OPEN_LIBRARY_FIXTURE_FILE);
  const contact = process.env.OPEN_LIBRARY_CONTACT;
  if (!contact) throw new Error("OPEN_LIBRARY_CONTACT is not set (a contact email for the Open Library User-Agent).");
  shared ??= createOpenLibraryGateway({ userAgent: `Marginalia/0.1 (${contact})` });
  return shared;
}

// Null without a Google Books key: adding a Book never depends on a description.
export function descriptionGateway(): DescriptionGateway | null {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const contact = process.env.OPEN_LIBRARY_CONTACT;
  if (!apiKey || !contact) return null;
  return createDescriptionGateway({ apiKey, userAgent: `Marginalia/0.1 (${contact})` });
}
