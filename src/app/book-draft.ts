// What the reader types for a Book by hand, or when editing one, checked before it is sent.
export type BookDraft = { title: string; author: string; coverUrl: string; description: string };
export const EMPTY_BOOK: BookDraft = { title: "", author: "", coverUrl: "", description: "" };

// `field` is the input the message is about; null for a failure that isn't any one field's.
export type DraftError = { field: keyof BookDraft | null; message: string };

// "www.example.com/cover.jpg" is taken as the web address it is.
export const withScheme = (url: string) => (/^www\./i.test(url.trim()) ? `https://${url.trim()}` : url.trim());

// The first problem, in the order the fields appear. A shared Book's title and author may be left
// blank (back to the original), so only a Manual Book needs them.
export function draftError(draft: BookDraft, needsTitleAndAuthor: boolean): DraftError | null {
  if (needsTitleAndAuthor && !draft.title.trim()) return { field: "title", message: "A title is needed." };
  if (needsTitleAndAuthor && !draft.author.trim()) return { field: "author", message: "An author is needed." };
  const cover = withScheme(draft.coverUrl);
  if (cover && !/^https?:\/\/\S+$/i.test(cover)) {
    return { field: "coverUrl", message: "The cover should be a web address beginning with http:// or https://." };
  }
  return null;
}

// Ties an input to the form's error message when the message is about it.
export const invalidProps = (error: DraftError | null, field: keyof BookDraft, errorId: string) =>
  error?.field === field ? { "aria-invalid": true, "aria-describedby": errorId } : {};
