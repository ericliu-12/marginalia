import { describe, expect, it } from "vitest";
import { graphJobGaveUp, readGraphStatus, requestGraph, requestGraphAfter, runGraphJob, type GraphStatus } from "../src/domain/graph-job";
import { useTestDb } from "./harness";

// The reader's graph job as the graph sees it: pending from the request until the job settles.
describe("Graph job", () => {
  const ctx = useTestDb();
  const status = () => readGraphStatus(ctx.db, ctx.userId);
  const request = () => requestGraph(ctx.db, ctx.jobs, ctx.userId);
  const run = (steps: Partial<Parameters<typeof runGraphJob>[2]> = {}) =>
    runGraphJob(ctx.db, ctx.userId, { layOut: async () => {}, name: async () => {}, ...steps });

  it("is not pending with nothing asked for", async () => {
    expect(await status()).toEqual({ pending: false, naming: false });
  });

  it("is pending from the request, naming once laid out, and settles when the job ends", async () => {
    await request();
    expect(ctx.jobs.sent).toEqual([{ kind: "graph", userId: ctx.userId }]);
    expect(await status()).toEqual({ pending: true, naming: false });
    const seen: GraphStatus[] = [];
    await run({ layOut: async () => void seen.push(await status()), name: async () => void seen.push(await status()) });
    expect(seen).toEqual([
      { pending: true, naming: false },
      { pending: true, naming: true },
    ]);
    expect(await status()).toEqual({ pending: false, naming: false });
  });

  it("stays pending when asked for again while it runs, until the job queued for that runs", async () => {
    await request();
    await run({ layOut: request });
    expect(await status()).toEqual({ pending: true, naming: false });
    await run();
    expect(await status()).toEqual({ pending: false, naming: false });
  });

  it("is pending while the work before it runs, so the graph never reads as settled in between", async () => {
    const during: GraphStatus[] = [];
    await requestGraphAfter(ctx.db, ctx.jobs, ctx.userId, async () => void during.push(await status()));
    expect(during).toEqual([{ pending: true, naming: false }]);
    expect(ctx.jobs.sent).toEqual([{ kind: "graph", userId: ctx.userId }]);
    await run();
    expect(await status()).toEqual({ pending: false, naming: false });
  });

  it("is not pending when its job could not be queued", async () => {
    ctx.jobs.down = true;
    await expect(request()).rejects.toThrow();
    expect(await status()).toEqual({ pending: false, naming: false });
  });

  it("stops pending when its job gives up, whatever was asked for meanwhile", async () => {
    await request();
    await request();
    await graphJobGaveUp(ctx.db, ctx.userId);
    expect(await status()).toEqual({ pending: false, naming: false });
  });
});
