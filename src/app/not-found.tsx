import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Not found · Marginalia" };

// An address with no page behind it. Only a signed-in Reader sees this: a signed-out one is sent to sign-in first.
const wayBack =
  "inline-flex min-h-11 items-center text-[17px] text-accent italic underline decoration-accent/35 underline-offset-4 transition-colors duration-150 hover:text-accent-deep hover:decoration-accent-deep";

export default function NotFound() {
  return (
    // Below lg the wordmark's top is the phone library's (mobile-shelf.tsx): its padding, plus the 8.125px its
    // wordmark drops to sit on Account's baseline, which this page has no row for.
    <div className="flex min-h-dvh justify-center px-5 pt-[calc(max(1.125rem,env(safe-area-inset-top))_+_8.125px)] pb-12 sm:px-6 lg:pt-[max(18vh,calc(env(safe-area-inset-top)+3rem))]">
      <main className="w-full max-w-[28rem]">
        <p className="text-[24px] leading-none italic lg:text-[30px]">Marginalia</p>
        <h1 className="mt-12 text-[32px] leading-[1.1] font-medium tracking-[-0.01em] text-balance lg:text-[38px]">This page isn’t here.</h1>
        <p className="mt-3 text-ink-2">The address may be mistyped, or the page has moved.</p>
        <nav aria-label="Ways back" className="mt-5 flex flex-wrap gap-x-8">
          <Link href="/" className={wayBack}>
            Your library
          </Link>
          <Link href="/graph" className={wayBack}>
            The graph
          </Link>
        </nav>
      </main>
    </div>
  );
}
