import { describe, expect, it } from "vitest";
import { byStrength, joins, otherBook, pairOf, touches } from "../src/domain/connection-pair";

describe("Connection pair", () => {
  const c = { a: "b1", b: "b2" };

  it("names the other Book from either end", () => {
    expect(otherBook(c, "b1")).toBe("b2");
    expect(otherBook(c, "b2")).toBe("b1");
  });

  it("knows which Books it touches and joins, in either order", () => {
    expect(touches(c, "b2")).toBe(true);
    expect(touches(c, "b3")).toBe(false);
    expect(joins(c, "b2", "b1")).toBe(true);
    expect(joins(c, "b1", "b3")).toBe(false);
  });

  it("stores two Books with the lower id first", () => {
    expect(pairOf("b2", "b1")).toEqual(c);
    expect(pairOf("b1", "b2")).toEqual(c);
  });

  it("orders strongest first, then most similar, then by id", () => {
    const rows = [
      { id: "4", strength: "weak" as const, similarity: 0.9 },
      { id: "3", strength: "strong" as const, similarity: 0.4 },
      { id: "2", strength: "strong" as const, similarity: 0.6 },
      { id: "1", strength: "strong" as const, similarity: 0.4 },
    ];
    expect(rows.sort(byStrength).map((r) => r.id)).toEqual(["2", "1", "3", "4"]);
  });

  it("orders by id where the similarity is not at hand", () => {
    const rows = [{ id: "b", strength: "moderate" as const }, { id: "a", strength: "moderate" as const }, { id: "c", strength: "strong" as const }];
    expect(rows.sort(byStrength).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
