import { useEffect, useMemo, useState } from "react";
import { loadPageData, type PageData } from "./index.js";
import type { Collection, Reason, Role, State, Stats, StatsOptions } from "./types.js";

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

export function usePageData(): PageDataValue {
  const [value, setValue] = useState(IDLE);
  useEffect(() => {
    let live = true;
    void open().then((data) => {
      if (live) setValue({ state: data.state, reason: data.reason, ready: true });
    });
    return () => {
      live = false;
    };
  }, []);
  return value;
}

/** `null` before ready or without Page data. */
export function useCollection(name: string): Collection | null {
  const { state } = usePageData();
  return useMemo(() => (state ? state.col(name) : null), [state, name]);
}

/** `null` until the first answer, then live. */
export function useStats(name: string, opts?: StatsOptions): Stats | null {
  const collection = useCollection(name);
  const countBy = opts?.countBy;
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    setStats(null);
    if (!collection) return;
    return collection.onStats(countBy === undefined ? {} : { countBy }, setStats);
  }, [collection, countBy]);
  return stats;
}

/** `"visitor"` until ready. */
export function useRole(): Role {
  const { state } = usePageData();
  const [role, setRole] = useState<Role>("visitor");
  useEffect(() => {
    if (!state) return;
    let live = true;
    state.onRole((next) => {
      if (live) setRole(next === "owner" ? "owner" : "visitor");
    });
    return () => {
      live = false;
    };
  }, [state]);
  return role;
}
