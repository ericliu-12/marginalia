import Link from "next/link";

// Beside the wordmark, since the home-screen app has no address bar: the way to the account page (#67),
// where the Reader signs out and exports their data.
export function AccountLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/account"
      className={`caps inline-flex min-h-11 items-center text-[15px] tracking-[1.2px] text-ink underline decoration-transparent underline-offset-[6px] transition-colors duration-150 hover:decoration-rule lg:text-[16px] lg:tracking-[1.4px] ${className}`}
    >
      Account
    </Link>
  );
}
