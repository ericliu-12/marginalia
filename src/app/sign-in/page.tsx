import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appAuth } from "@/lib/auth";
import { safeNext } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { CodeSignIn } from "./code-sign-in";

export const dynamic = "force-dynamic";

// A Reader signs in with Google (#63) or a code emailed to them (#60). Behind the password gate until #69.
// A Google sign-in that failed comes back here with `?error=`.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next: given, error } = await searchParams;
  const next = safeNext(given);
  if (await appAuth().api.getSession({ headers: await headers() })) redirect(next);
  return (
    <main className="flex min-h-dvh justify-center px-6 pt-[max(18vh,calc(env(safe-area-inset-top)+3rem))] pb-12">
      <CodeSignIn next={next} callbackURL={new URL(next, siteUrl()).toString()} googleFailed={Boolean(error)} />
    </main>
  );
}
