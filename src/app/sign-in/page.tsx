import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { appAuth } from "@/lib/auth";
import { safeNext } from "@/lib/session";
import { CodeSignIn } from "./code-sign-in";

export const dynamic = "force-dynamic";

// A Reader signs in with a code emailed to them (#60). Behind the password gate until #69.
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await appAuth().api.getSession({ headers: await headers() })) redirect(next);
  return (
    <main className="flex min-h-dvh justify-center px-6 pt-[max(18vh,calc(env(safe-area-inset-top)+3rem))] pb-12">
      <CodeSignIn next={next} />
    </main>
  );
}
