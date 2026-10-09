import { redirect } from "next/navigation";
import { gate, safeNext } from "@/lib/session";
import { hasSession } from "@/lib/signed-in";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const g = gate();
  if (g.kind === "open" || (g.kind === "on" && (await hasSession()))) redirect(next);
  return (
    <main className="flex min-h-dvh justify-center px-6 pt-[max(18vh,calc(env(safe-area-inset-top)+3rem))] pb-12">
      <SignInForm next={next} unconfigured={g.kind !== "on"} />
    </main>
  );
}
