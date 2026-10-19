// The saves that change what a page shows, and which pages: the Server Function revalidates them, and
// the client fetches the page again once the save lands (client-actions.ts). A Server Function not
// named here does neither.
export const REFRESHES = {
  addBookAction: ["/"],
  addManualBookAction: ["/"],
  editBookAction: ["/", "/graph"],
  changeStatusAction: ["/", "/graph"],
  removeFromLibraryAction: ["/"],
  dismissConnectionAction: ["/graph"],
  connectBooksAction: ["/graph"],
  editConnectionAction: ["/graph"],
  deleteConnectionAction: ["/graph"],
  // The graph sees the run, and checks back until it settles.
  refreshConnectionsAction: ["/graph"],
} as const;

export type Refreshing = keyof typeof REFRESHES;
