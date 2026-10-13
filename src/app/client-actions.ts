import { SIGNED_OUT, signInPath } from "@/lib/signed-out";
import * as server from "./actions";
import { REFRESHES } from "./refreshes";

// A call refused for want of a live session (a missing, forged or expired cookie: the proxy's 401) sends
// the Reader to sign-in, coming back to this page after, instead of failing where it was called. The page
// is leaving, so the returned promise never settles: the caller neither succeeds nor shows a failure.
export function goToSignIn(): Promise<never> {
  window.location.assign(signInPath(window.location.pathname + window.location.search));
  return new Promise<never>(() => {});
}

// A Server Function that goes to sign-in when refused as signed out.
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

type Server = typeof server;

// A Server Function as the client calls it: going to sign-in when refused as signed out, and fetching
// the page again once it lands when it is a save that refreshes (refreshes.ts).
function client<K extends keyof Server>(name: K): Server[K] {
  const action = untilSignedOut(server[name] as (...args: unknown[]) => Promise<unknown>);
  return (Object.hasOwn(REFRESHES, name) ? refreshing(action) : action) as Server[K];
}

export const addBookAction = client("addBookAction");
export const addManualBookAction = client("addManualBookAction");
export const findLookalikeAction = client("findLookalikeAction");
export const editBookAction = client("editBookAction");
export const changeStatusAction = client("changeStatusAction");
export const removeFromLibraryAction = client("removeFromLibraryAction");
export const listNotesAction = client("listNotesAction");
export const addNoteAction = client("addNoteAction");
export const updateNoteAction = client("updateNoteAction");
export const deleteNoteAction = client("deleteNoteAction");
export const getEnrichmentAction = client("getEnrichmentAction");
export const tryAgainAction = client("tryAgainAction");
export const getConnectionsAction = client("getConnectionsAction");
export const getConnectionAction = client("getConnectionAction");
export const graphStatusAction = client("graphStatusAction");
export const backgroundStatusAction = client("backgroundStatusAction");
export const dismissConnectionAction = client("dismissConnectionAction");
export const refreshConnectionsAction = client("refreshConnectionsAction");
