// Types for test/outbound-guard.mjs, which stays plain JavaScript so the e2e server can --import it.
export function guardedHost(input: RequestInfo | URL): string | null;
export function takeBlockedRequests(): string[];
export function blockedMessage(hosts: string[]): string;
