import type { NextConfig } from "next";

// agentRules: false stops `next dev` from appending to the project CLAUDE.md.
const nextConfig: NextConfig = { agentRules: false } as NextConfig;

export default nextConfig;
