import { afterEach } from "vitest";
import { blockedMessage, takeBlockedRequests } from "./outbound-guard.mjs";

// Fails the test even when the code under test caught the guard's error.
afterEach(() => {
  const hosts = takeBlockedRequests();
  if (hosts.length) throw new Error(blockedMessage(hosts));
});
