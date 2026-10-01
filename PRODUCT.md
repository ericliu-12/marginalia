# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-specified:

- Next.js (App Router) + TypeScript
- Tailwind CSS + shadcn/ui primitives, restyled to the Marginalia design system
- Postgres + pgvector (embeddings for connection candidates), Drizzle ORM; Docker locally, Neon later
- Graph: Sigma.js (WebGL) with graphology for graph data and clustering (Louvain)
- Book data: Open Library API (free, no key) for identity and covers; no Google Books in the MVP
- AI: Claude API for book enrichment (summary, themes), connection judging, and explanations; embeddings for candidate retrieval
- Auth: none for the MVP (single user). The data model carries `user_id` throughout so auth can be added later.

## Users

A thoughtful, regular reader who reads across fiction and nonfiction and wants their reading to add up to something rather than be forgotten. Initially a single user (the builder) using it as a personal tool; later, other readers like them.

Jobs:
- Keep a personal library: what I'm reading, want to read, and have read.
- Capture notes while reading.
- Deeper job: remember and make sense of what was read. See how books connect, rediscover half-forgotten ideas, notice patterns in one's own thinking across books. On finishing a book, see where it fits among everything read before.

Usage rhythm: short sessions (add a book, jot a note mid-read, mark finished) plus occasional longer, slower sessions exploring the graph, following connections, and reflecting. The longer sessions are where the product should feel most rewarding.

## Product Purpose

Let a reader see their reading life as a connected body of thought instead of a list. Finish a book and immediately see how it relates to earlier reading, including connections never consciously made. Rediscover forgotten books through links to new ones. Notice recurring questions and themes across years. Notes stop being isolated scraps and become part of a larger web of ideas.

It is a private, contemplative space. It is not a social network, a reading-challenge tracker, or a productivity dashboard: no streaks, no goals, no public reviews.

## Positioning

Connections are generated automatically and grounded in the reader's own notes, not just book metadata. When a book is marked read, Marginalia finds the books it genuinely relates to and creates typed connections (shared themes, contrasting answers to the same question, shared context). Each connection carries a specific explanation that can quote the reader's own notes, e.g. "Your note on Stoner about quiet failure echoes what you wrote about The Remains of the Day." The graph grows one finished book at a time, and clusters emerge on their own rather than being hand-sorted into shelves.

Versus neighbors: Obsidian makes you draw every link by hand; Goodreads only knows what you read, not what you thought. Marginalia does the linking, using your thinking as the evidence.

## Operating Context

- Desktop-first: graph exploration needs screen space, so it is designed primarily for laptop and desktop.
- Must remain usable on mobile for quick actions (add a book, jot a note, mark finished); the graph view on mobile may be simplified.
- Graph must stay smooth at hundreds of nodes.
- Connection generation is triggered by marking a book read.

## Capabilities and Constraints

- Library with three states: want to read, reading, read.
- Notes attached to books, captured mid-read.
- Typed connections between books, each with a specific explanation that may quote the reader's notes.
- Graph view with automatic clustering (Louvain).
- Book enrichment (summary, themes) via Claude; identity and covers via Open Library.
- Single user for the MVP; multi-user is a later possibility, not a current requirement.
- Undecided: the exact set of connection types beyond shared themes, contrasting answers to the same question, and shared context.

## Brand Commitments

Name: Marginalia. No other identity, voice, or assets have been established.

## Evidence on Hand

None. The repository is empty apart from agent configuration; there are no real books, notes, or connections yet. Do not fabricate sample reader data presented as real testimonials or usage claims.

## Product Principles

- Reflection over productivity: no streaks, goals, counters-as-pressure, or dashboards.
- Connections are evidence-backed: every link explains itself, and where possible cites the reader's own words.
- The graph grows from finished books; structure emerges rather than being filed by hand.
- Quick capture, slow rewards: short actions stay frictionless, long sessions are where depth pays off.
- Private by default: this is one reader's space, not a public profile.
