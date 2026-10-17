import { describe, expect, it } from "vitest";
import { DOT_FAINT, dotDetail, dotScale, STRONG_FAINT, easeSpacing, FOG_MOST, fogAmount, HUB_SHARE, labelDetail, lineDetail, mist, placeHints } from "../src/app/graph/detail";
import { overlaps } from "../src/app/graph/placement";

describe("detail by zoom", () => {
  it("keeps hubs' dots at every zoom, and rests the rest faint until the zoom brings them in", () => {
    expect(dotDetail(0, 1)).toBe(1);
    expect(dotDetail(HUB_SHARE / 2, 1)).toBe(1);
    expect(dotDetail(0.9, 5)).toBe(DOT_FAINT);
    expect(dotDetail(0.9, 500)).toBe(1);
  });

  it("brings labels in best connected first, fading rather than popping", () => {
    // Some zoom labels the best connected Book and not yet the least.
    const edge = 50;
    expect(labelDetail(0, edge)).toBe(1);
    expect(labelDetail(1, edge)).toBe(0);
    // Between none and all, there are zooms where a label is part way in.
    const steps = Array.from({ length: 200 }, (_, i) => labelDetail(0.5, i));
    expect(steps.some((a) => a > 0.1 && a < 0.9)).toBe(true);
    // And it only grows as the reader zooms in.
    expect(steps.every((a, i) => i === 0 || a >= steps[i - 1])).toBe(true);
  });

  it("keeps strong lines faintly at every zoom, brings them in first, and none of the thin ones zoomed out", () => {
    expect(lineDetail("strong", 1)).toBe(STRONG_FAINT);
    for (const edge of [10, 30, 45, 60, 100]) {
      expect(lineDetail("strong", edge)).toBeGreaterThanOrEqual(lineDetail("moderate", edge));
      expect(lineDetail("moderate", edge)).toBeGreaterThanOrEqual(lineDetail("weak", edge));
    }
    expect(lineDetail("moderate", 20)).toBe(0);
    expect(lineDetail("moderate", 200)).toBe(1);
  });

  it("draws dots smaller only where the Books stand close", () => {
    expect(dotScale(100)).toBe(1);
    expect(dotScale(20)).toBeLessThan(1);
    expect(dotScale(1)).toBeGreaterThan(0.5);
  });

  it("leaves a label at rest in or out, fading only over a short step", () => {
    const partly = Array.from({ length: 400 }, (_, i) => labelDetail(0.5, i / 2)).filter((a) => a > 0.05 && a < 0.95).length;
    const all = Array.from({ length: 400 }, (_, i) => labelDetail(0.5, i / 2)).filter((a) => a > 0.05).length;
    expect(partly / all).toBeLessThan(0.15);
  });

  it("eases the shown zoom toward the real one, and stops once there", () => {
    let shown = 20;
    for (let i = 0; i < 6; i++) shown = easeSpacing(shown, 40, 16);
    expect(shown).toBeGreaterThan(20);
    expect(shown).toBeLessThan(40);
    for (let i = 0; i < 60; i++) shown = easeSpacing(shown, 40, 16);
    expect(shown).toBe(40);
  });
});

describe("fog", () => {
  const lens = { cx: 500, cy: 400, rx: 500, ry: 400, amount: 1 };

  it("has none while the whole graph fits, and comes in as it overflows", () => {
    expect(fogAmount(0.8)).toBe(0);
    expect(fogAmount(1)).toBe(0);
    expect(fogAmount(1.3)).toBeGreaterThan(0);
    expect(fogAmount(3)).toBe(1);
  });

  it("leaves the middle clear and thins towards the edges, never wholly", () => {
    expect(mist(500, 400, lens)).toBe(0);
    expect(mist(600, 450, lens)).toBe(0);
    expect(mist(900, 400, lens)).toBeGreaterThan(0);
    expect(mist(980, 400, lens)).toBeGreaterThan(mist(900, 400, lens));
    expect(mist(5000, 5000, lens)).toBeCloseTo(FOG_MOST);
    expect(mist(980, 400, { ...lens, amount: 0 })).toBe(0);
  });
});

describe("placeHints", () => {
  const area = { x0: 16, y0: 96, x1: 1424, y1: 812 };
  const from = { x: 720, y: 450 };

  it("pins each hint to the edge its Cluster lies past", () => {
    const placed = placeHints({
      area,
      from,
      max: 6,
      hints: [
        { id: "right", x: 3000, y: 450, w: 120, h: 20 },
        { id: "above", x: 720, y: -900, w: 120, h: 20 },
      ],
    });
    expect(placed.get("right")!.box.x1).toBeCloseTo(area.x1);
    expect(placed.get("right")!.angle).toBeCloseTo(0);
    expect(placed.get("above")!.box.y0).toBeCloseTo(area.y0);
    expect(placed.get("above")!.angle).toBeCloseTo(-Math.PI / 2);
  });

  it("shows the nearest first, never two on top of each other, and no more than asked", () => {
    const hints = [
      { id: "far", x: 9000, y: 460, w: 120, h: 20 },
      { id: "near", x: 2000, y: 450, w: 120, h: 20 },
      { id: "below", x: 720, y: 3000, w: 120, h: 20 },
      { id: "left", x: -2000, y: 450, w: 120, h: 20 },
    ];
    const placed = placeHints({ area, from, max: 2, hints });
    expect([...placed.keys()]).toEqual(["near", "below"]);
    const all = placeHints({ area, from, max: 6, hints });
    // "far" lies the same way as "near", so it would sit on it.
    expect(all.has("far")).toBe(false);
    const boxes = [...all.values()].map((h) => h.box);
    for (const [i, b] of boxes.entries()) for (const c of boxes.slice(i + 1)) expect(overlaps(b, c)).toBe(false);
  });

  it("keeps every hint inside its area", () => {
    const placed = placeHints({ area, from, max: 6, hints: [{ id: "corner", x: -5000, y: -5000, w: 200, h: 20 }] });
    const { box } = placed.get("corner")!;
    expect(box.x0).toBeGreaterThanOrEqual(area.x0 - 1e-9);
    expect(box.y0).toBeGreaterThanOrEqual(area.y0 - 1e-9);
  });
});
