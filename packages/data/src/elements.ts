import { loadPageData, type PageData } from "./index.js";
import type { Stats, Unsubscribe } from "./types.js";

async function open(): Promise<PageData> {
  if (!(await loadPageData())) return { state: null, reason: "unavailable" };
  const state = await window.brewpage!.state();
  return { state, reason: window.brewpage!.state.reason };
}

// Importing on a server must not throw: there is no HTMLElement to extend.
const Base: typeof HTMLElement =
  typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/** `<bp-page-data>`: reflects `role` and `reason`, fires `bp-state` with `{state, reason}`. */
export class BpPageDataElement extends Base {
  #live = false;

  connectedCallback(): void {
    this.#live = true;
    void open().then((data) => {
      if (!this.#live) return;
      if (data.reason) this.setAttribute("reason", data.reason);
      else this.removeAttribute("reason");
      if (data.state) {
        data.state.onRole((role) => {
          if (this.#live) this.setAttribute("role", role);
        });
      } else this.removeAttribute("role");
      this.dispatchEvent(new CustomEvent<PageData>("bp-state", { detail: data, bubbles: true, composed: true }));
    });
  }

  disconnectedCallback(): void {
    this.#live = false;
  }
}

/** `<bp-count list count-by value>`: text = `count`, or `by[value]` when `count-by` and `value` are set. */
export class BpCountElement extends Base {
  static observedAttributes = ["list", "count-by", "value"];

  #stats: Stats | null = null;
  #stop: Unsubscribe | null = null;
  #run = 0;

  connectedCallback(): void {
    this.#subscribe();
  }

  disconnectedCallback(): void {
    this.#end();
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null): void {
    if (before === after || !this.isConnected) return;
    if (name === "value") this.#show();
    else this.#subscribe();
  }

  #end(): void {
    this.#run += 1;
    if (this.#stop) this.#stop();
    this.#stop = null;
  }

  #subscribe(): void {
    this.#end();
    this.#stats = null;
    this.#show();
    const list = this.getAttribute("list");
    if (!list) return;
    const run = this.#run;
    const countBy = this.getAttribute("count-by");
    void open().then((data) => {
      if (run !== this.#run || !data.state) return;
      this.#stop = data.state.col(list).onStats(countBy ? { countBy } : {}, (stats) => {
        this.#stats = stats;
        this.#show();
      });
    });
  }

  #show(): void {
    const stats = this.#stats;
    const value = this.getAttribute("value");
    if (!stats) this.textContent = "";
    else if (this.getAttribute("count-by") && value !== null) this.textContent = String(stats.by?.[value] ?? 0);
    else this.textContent = String(stats.count);
  }
}

/** Registers both elements once; a no-op without `customElements`. */
export function defineElements(): void {
  if (typeof customElements === "undefined") return;
  if (!customElements.get("bp-page-data")) customElements.define("bp-page-data", BpPageDataElement);
  if (!customElements.get("bp-count")) customElements.define("bp-count", BpCountElement);
}

defineElements();

declare global {
  interface HTMLElementTagNameMap {
    "bp-page-data": BpPageDataElement;
    "bp-count": BpCountElement;
  }
  interface HTMLElementEventMap {
    "bp-state": CustomEvent<PageData>;
  }
}
