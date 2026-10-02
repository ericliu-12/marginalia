import { createOpenLibraryGateway } from "./open-library";

let shared: ReturnType<typeof createOpenLibraryGateway> | undefined;

// One gateway per server process so its short query cache is shared across requests.
export function bookSearchGateway() {
  const contact = process.env.OPEN_LIBRARY_CONTACT;
  if (!contact) throw new Error("OPEN_LIBRARY_CONTACT is not set (a contact email for the Open Library User-Agent).");
  shared ??= createOpenLibraryGateway({ userAgent: `Marginalia/0.1 (${contact})` });
  return shared;
}
