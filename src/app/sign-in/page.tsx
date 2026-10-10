import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { appAuth } from "@/lib/auth";
import { safeNext } from "@/lib/signed-out";
import { siteUrl } from "@/lib/site-url";
import { quietLink } from "../quiet-link";
import { CodeSignIn } from "./code-sign-in";

export const dynamic = "force-dynamic";

// A Reader signs in with Google (#63) or a code emailed to them (#60). Every signed-out page comes here.
// A Google sign-in that failed comes back here with `?error=`; a Reader who deleted their account, with `?deleted`.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; deleted?: string }> }) {
  const { next: given, error, deleted } = await searchParams;
  const next = safeNext(given);
  if (await appAuth().api.getSession({ headers: await headers() })) redirect(next);
  return (
    <main className="flex min-h-dvh justify-center px-6 pt-[max(18vh,calc(env(safe-area-inset-top)+3rem))] pb-12">
      <div className="w-full max-w-[19rem]">
        <CodeSignIn
          next={next}
          callbackURL={new URL(next, siteUrl()).toString()}
          googleFailed={Boolean(error)}
          accountDeleted={deleted !== undefined}
          turnstileSiteKey={process.env.TURNSTILE_SITE_KEY ?? ""}
        />
        <nav aria-label="Privacy and terms" className="mt-10 flex items-center gap-4">
          <Link href="/privacy" className={`${quietLink} inline-flex items-center`}>
            Privacy
          </Link>
          <Link href="/terms" className={`${quietLink} inline-flex items-center`}>
            Terms
          </Link>
        </nav>
      </div>
    </main>
  );
}
