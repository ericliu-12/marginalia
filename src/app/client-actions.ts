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

export const addBookAction = untilSignedOut(server.addBookAction);
export const addManualBookAction = untilSignedOut(server.addManualBookAction);
export const findLookalikeAction = untilSignedOut(server.findLookalikeAction);
export const editBookAction = untilSignedOut(server.editBookAction);
export const changeStatusAction = untilSignedOut(server.changeStatusAction);
export const removeFromLibraryAction = untilSignedOut(server.removeFromLibraryAction);
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
export const dismissConnectionAction = untilSignedOut(server.dismissConnectionAction);
export const refreshConnectionsAction = untilSignedOut(server.refreshConnectionsAction);
