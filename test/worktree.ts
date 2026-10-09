import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// A ticket's worktree (`pnpm ticket` checks it out at ../marginalia-<number>) gets its own test databases,
// e2e port and e2e files, so its tests run beside the main checkout's and other worktrees'. The main
// checkout keeps the plain names.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ticket = basename(root).match(/^marginalia-(\d+)$/)?.[1];

// `name`, or `name<separator><ticket number>` in a ticket's worktree.
export const perWorktree = (name: string, separator = "_") => (ticket ? `${name}${separator}${ticket}` : name);

export const E2E_PORT = ticket ? 4000 + Number(ticket) : 3100;
