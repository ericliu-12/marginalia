import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every Server Function and API route acts as the signed-in Reader, so each must refuse a request
// without one before it touches anything. Found by walking src/app: a new one fails here until it
// calls requireReader. Only the two sign-ins themselves are open.
const PUBLIC = new Set([
  // The password gate's own sign-in (until #69).
  "src/app/login/actions.ts",
  // Better Auth's sign-in, sign-out and Google callback.
  "src/app/api/auth/[...all]/route.ts",
]);

const touched = vi.hoisted(() => ({ db: 0, sessionChecks: 0 }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// No Reader session: Better Auth finds nobody.
vi.mock("../src/lib/auth", () => ({
  appAuth: () => ({
    api: {
      getSession: async () => {
        touched.sessionChecks++;
        return null;
      },
    },
  }),
}));
vi.mock("../src/db/client", () => ({
  appDb: () => {
    touched.db++;
    throw new Error("Touched the database without a Reader.");
  },
}));

const files = readdirSync("src/app", { recursive: true, encoding: "utf8" })
  .map((f) => relative(process.cwd(), join("src/app", f)))
  .filter((f) => /\.tsx?$/.test(f));
const serverFunctionModules = files.filter((f) => /^\s*["']use server["']/.test(readFileSync(f, "utf8")));
const routeModules = files.filter((f) => /(^|\/)route\.ts$/.test(f));

describe("Every Server Function and API route requires a Reader", () => {
  beforeEach(() => {
    // The password gate open, as in development, so only the Reader's session decides.
    vi.stubEnv("APP_PASSWORD", undefined);
    vi.stubEnv("SESSION_SECRET", undefined);
    touched.db = 0;
    touched.sessionChecks = 0;
  });

  it("finds them all, and the open ones are still there", () => {
    expect(serverFunctionModules).toContain("src/app/actions.ts");
    expect(routeModules).toContain("src/app/api/search/route.ts");
    for (const f of PUBLIC) expect(files).toContain(f);
  });

  for (const file of serverFunctionModules.filter((f) => !PUBLIC.has(f))) {
    it(`${file}: each Server Function refuses a request with no session`, async () => {
      const exported = Object.entries(await import(`../${file}`)).filter(([, v]) => typeof v === "function");
      expect(exported.length).toBeGreaterThan(0);
      for (const [name, fn] of exported as [string, (...args: unknown[]) => Promise<unknown>][]) {
        const before = touched.sessionChecks;
        const result = await fn(...Array.from({ length: fn.length }, () => "00000000-0000-0000-0000-000000000000"));
        expect(result === null || (result as { ok?: boolean }).ok === false, `${name} answered ${JSON.stringify(result)}`).toBe(true);
        expect(touched.sessionChecks, `${name} asked for the Reader`).toBe(before + 1);
        expect(touched.db, `${name} touched the database`).toBe(0);
      }
    });
  }

  for (const file of routeModules.filter((f) => !PUBLIC.has(f))) {
    it(`${file}: each method answers 401 to a request with no session`, async () => {
      const methods = Object.entries(await import(`../${file}`)).filter(([name]) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(name));
      expect(methods.length).toBeGreaterThan(0);
      for (const [name, handler] of methods as [string, (r: Request) => Promise<Response>][]) {
        const res = await handler(new Request("http://localhost/api?q=stoner", { method: name, body: name === "GET" ? undefined : "{}" }));
        expect(res.status, name).toBe(401);
        expect(touched.db, `${name} touched the database`).toBe(0);
      }
    });
  }
});
