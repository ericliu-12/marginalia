// The Follow trail: the Books the reader has followed, Connection by Connection, oldest first.

// Following a Book adds it to the end, or rewinds to it when it is already on the trail, so no
// Book is on it twice.
export function follow(trail: string[], bookId: string): string[] {
  const at = trail.indexOf(bookId);
  return at >= 0 ? rewind(trail, at) : [...trail, bookId];
}

// Back to the crumb at `index`, dropping everything after it.
export function rewind(trail: string[], index: number): string[] {
  return trail.slice(0, index + 1);
}
