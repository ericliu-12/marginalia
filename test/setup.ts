import { afterEach } from "vitest";
import { takeBlockedRequests } from "./outbound-guard.mjs";

// Fails the test even when the code under test caught the guard's error.
afterEach(() => {
  const hosts = takeBlockedRequests();
  if (hosts.length) throw new Error(`Blocked outbound request to ${[...new Set(hosts)].join(", ")}: tests must not call real APIs; pass a fake instead (test/outbound-guard.mjs)`);
});
