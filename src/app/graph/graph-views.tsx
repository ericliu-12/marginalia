"use client";

import type { ComponentProps } from "react";
import { useWide } from "../use-wide";
import { GraphWorkspace } from "./graph-workspace";
import { PhoneGraph } from "./phone-graph";

// The server can't tell the screen's width, so it renders both and CSS shows the right one; once the
// browser knows, only that one stays mounted (as the library does).
export function GraphViews(props: ComponentProps<typeof GraphWorkspace>) {
  const wide = useWide(null);
  return (
    <>
      {wide !== false && (
        <div className={wide === null ? "hidden lg:block" : undefined}>
          <GraphWorkspace {...props} />
        </div>
      )}
      {wide !== true && (
        <div className={wide === null ? "lg:hidden" : undefined}>
          <PhoneGraph graph={props.graph} finding={props.finding} paused={props.paused} loneThemes={props.loneThemes} />
        </div>
      )}
    </>
  );
}
