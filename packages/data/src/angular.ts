import { DestroyRef, inject, signal, type Signal } from "@angular/core";
import { loadPageData, type PageData } from "./index.js";
import type { Reason, Role, State, Stats, StatsOptions, Unsubscribe } from "./types.js";

export interface PageDataSignals {
  state: Signal<State | null>;
  reason: Signal<Reason | null>;
  /** False until `state()` settles. */
  ready: Signal<boolean>;
  /** `"visitor"` until ready. */
  role: Signal<Role>;
  /** `null` until the first answer, then live. */
  stats(name: string, opts?: StatsOptions): Signal<Stats | null>;
}

async function open(): Promise<PageData> {
  if (!(await loadPageData())) return { state: null, reason: "unavailable" };
  const state = await window.brewpage!.state();
  return { state, reason: window.brewpage!.state.reason };
}

/** Call in an injection context (field initializer or constructor). */
export function injectPageData(): PageDataSignals {
  const state = signal<State | null>(null);
  const reason = signal<Reason | null>(null);
  const ready = signal(false);
  const role = signal<Role>("visitor");
  const waiting: Array<(opened: State) => void> = [];
  const stops: Unsubscribe[] = [];
  let live = true;
  inject(DestroyRef).onDestroy(() => {
    live = false;
    for (const stop of stops.splice(0)) stop();
  });
  // Nothing on the server: the client settles after hydration.
  if (typeof window !== "undefined") {
    void open().then((data) => {
      if (!live) return;
      state.set(data.state);
      reason.set(data.reason);
      ready.set(true);
      const opened = data.state;
      if (!opened) return;
      opened.onRole((next) => {
        if (live) role.set(next === "owner" ? "owner" : "visitor");
      });
      for (const attach of waiting.splice(0)) attach(opened);
    });
  }
  return {
    state: state.asReadonly(),
    reason: reason.asReadonly(),
    ready: ready.asReadonly(),
    role: role.asReadonly(),
    stats(name, opts) {
      const stats = signal<Stats | null>(null);
      const attach = (opened: State) => {
        stops.push(opened.col(name).onStats(opts ?? {}, (next) => stats.set(next)));
      };
      const opened = state();
      if (opened) {
        if (live) attach(opened);
      } else waiting.push(attach);
      return stats.asReadonly();
    },
  };
}
