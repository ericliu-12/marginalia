import { cookies } from "next/headers";
import { DisplayMode } from "../display-mode";
import { SIGNED_IN_COOKIE } from "./oauth";

export const dynamic = "force-dynamic";

const problems: Record<string, string> = {
  unconfigured: "Google sign-in isn’t set up on this server: it needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  "no-state": "Google came back to a window without the cookie set when sign-in started: it finished outside the window it began in.",
  "state-mismatch": "Google came back with a different sign-in than this window started.",
  token: "Google wouldn’t exchange the code (the server log has why).",
  google: "Google returned an error",
};

// Spike for #59, removed by #63. Behind the password gate like every other page.
export default async function GoogleSpikePage({ searchParams }: { searchParams: Promise<{ problem?: string; detail?: string }> }) {
  const { problem, detail } = await searchParams;
  const email = (await cookies()).get(SIGNED_IN_COOKIE)?.value;
  return (
    <main className="mx-auto max-w-[24rem] px-6 pt-[max(12vh,calc(env(safe-area-inset-top)+3rem))] pb-12">
      <h1 className="text-[1.75rem] leading-none font-medium italic">Google sign-in spike</h1>
      <DisplayMode />
      <p className="mt-6 font-sans text-[0.95rem]">{email ? `Signed in with Google as ${email}.` : "Not signed in with Google."}</p>
      {problem && (
        <p role="alert" className="mt-2 font-sans text-sm text-contrast">
          {problems[problem] ?? problem}
          {detail ? `: ${detail}` : ""}
        </p>
      )}
      <a
        href="/spike/google/start"
        className="mt-6 flex min-h-11 w-full items-center justify-center rounded-[3px] bg-ink px-4 font-sans text-sm font-medium text-paper hover:bg-ink-2"
      >
        Continue with Google
      </a>
      <a href="/spike/turnstile" className="mt-4 block font-sans text-sm text-ink-2 underline">
        Turnstile spike
      </a>
      <a href="/" className="mt-2 block font-sans text-sm text-ink-2 underline">
        The library
      </a>
    </main>
  );
}
