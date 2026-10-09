export type Draft = { body: string; quote: string; page: string };
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
