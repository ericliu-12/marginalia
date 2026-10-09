import { appAuth } from "@/lib/auth";

// Better Auth's endpoints (sending and checking email codes, the session). Built on first request, not at
// import, so `next build` needs none of its settings.
export const GET = (request: Request) => appAuth().handler(request);
export const POST = (request: Request) => appAuth().handler(request);
