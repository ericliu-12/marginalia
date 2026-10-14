---
version: 1
slug: "src-app-graph-graph-workspace-tsx"
primary_target: "src/app/graph/graph-workspace.tsx"
related_targets: ["src/app/graph/graph-canvas.tsx","src/app/graph/cluster-panel.tsx","src/app/graph/connection-panel.tsx"]
---

# Graph (desktop)

**Mode:** Experience inside Operate. The reader explores how finished Books connect.

**Reference:** `docs/design/reference/desktop-graph.html` (#97, #138). The phone graph is a separate future issue.

## Direction
- Same header as the library, "graph" current.
- Each Cluster is one continuous soft wash: a thick, round-capped stroke along its internal Connections plus a disc per Book, blurred, in its tint. The Cluster name is italic in its darker tint.
- Books are ink dots with roman 18px labels; Books with no Connections are hollow dots with muted italic labels.
- Lines in the Connection Type hues; thickness is strength.
- Legend footer under a hairline: hue bars with small-caps names; "Thicker lines are stronger Connections. Select a Book, or a Cluster’s name." in italic.
- A click inside a wash selects its Cluster (#48); a click on bare canvas clears.
- Empty graph: "Finish a Book and its Connections will gather here."

## Memorable moment
A new Connection's line draws in from one Book to the other and the wash eases to its new shape; a new Cluster's name writes in (#140).

## Constraints
Smooth at hundreds of nodes. Selection fades the rest back; reduced motion keeps only fades.
