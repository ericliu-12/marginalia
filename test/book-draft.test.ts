import { describe, expect, it } from "vitest";
import { draftError, withScheme } from "../src/app/book-draft";
import { InvalidBookError, manualBookFields } from "../src/domain/add-book";
import { isCoverAddress } from "../src/domain/book-cover";

describe("the cover-address rule", () => {
  const covers = ["https://example.com/c.jpg", "HTTP://example.com/c.jpg", "www.example.com/c.jpg", "", "  "];
  const notCovers = ["javascript:alert(1)", "ftp://example.com/c.jpg", "example.com/c.jpg", "not a url", "https://", "https://a b"];

  it("is an http(s) address, nothing else", () => {
    for (const c of covers.filter((c) => c.trim())) expect(isCoverAddress(withScheme(c)), c).toBe(true);
    for (const c of notCovers) expect(isCoverAddress(c), c).toBe(false);
  });

  it("is the same in the form's check and in what is stored", () => {
    const draft = { title: "Kitchen", author: "June Ash", description: "" };
    for (const c of covers) {
      expect(draftError({ ...draft, coverUrl: c }, true), c).toBeNull();
      expect(() => manualBookFields({ ...draft, coverUrl: withScheme(c) }), c).not.toThrow();
    }
    for (const c of notCovers) {
      expect(draftError({ ...draft, coverUrl: c }, true)?.field, c).toBe("coverUrl");
      expect(() => manualBookFields({ ...draft, coverUrl: c }), c).toThrow(InvalidBookError);
    }
  });
});
