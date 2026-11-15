import { derived, readable, type Readable } from "svelte/store";
import { loadPageData, type PageData } from "./index.js";
import type { Reason, Role, State, Stats, StatsOptions } from "./types.js";

export interface PageDataValue {
  state: State | null;
  reason: Reason | null;
  /** False until `state()` settles. */
  ready: boolean;
}

const IDLE: PageDataValue = { state: null, reason: null, ready: false };

async function open(): Promise<PageData> {
  if (!(await loadPageData())) return { state: null, reason: "unavailable" };
  const state = await window.brewpage!.state();
  return { state, reason: window.brewpage!.state.reason };
}

/** Opens on the first subscriber; stays idle on the server. */
export const pageData: Readable<PageDataValue> = readable(IDLE, (set) => {
  if (typeof window === "undefined") return;
  let live = true;
  void open().then((data) => {
    if (live) set({ state: data.state, reason: data.reason, ready: true });
  });
  return () => {
    live = false;
  };
});

/** `null` until the first answer, then live. */
export function stats(name: string, opts?: StatsOptions): Readable<Stats | null> {
  return derived(
    pageData,
    ($data, set: (value: Stats | null) => void) => {
      set(null);
      if (!$data.state) return;
      return $data.state.col(name).onStats(opts ?? {}, set);
    },
    null as Stats | null,
  );
}

/** `"visitor"` until ready. */
export const role: Readable<Role> = derived(
  pageData,
  ($data, set: (value: Role) => void) => {
    if (!$data.state) return;
    let live = true;
    $data.state.onRole((next) => {
      if (live) set(next === "owner" ? "owner" : "visitor");
    });
    return () => {
      live = false;
    };
  },
  "visitor" as Role,
);
