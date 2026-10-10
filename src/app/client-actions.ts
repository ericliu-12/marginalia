import { SIGNED_OUT, signInPath } from "@/lib/signed-out";
import * as server from "./actions";

// A call refused for want of a live session (a missing, forged or expired cookie: the proxy's 401) sends
// the Reader to sign-in, coming back to this page after, instead of failing where it was called. The page
// is leaving, so the returned promise never settles: the caller neither succeeds nor shows a failure.
export function goToSignIn(): Promise<never> {
  window.location.assign(signInPath(window.location.pathname + window.location.search));
  return new Promise<never>(() => {});
}

// The Server Functions as the client calls them, each going to sign-in when refused as signed out.
function untilSignedOut<A extends unknown[], R>(action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (err) {
      if (!(err instanceof Error && err.message === SIGNED_OUT)) throw err;
      return goToSignIn();
    }
  };
}

// How the router fetches the page again: set by <RefreshAfterSaves />, which the root layout renders.
let refreshRouter: (() => void) | null = null;
export function setRefreshRouter(refresh: (() => void) | null) {
  refreshRouter = refresh;
}

// A save that revalidates fetches the page again once it lands. Next sends Server Functions one at a
// time, so a save can wait behind another; when the Reader changes screen meanwhile, Next can apply that
// screen as it was before the save over the save's own refresh, and nothing fetches again.
function refreshing<A extends unknown[], R>(action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args) => {
    const res = await action(...args);
    refreshRouter?.();
    return res;
  };
}

export const addBookAction = refreshing(untilSignedOut(server.addBookAction));
export const addManualBookAction = refreshing(untilSignedOut(server.addManualBookAction));
export const findLookalikeAction = untilSignedOut(server.findLookalikeAction);
export const editBookAction = refreshing(untilSignedOut(server.editBookAction));
export const changeStatusAction = refreshing(untilSignedOut(server.changeStatusAction));
export const removeFromLibraryAction = refreshing(untilSignedOut(server.removeFromLibraryAction));
export const listNotesAction = untilSignedOut(server.listNotesAction);
export const addNoteAction = untilSignedOut(server.addNoteAction);
export const updateNoteAction = untilSignedOut(server.updateNoteAction);
export const deleteNoteAction = untilSignedOut(server.deleteNoteAction);
export const getEnrichmentAction = untilSignedOut(server.getEnrichmentAction);
export const tryAgainAction = untilSignedOut(server.tryAgainAction);
export const getConnectionsAction = untilSignedOut(server.getConnectionsAction);
export const getConnectionAction = untilSignedOut(server.getConnectionAction);
export const graphStatusAction = untilSignedOut(server.graphStatusAction);
export const backgroundStatusAction = untilSignedOut(server.backgroundStatusAction);
export const dismissConnectionAction = refreshing(untilSignedOut(server.dismissConnectionAction));
export const refreshConnectionsAction = refreshing(untilSignedOut(server.refreshConnectionsAction));
