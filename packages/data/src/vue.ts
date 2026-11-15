import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { loadPageData, type PageData } from "./index.js";
import type { Collection, Reason, Role, State, Stats, StatsOptions, Unsubscribe } from "./types.js";

export interface PageDataRefs {
  state: ShallowRef<State | null>;
  reason: Ref<Reason | null>;
  /** False until `state()` settles. */
  ready: Ref<boolean>;
}

async function open(): Promise<PageData> {
  if (!(await loadPageData())) return { state: null, reason: "unavailable" };
  const state = await window.brewpage!.state();
  return { state, reason: window.brewpage!.state.reason };
}

function teardown(fn: () => void): void {
  if (getCurrentScope()) onScopeDispose(fn);
}

export function usePageData(): PageDataRefs {
  const state = shallowRef<State | null>(null);
  const reason = ref<Reason | null>(null);
  const ready = ref(false);
  let live = true;
  teardown(() => {
    live = false;
  });
  // Nothing on the server: the client settles after hydration.
  if (typeof window !== "undefined") {
    void open().then((data) => {
      if (!live) return;
      state.value = data.state;
      reason.value = data.reason;
      ready.value = true;
    });
  }
  return { state, reason, ready };
}

/** `null` before ready or without Page data. */
export function useCollection(name: string): ComputedRef<Collection | null> {
  const { state } = usePageData();
  return computed(() => (state.value ? state.value.col(name) : null));
}

/** `null` until the first answer, then live. */
export function useStats(name: string, opts?: StatsOptions): ShallowRef<Stats | null> {
  const collection = useCollection(name);
  const stats = shallowRef<Stats | null>(null);
  let stop: Unsubscribe | null = null;
  const end = () => {
    if (stop) stop();
    stop = null;
  };
  watch(
    collection,
    (current) => {
      end();
      if (current) {
        stop = current.onStats(opts ?? {}, (next) => {
          stats.value = next;
        });
      }
    },
    { immediate: true },
  );
  teardown(end);
  return stats;
}

/** `"visitor"` until ready. */
export function useRole(): Ref<Role> {
  const { state } = usePageData();
  const role = ref<Role>("visitor");
  let live = true;
  teardown(() => {
    live = false;
  });
  watch(
    state,
    (current) => {
      if (!current) return;
      current.onRole((next) => {
        if (live) role.value = next === "owner" ? "owner" : "visitor";
      });
    },
    { immediate: true },
  );
  return role;
}
