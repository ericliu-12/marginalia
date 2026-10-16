import { describe, expect, it } from "vitest";
import { washAt, type WashShape } from "../src/app/graph/wash";

// A chain of three Books along the x axis, and a pair sitting on its middle.
const chain: WashShape = {
  id: "chain",
  books: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }],
  bands: [
    [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    [{ x: 100, y: 0 }, { x: 200, y: 0 }],
  ],
};
const pair: WashShape = { id: "pair", books: [{ x: 100, y: 0 }, { x: 100, y: 40 }], bands: [[{ x: 100, y: 0 }, { x: 100, y: 40 }]] };

describe("washAt", () => {
  it("finds a wash around its Books and all along its bands, so a chain is one shape", () => {
    expect(washAt(-20, 0, [chain], 30)).toBe("chain");
    expect(washAt(50, 25, [chain], 30)).toBe("chain");
    expect(washAt(150, -25, [chain], 30)).toBe("chain");
  });

  it("is null over bare paper", () => {
    expect(washAt(50, 35, [chain], 30)).toBeNull();
    expect(washAt(240, 0, [chain], 30)).toBeNull();
  });

  it("gives an overlap to the smaller wash, wherever the two are listed", () => {
    expect(washAt(100, 20, [chain, pair], 30)).toBe("pair");
    expect(washAt(100, 20, [pair, chain], 30)).toBe("pair");
    // Outside the pair, the chain still has it.
    expect(washAt(170, 0, [pair, chain], 30)).toBe("chain");
  });

  it("finds a lone Book's disc, with no bands", () => {
    expect(washAt(5, 5, [{ id: "one", books: [{ x: 0, y: 0 }], bands: [] }], 30)).toBe("one");
  });
});
