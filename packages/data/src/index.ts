import type { Brewpage, Reason, State } from "./types.js";

export type * from "./types.js";

/** The platform's Page data script; the package never bundles it. */
export const SDK_URL = "https://brewpage.app/js/state.js";

export interface PageData {
  state: State | null;
  reason: Reason | null;
}

let pending: Promise<Brewpage | null> | null = null;

function settled(tag: HTMLScriptElement): Promise<void> {
  return new Promise((done) => {
    const end = () => done();
    tag.addEventListener("load", end, { once: true });
    tag.addEventListener("error", end, { once: true });
    window.addEventListener("load", end, { once: true });
  });
}

function inject(): Promise<Brewpage | null> {
  return new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = SDK_URL;
    tag.async = true;
    tag.onload = () => resolve(window.brewpage ?? null);
    tag.onerror = () => {
      tag.remove();
      resolve(null);
    };
    document.head.appendChild(tag);
  });
}

async function load(): Promise<Brewpage | null> {
  // A tag of the page's own that has not run yet wins over a second copy.
  const own = document.querySelector<HTMLScriptElement>('script[src$="/js/state.js"]');
  if (own && document.readyState !== "complete") {
    await settled(own);
    if (window.brewpage) return window.brewpage;
  }
  const sdk = await inject();
  if (!sdk) pending = null;
  return sdk;
}

/** The SDK object: the page's own tag when present, else one injected tag; `null` without a browser or when the script fails. */
export function loadPageData(): Promise<Brewpage | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  if (window.brewpage) return Promise.resolve(window.brewpage);
  if (!pending) pending = load();
  return pending;
}

/** Loads the SDK and opens the page's data: `state` is `null` with a `reason` when the page has none. */
export async function openPageData(): Promise<PageData> {
  if (!(await loadPageData())) return { state: null, reason: "unavailable" };
  const state = await window.brewpage!.state();
  return { state, reason: window.brewpage!.state.reason };
}
