// `id` is the new Note's own, from its first try at saving: every later try lands on the same Note.
export type Draft = { body: string; quote: string; page: string; id?: string };
export const EMPTY: Draft = { body: "", quote: "", page: "" };

// An unsent draft, one per Book, survives closing the panel or the phone's Note sheet, switching Books
// and a refresh; the sheet and the Book screen share it. Storage may be unavailable.
const draftKey = (bookId: string) => `marginalia:note-draft:${bookId}`;
export function loadDraft(bookId: string): Draft {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(draftKey(bookId)) ?? "{}") };
  } catch {
    return EMPTY;
  }
}
export function saveDraft(bookId: string, draft: Draft) {
  try {
    if (draft.body || draft.quote || draft.page) localStorage.setItem(draftKey(bookId), JSON.stringify(draft));
    else localStorage.removeItem(draftKey(bookId));
  } catch {}
}
export function hasDraft(bookId: string) {
  const d = loadDraft(bookId);
  return !!(d.body.trim() || d.quote.trim() || d.page.trim());
}

export const sameDraft = (a: Draft, b: Draft) => a.body === b.body && a.quote === b.quote && a.page === b.page && a.id === b.id;

// A v4 UUID. Not crypto.randomUUID: a phone loading the dev server over the network isn't a secure context.
export function newNoteId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
