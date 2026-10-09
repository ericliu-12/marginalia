// The site's own address (https://inkmarginalia.com in production), for anything that must be absolute:
// auth callbacks, redirects to another host, links printed by scripts. Never the request's URL, which
// behind Railway's proxy is the server's own address (localhost:8080).
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.NODE_ENV === "production") throw new Error("BETTER_AUTH_URL is not set.");
  return "http://localhost:3000";
}
