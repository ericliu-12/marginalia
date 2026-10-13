import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as client from "../src/app/client-actions";
import { REFRESHES } from "../src/app/refreshes";

// The client calls every Server Function through client-actions.ts, so one refused as signed out sends
// the Reader to sign-in wherever it was called. A new Server Function fails here until it is wrapped
// there, and a component importing actions.ts directly fails too.
const source = (f: string) => readFileSync(f, "utf8");
const serverFunctions = [...source("src/app/actions.ts").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
const wrapped = [...source("src/app/client-actions.ts").matchAll(/^export const (\w+) = client\("(\w+)"\);$/gm)].filter((m) => m[1] === m[2]).map((m) => m[1]);
// Each Server Function's body, from its signature to the next.
const bodies = source("src/app/actions.ts").split(/^export async function /m).slice(1);

// Every Server Function answers at once, as a save that worked.
vi.mock("../src/app/actions", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(real).map((name) => [name, async () => ({ ok: true })]));
});

describe("client-actions", () => {
  it("wraps every Server Function", () => {
    expect(serverFunctions.length).toBeGreaterThan(0);
    expect(wrapped.sort()).toEqual(serverFunctions.sort());
  });

  // A save that lands after the Reader changed screen would otherwise leave that screen as it was before.
  it("fetches the page again after exactly the saves that refresh", async () => {
    const refreshed: string[] = [];
    for (const [name, action] of Object.entries(client)) {
      if (!name.endsWith("Action")) continue;
      let refreshes = 0;
      client.setRefreshRouter(() => refreshes++);
      await (action as (...args: unknown[]) => Promise<unknown>)();
      if (refreshes) refreshed.push(name);
    }
    client.setRefreshRouter(null);
    expect(refreshed.sort()).toEqual(Object.keys(REFRESHES).sort());
  });

  it("revalidates on the server exactly the pages each save says it refreshes", () => {
    const helpers = source("src/app/actions.ts").split(/^export async function /m)[0];
    // revalidatePath is called only by the one helper that reads REFRESHES.
    expect(helpers.match(/revalidatePath\(/g)).toHaveLength(1);
    expect(bodies.join("")).not.toContain("revalidatePath(");
    const revalidating = bodies
      .map((b) => ({ name: b.match(/^\w+/)![0], calls: [...b.matchAll(/\brevalidate\("(\w+)"\)/g)].map((m) => m[1]) }))
      .filter((f) => f.calls.length);
    for (const f of revalidating) expect(f.calls, f.name).toEqual([f.name]);
    expect(revalidating.map((f) => f.name).sort()).toEqual(Object.keys(REFRESHES).sort());
  });

  it("is the only way the app reaches actions.ts", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" }).map((f) => relative(process.cwd(), join("src", f)));
    const importers = files.filter((f) => /\.tsx?$/.test(f) && /from "(?:\.{1,2}\/)+actions"|from "@\/app\/actions"/.test(source(f)));
    expect(importers).toEqual(["src/app/client-actions.ts"]);
  });
});
