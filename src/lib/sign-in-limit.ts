// Wrong passwords allowed before /login stops listening for a while: a few per address, and a
// ceiling across all addresses so rotating them doesn't help. Kept in memory: the web app is one
// process, and a restart forgetting the count is acceptable for a single reader's gate.
const WINDOW_MS = 15 * 60 * 1000;
const PER_ADDRESS = 5;
const OVERALL = 50;
const EVERYONE = "*";

export function createSignInLimit(now: () => number = Date.now) {
  const failures = new Map<string, number[]>();
  const recent = (key: string) => {
    const kept = (failures.get(key) ?? []).filter((t) => now() - t < WINDOW_MS);
    if (kept.length) failures.set(key, kept);
    else failures.delete(key);
    return kept;
  };
  // Milliseconds until a try from `address` is heard again, once its own or the overall count is used up.
  const waitFor = (key: string, max: number) => {
    const times = recent(key);
    return times.length >= max ? times[times.length - max] + WINDOW_MS - now() : 0;
  };
  return {
    retryAfterMs(address: string): number {
      return Math.max(waitFor(address, PER_ADDRESS), waitFor(EVERYONE, OVERALL));
    },
    failed(address: string) {
      for (const key of [address, EVERYONE]) failures.set(key, [...recent(key), now()]);
    },
    succeeded(address: string) {
      failures.delete(address);
    },
  };
}

export const signInLimit = createSignInLimit();

// The address Railway's edge saw: it appends the client to X-Forwarded-For, so the last entry is the
// one a client can't write for itself.
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? headers.get("x-real-ip") ?? "unknown";
}
