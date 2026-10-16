import { describe, expect, it } from "vitest";
import { fitPhone, turnClockwise, turnsFor } from "../src/domain/phone-fit";

const PHONE = { width: 390, height: 640 };

describe("Fitting the stored layout to a tall screen", () => {
  it("turns a layout wider than the room", () => {
    expect(turnsFor([{ x: 0, y: 0 }, { x: 200, y: 100 }], PHONE)).toBe(true);
  });

  it("leaves a layout as tall as the room, or taller, as it is", () => {
    expect(turnsFor([{ x: 0, y: 0 }, { x: 100, y: 300 }], PHONE)).toBe(false);
    expect(turnsFor([{ x: 0, y: 0 }, { x: 390, y: 640 }], PHONE)).toBe(false);
  });

  it("leaves a single Book alone", () => {
    expect(turnsFor([{ x: 5, y: 5 }], PHONE)).toBe(false);
  });

  it("turns clockwise: right becomes down, down becomes left", () => {
    expect(turnClockwise({ x: 1, y: 0 })).toEqual({ x: -0, y: 1 });
    expect(turnClockwise({ x: 0, y: 1 })).toEqual({ x: -1, y: 0 });
  });

  it("keeps every distance, so each Book keeps its neighbours", () => {
    const [p, q] = [turnClockwise({ x: 3, y: -2 }), turnClockwise({ x: -1, y: 5 })];
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(Math.hypot(4, 7));
  });
});

describe("The phone's first view", () => {
  const VIEW = { width: 390, height: 844, margin: { top: 140, bottom: 90, side: 16 } };

  it("fits a graph of many Books by its dots and washes, so it fills the screen rather than shrinking to a point", () => {
    // 300 Books in a tall block, 10 across and 30 down, a Connection's length (70) apart.
    const books = Array.from({ length: 300 }, (_, i) => ({ id: `b${i}`, x: (i % 10) * 70, y: Math.floor(i / 10) * 70, degree: 3 }));
    const fit = fitPhone(books, [{ bookIds: books.slice(0, 20).map((b) => b.id) }], VIEW);
    // The block's 29 gaps down take most of the 614px of room between the header and the legend.
    expect(fit.zoom * 29 * 70).toBeGreaterThan(450);
    expect(fit.zoom * 29 * 70).toBeLessThan(614);
  });
});
