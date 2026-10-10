"use client";

import { useCallback, useRef } from "react";

// Cloudflare Turnstile, which the server asks for before it sends a sign-in code (#65).

type RenderOptions = {
  sitekey: string;
  appearance: "interaction-only";
  size: "flexible";
  theme: "light";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
};
type TurnstileApi = { render: (el: HTMLElement, options: RenderOptions) => string; reset: (id: string) => void; remove: (id: string) => void };

let loading: Promise<TurnstileApi> | undefined;
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => resolve((window as unknown as { turnstile: TurnstileApi }).turnstile);
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Turnstile didn't load"));
    };
    document.head.append(script);
  });
  return loading;
}

type Waiter = { resolve: (token: string) => void; reject: () => void };

// `container` goes on the element the widget lives in; it shows only when Cloudflare needs a click.
// `token()` waits for a pass and rejects if the check failed. A token is good for one request, so
// `used()` after each starts the next check.
export function useTurnstile(siteKey: string) {
  const state = useRef<{ token?: string; failed: boolean; widget?: string; el?: HTMLDivElement; waiters: Waiter[] }>({ failed: false, waiters: [] });

  const settle = (token: string | null) => {
    const s = state.current;
    s.token = token ?? undefined;
    s.failed = token === null;
    for (const w of s.waiters.splice(0)) token === null ? w.reject() : w.resolve(token);
  };

  // Renders the widget into `el` once the script is in; `retry` starts again after a failure.
  const mount = useCallback(
    (el: HTMLDivElement) => {
      let gone = false;
      let widget: string | undefined;
      state.current.el = el;
      loadTurnstile().then(
        (api) => {
          if (gone) return;
          widget = state.current.widget = api.render(el, {
            sitekey: siteKey,
            appearance: "interaction-only",
            size: "flexible",
            // Marginalia has only its light paper.
            theme: "light",
            callback: (token) => settle(token),
            // Handled here, as the form's own message; Turnstile keeps retrying, and a later pass clears it.
            "error-callback": () => (settle(null), true),
            "expired-callback": () => (state.current.token = undefined),
          });
        },
        () => settle(null),
      );
      return () => {
        gone = true;
        if (widget) loading?.then((api) => api.remove(widget!));
        const s = state.current;
        if (s.widget === widget) Object.assign(s, { widget: undefined, token: undefined, failed: false });
      };
    },
    [siteKey],
  );
  const unmount = useRef<() => void>(undefined);
  const container = useCallback(
    (el: HTMLDivElement) => {
      unmount.current = mount(el);
      return () => unmount.current?.();
    },
    [mount],
  );
  const retry = () => {
    const s = state.current;
    s.failed = false;
    if (s.widget) loading?.then((api) => api.reset(s.widget!));
    else if (s.el) {
      unmount.current?.();
      unmount.current = mount(s.el);
    }
  };

  const token = () =>
    new Promise<string>((resolve, reject) => {
      const s = state.current;
      if (s.token) return resolve(s.token);
      // Failed last time (a blip, or the script was blocked): check again rather than give up at once.
      if (s.failed) retry();
      s.waiters.push({ resolve, reject });
    });

  const used = () => {
    const s = state.current;
    s.token = undefined;
    if (s.widget) loading?.then((api) => api.reset(s.widget!));
  };

  return { container, token, used };
}
