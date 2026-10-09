import { appendFile } from "node:fs/promises";

export type Mail = { from: string; to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

const FROM = "Marginalia <hello@inkmarginalia.com>";

// Plain text only: with no HTML there is no open-tracking pixel and no rewritten links.
export const signInCodeMail = (to: string, code: string): Mail => ({
  from: FROM,
  to,
  subject: `Your Marginalia code: ${code}`,
  text: `Your Marginalia sign-in code is ${code}.\n\nIt expires in 5 minutes.\n\nIf you didn’t ask for this, you can ignore this email.\n`,
});

export function resendMailer(apiKey: string): Mailer {
  return {
    async send(mail) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(mail),
      });
      if (!res.ok) throw new Error(`Resend refused the email: ${res.status} ${await res.text()}`);
    },
  };
}

// The browser tests read their codes from this file (one JSON email per line).
export function outboxMailer(file: string): Mailer {
  return {
    async send(mail) {
      await appendFile(file, `${JSON.stringify(mail)}\n`);
    },
  };
}

// Resend in production; the outbox file for the browser tests; in development without a key, the
// code is printed to the dev server's console.
export function appMailer(env: Record<string, string | undefined> = process.env): Mailer {
  if (env.MAIL_OUTBOX_FILE) return outboxMailer(env.MAIL_OUTBOX_FILE);
  if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY);
  return {
    async send(mail) {
      if (env.NODE_ENV === "production") throw new Error("RESEND_API_KEY is not set, so no email can be sent.");
      console.log(`[mail to ${mail.to}] ${mail.text}`);
    },
  };
}
