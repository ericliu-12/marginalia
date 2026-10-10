import Link from "next/link";
import { quietLink } from "./quiet-link";

// The shell of /privacy and /terms (#62): public pages read by Google's consent screen and by anyone
// deciding whether to sign in. One serif column; every section has an id, so a part can be linked to.

export const CONTACT = "hello@inkmarginalia.com";
export const UPDATED = "9 October 2026";

export const proseLink = "text-ink underline decoration-rule underline-offset-4 transition-colors duration-150 hover:decoration-ink";

export function Email() {
  return (
    <a href={`mailto:${CONTACT}`} className={`${proseLink} wrap-anywhere`}>
      {CONTACT}
    </a>
  );
}

export function LegalPage({ title, other, children }: { title: string; other: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh justify-center px-6 pt-[max(10vh,calc(env(safe-area-inset-top)+2.5rem))] pb-[max(4rem,env(safe-area-inset-bottom))]">
      <article className="w-full max-w-[36rem] text-[1.0625rem] leading-[1.6] text-pretty">
        <header>
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</p>
            <Link href="/" className={`${quietLink} inline-flex items-center`}>
              Back to Marginalia
            </Link>
          </div>
          <h1 className="mt-12 text-[2rem] leading-tight font-medium text-balance">{title}</h1>
          <p className="mt-1 font-sans text-[0.8rem] text-ink-3">Updated {UPDATED}</p>
        </header>
        {children}
        <footer className="mt-16 flex flex-wrap items-center gap-x-4 border-t border-rule pt-4 font-sans text-[0.8rem] text-ink-3">
          <Link href={other.href} className={`${quietLink} inline-flex items-center`}>
            {other.label}
          </Link>
          <a href={`mailto:${CONTACT}`} className={`${quietLink} inline-flex items-center wrap-anywhere`}>
            {CONTACT}
          </a>
        </footer>
      </article>
    </main>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-10 scroll-mt-8 [&>p+p]:mt-3 [&>p]:mt-3">
      <h2 id={`${id}-heading`} className="text-[1.35rem] leading-[1.2] font-medium text-balance">
        {title}
      </h2>
      {children}
    </section>
  );
}

// A hairline-ruled list: a name in sans, then what it means in a sentence.
export function Ruled({ items }: { items: { name: string; text: React.ReactNode }[] }) {
  return (
    <dl className="mt-4 border-b border-rule">
      {items.map((item) => (
        <div key={item.name} className="border-t border-rule py-3 sm:grid sm:grid-cols-[9rem_1fr] sm:items-baseline sm:gap-4">
          <dt className="font-sans text-[0.875rem] font-medium text-ink">{item.name}</dt>
          <dd className="text-ink-2">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-3 space-y-1.5 pl-5 [&>li]:list-[circle] [&>li]:marker:text-ink-3">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
