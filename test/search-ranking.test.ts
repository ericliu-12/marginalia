import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankWorks, type OpenLibraryWork } from "../src/domain/search";
import { work } from "./fakes";

// What the Open Library gateway returned for each query (2026-10-11), so ranking is tested on real
// results without the network.
const sample = (query: string): OpenLibraryWork[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/search/${query.replace(/ /g, "-")}.json`, import.meta.url), "utf8"));
const ranked = (query: string) => rankWorks(sample(query), query);

describe("ranking real Open Library results", () => {
  it.each([
    ["house of leaves", "/works/OL32195W"],
    ["dune", "/works/OL893414W"],
    ["beloved", "/works/OL50548W"],
    ["the plague camus", "/works/OL1230715W"],
    ["1q84", "/works/OL15029001W"],
    ["normal people", "/works/OL20150260W"],
  ])("%s: the expected Book is in the top 2", (query, workKey) => {
    expect(ranked(query).slice(0, 2).map((w) => w.workKey)).toContain(workKey);
  });

  it("house of leaves: Danielewski's novel leads, ahead of the other Houses of Leaves", () => {
    expect(ranked("house of leaves")[0].workKey).toBe("/works/OL32195W");
  });

  it("silas house: his books come first", () => {
    for (const w of ranked("silas house").slice(0, 5)) expect(w.authors).toContain("Silas House");
  });

  it("house of leaves danielewski: House of Leaves comes first", () => {
    expect(ranked("house of leaves danielewski")[0].workKey).toBe("/works/OL32195W");
  });
});

describe("a title word that is another author's surname", () => {
  const works = [
    work({ workKey: "/works/bell", title: "Ring the Jar", authors: ["Madison Bell"], editionCount: 30 }),
    work({ workKey: "/works/plath", title: "The Bell Jar", authors: ["Sylvia Plath"], editionCount: 10 }),
  ];

  it("does not make the query name that author", () => {
    expect(rankWorks(works, "the bell jar").map((w) => w.workKey)).toEqual(["/works/plath", "/works/bell"]);
  });

  it("still names them when the query is just their name", () => {
    expect(rankWorks(works, "madison bell")[0].workKey).toBe("/works/bell");
  });
});

describe("popularity", () => {
  it("ranks by readers who logged the work before edition count", () => {
    const keys = rankWorks([
      work({ workKey: "/works/editions", title: "Normal People", editionCount: 51, readinglogCount: 14 }),
      work({ workKey: "/works/readers", title: "Normal People", editionCount: 27, readinglogCount: 1914 }),
    ], "normal people").map((w) => w.workKey);
    expect(keys).toEqual(["/works/readers", "/works/editions"]);
  });
});
