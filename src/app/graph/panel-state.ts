import type { Selection } from "./graph-canvas";
import { follow, rewind } from "./trail";

// What the graph's panel is on: the selection, the Follow trail that led to it, and the Book whose
// panel says it was just finished (`fresh`). A chosen Book is always the trail's last; with anything
// else chosen, or nothing, there is no trail.
export type PanelState = { selection: Selection; trail: string[]; fresh: string | null };

export type PanelEvent =
  // Chosen on the canvas, from a list or from a Cluster: a trail of its own starts.
  | { kind: "select"; selection: Selection }
  // A Book followed from the panel. From a Connection (`via` its other Book), the trail starts there.
  | { kind: "follow"; bookId: string; via?: string }
  | { kind: "rewind"; index: number }
  // The trail ends; the panel stays on its Book.
  | { kind: "clear" }
  // A Book that has just arrived in the graph opens, saying it is new.
  | { kind: "arrive"; bookId: string }
  | { kind: "close" };

export const CLOSED: PanelState = { selection: null, trail: [], fresh: null };

export function panelState(state: PanelState, event: PanelEvent): PanelState {
  const onTrail = (trail: string[]): PanelState => ({ ...state, selection: { kind: "book", bookId: trail[trail.length - 1] }, trail });
  switch (event.kind) {
    case "select":
      if (!event.selection) return CLOSED;
      return { ...state, selection: event.selection, trail: event.selection.kind === "book" ? [event.selection.bookId] : [] };
    case "follow":
      return onTrail(follow(event.via ? [event.via] : state.trail, event.bookId));
    case "rewind":
      return onTrail(rewind(state.trail, event.index));
    case "clear":
      return state.selection?.kind === "book" ? { ...state, trail: [state.selection.bookId] } : state;
    case "arrive":
      return { selection: { kind: "book", bookId: event.bookId }, trail: [event.bookId], fresh: event.bookId };
    case "close":
      return CLOSED;
  }
}
