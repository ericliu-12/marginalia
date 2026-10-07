// The colour is set per kind, never overridden: two text colours on one element resolve by stylesheet order.
const quietLinkBase =
  "min-h-11 min-w-11 font-sans text-[0.8rem] font-medium underline decoration-rule underline-offset-4 transition-colors duration-150 hover:decoration-ink lg:min-h-0 lg:min-w-0";
export const quietLink = `${quietLinkBase} text-ink-3 hover:text-ink disabled:text-ink-3/60`;
// The confirming step of a deletion.
export const dangerLink = `${quietLinkBase} text-contrast hover:decoration-contrast disabled:text-contrast/60`;
