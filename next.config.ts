import type { NextConfig } from "next";

// agentRules: false stops `next dev` from appending to the project CLAUDE.md.
// DEV_ORIGIN lets another device on the network (a phone, by its host or IP) load the dev server.
const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : [],
} as NextConfig;

export default nextConfig;
