import Link from "next/link";
import { quietLink } from "./quiet-link";

// Beside the wordmark, since the home-screen app has no address bar: the way to the account page (#67),
// where the Reader signs out and exports their data.
export function AccountLink({ className = "" }: { className?: string }) {
  return (
    <Link href="/account" className={`${quietLink} inline-flex items-center ${className}`}>
      Account
    </Link>
  );
}
