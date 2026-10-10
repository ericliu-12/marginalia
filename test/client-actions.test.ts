import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The client calls every Server Function through client-actions.ts, so one refused as signed out sends
// the Reader to sign-in wherever it was called. A new Server Function fails here until it is wrapped
// there, and a component importing actions.ts directly fails too.
const source = (f: string) => readFileSync(f, "utf8");
const serverFunctions = [...source("src/app/actions.ts").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
const wrappings = [...source("src/app/client-actions.ts").matchAll(/^export const (\w+) = (refreshing\()?untilSignedOut\(server\.(\w+)\)\)?;$/gm)].filter((m) => m[1] === m[3]);
const wrapped = wrappings.map((m) => m[1]);
const refreshed = wrappings.filter((m) => m[2]).map((m) => m[1]);
// Each Server Function's body, from its signature to the next.
const bodies = source("src/app/actions.ts").split(/^export async function /m).slice(1);
const revalidating = bodies.filter((b) => b.includes("revalidatePath(")).map((b) => b.match(/^\w+/)![0]);

describe("client-actions", () => {
  it("wraps every Server Function", () => {
    expect(serverFunctions.length).toBeGreaterThan(0);
    expect(wrapped.sort()).toEqual(serverFunctions.sort());
  });

  // A save that lands after the Reader changed screen would otherwise leave that screen as it was before.
  it("fetches the page again after every save that revalidates", () => {
    expect(revalidating.length).toBeGreaterThan(0);
    expect(refreshed.sort()).toEqual(revalidating.sort());
  });

  it("is the only way the app reaches actions.ts", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" }).map((f) => relative(process.cwd(), join("src", f)));
    const importers = files.filter((f) => /\.tsx?$/.test(f) && /from "(?:\.{1,2}\/)+actions"|from "@\/app\/actions"/.test(source(f)));
    expect(importers).toEqual(["src/app/client-actions.ts"]);
  });
});
