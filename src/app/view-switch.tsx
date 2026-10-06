import Link from "next/link";

// The two ways into the reader's books. The graph needs a larger screen, so below lg there is no switch.
export function ViewSwitch({ current }: { current: "library" | "graph" }) {
  const views = [
    { key: "library", label: "Library", href: "/" },
    { key: "graph", label: "Graph", href: "/graph" },
  ] as const;
  return (
    <nav aria-label="Views" className="hidden items-baseline gap-4 font-sans text-[0.8rem] font-medium lg:flex">
      {views.map((v) =>
        v.key === current ? (
          <span key={v.key} aria-current="page" className="text-ink underline decoration-ink underline-offset-[5px]">
            {v.label}
          </span>
        ) : (
          <Link
            key={v.key}
            href={v.href}
            className="text-ink-3 underline decoration-transparent underline-offset-[5px] transition-colors duration-150 hover:text-ink hover:decoration-rule"
          >
            {v.label}
          </Link>
        ),
      )}
    </nav>
  );
}
