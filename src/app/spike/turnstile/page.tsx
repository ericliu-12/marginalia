import { DisplayMode } from "../display-mode";
import { TurnstileWidget } from "./widget";

export const dynamic = "force-dynamic";

// Spike for #59, removed by #63: does Cloudflare Turnstile show and pass in the home-screen app?
export default function TurnstileSpikePage() {
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  return (
    <main className="mx-auto max-w-[24rem] px-6 pt-[max(12vh,calc(env(safe-area-inset-top)+3rem))] pb-12">
      <h1 className="text-[1.75rem] leading-none font-medium italic">Turnstile spike</h1>
      <DisplayMode />
      {siteKey ? (
        <TurnstileWidget siteKey={siteKey} />
      ) : (
        <p role="alert" className="mt-6 font-sans text-sm text-contrast">
          Turnstile isn’t set up on this server: it needs TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY.
        </p>
      )}
      <a href="/spike/google" className="mt-6 block font-sans text-sm text-ink-2 underline">
        Google sign-in spike
      </a>
    </main>
  );
}
