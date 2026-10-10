import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The client calls every Server Function through client-actions.ts, so one refused as signed out sends
// the Reader to sign-in wherever it was called. A new Server Function fails here until it is wrapped
// there, and a component importing actions.ts directly fails too.
const source = (f: string) => readFileSync(f, "utf8");
const serverFunctions = [...source("src/app/actions.ts").matchAll(/^export async function (\w+)/gm)].map((m) => m[1]);
const wrapped = [...source("src/app/client-actions.ts").matchAll(/^export const (\w+) = untilSignedOut\(server\.(\w+)\);$/gm)].filter((m) => m[1] === m[2]).map((m) => m[1]);

describe("client-actions", () => {
  it("wraps every Server Function", () => {
    expect(serverFunctions.length).toBeGreaterThan(0);
    expect(wrapped.sort()).toEqual(serverFunctions.sort());
  });

  it("is the only way the app reaches actions.ts", () => {
    const files = readdirSync("src", { recursive: true, encoding: "utf8" }).map((f) => relative(process.cwd(), join("src", f)));
    const importers = files.filter((f) => /\.tsx?$/.test(f) && /from "(?:\.{1,2}\/)+actions"|from "@\/app\/actions"/.test(source(f)));
    expect(importers).toEqual(["src/app/client-actions.ts"]);
  });
});
