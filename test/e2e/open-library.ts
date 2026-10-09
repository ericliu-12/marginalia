import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenLibraryWork } from "../../src/domain/search";

// The e2e server's Open Library (OPEN_LIBRARY_FIXTURE_FILE): what it searches, and where adding from
// search looks a work up again.
export const E2E_CATALOG = join(tmpdir(), "marginalia-e2e-catalog.json");

export const catalog = (works: OpenLibraryWork[]) => writeFile(E2E_CATALOG, JSON.stringify(works));
