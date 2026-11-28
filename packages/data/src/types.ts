// Types of the BrewPage Page data browser SDK; checked against test/fixtures/sdk-surface.json.

/** Why `state()` resolved `null`. */
export type Reason = "unavailable" | "needs_subdomain" | "embedded";

export type Role = "owner" | "visitor";

export type StateErrorCode =
  | "account_required"
  | "challenge_cancelled"
  | "challenge_failed"
  | "challenge_unavailable"
  | "error"
  | "file_type"
  | "invalid_argument"
  | "mode_forbidden"
  | "network"
  | "not_found"
  | "not_owner"
  | "quota"
  | "rate_limited"
  | "too_large"
  | "unavailable"
  | "value_refused";

export type ListOrder = "createdAt" | "-createdAt" | "updatedAt" | "-updatedAt" | "index" | "-index";

export interface ListOptions {
  /** Newest first when omitted; `updatedAt` orders work on the visitor's own private lists only. */
  order?: ListOrder;
  /** 1..100, 20 when omitted. */
  limit?: number;
  /** `next` of the previous page. */
  cursor?: string | null;
  /** Owner only: every visitor's entries. */
  all?: boolean;
}

export interface StatsOptions {
  /** Field of the entries to count by. */
  countBy?: string;
}

export interface Doc<T = unknown> {
  key: string;
  id: string;
  value: T;
  version: number;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
  /** Owner's `all` list only: visitor label, `null` for an author entry. */
  visitor?: string | null;
}

export interface DocMeta {
  key: string;
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A real array of entries plus the cursor of the next page. */
export interface DocList<T = unknown> extends Array<Doc<T>> {
  next: string | null;
}

export interface Stats {
  count: number;
  scope: "all" | "own";
  /** Present only with `countBy`. */
  by?: Record<string, number>;
}

export interface FileMeta {
  id: string;
  /** Host-free path: `img.src = file.url`. */
  url: string;
  name: string | null;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export type Unsubscribe = () => void;

export interface Collection {
  readonly name: string;
  /** Own entry's value, `null` when absent. */
  get<T = unknown>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<DocMeta>;
  add<T>(value: T): Promise<DocMeta>;
  remove(key: string): Promise<boolean>;
  /** Owner only: any entry of this list. */
  removeById(id: string): Promise<boolean>;
  list<T = unknown>(opts?: ListOptions): Promise<DocList<T>>;
  stats(opts?: StatsOptions): Promise<Stats>;
  /** Live totals: `fn` now and after changes; returns the unsubscribe function. */
  onStats(fn: (stats: Stats) => void): Unsubscribe;
  onStats(opts: StatsOptions, fn: (stats: Stats) => void): Unsubscribe;
  /** Whether this list takes visitor files now. */
  readonly files: boolean;
  upload(file: Blob): Promise<FileMeta>;
  removeFile(id: string): Promise<boolean>;
}

export interface State {
  /** Throws `StateError("invalid_argument")` on a bad name. */
  col(name: string): Collection;
  /** Live; compare with `=== "owner"`. */
  readonly role: Role;
  /** `fn(role)` at once, then once per change. */
  onRole(fn: (role: string) => void): void;
  /** BrewPage sign-in on this page; `undefined` while it is unavailable here. */
  readonly identity: Identity | undefined;
  /** This visitor holds an entry or file on this page. */
  readonly saved: boolean;
  /** `false` when the page shows no offer to sign in. */
  readonly accountOffer: boolean;
  /** Guest entries of this browser not yet moved to the account; `null` when none. */
  readonly claim: AccountClaim | null;
  /** `fn(identity)` at once, then once per change. */
  onIdentity(fn: (identity: Identity | undefined) => void): void;
  /** Call inside a tap: opens BrewPage sign-in in a new tab; a blocked tab answers its `url`. */
  signIn(): Promise<SignInResult>;
  /** This browser is its own guest again on this page; nothing is deleted. */
  signOut(): Promise<void>;
  /** `browser` replaces the account's colliding entries, `account` drops this browser's. */
  claimAnonymous(opts: { keep: "browser" | "account" }): Promise<{ moved: number }>;
}

export type Identity = "anonymous" | "account";

export interface AccountClaim {
  entries: number;
  conflicts: number;
  browserAt: string | null;
  accountAt: string | null;
}

export type SignInResult = { blocked: false } | { blocked: true; url: string };

/** Stand-in on `file:` and loopback addresses: data stays in the browser. */
export interface LocalState extends State {
  readonly local: boolean;
  /** No BrewPage sign-in here: always `undefined`. */
  readonly identity: undefined;
  /** Rejects `unavailable`, like `signIn` and `signOut`. */
  claimAnonymous(): Promise<never>;
}

export interface LocalCollection extends Collection {}

export interface StateFn {
  /** Never rejects; `null` when the page has no Page data (see `reason`). */
  (): Promise<State | null>;
  readonly reason: Reason | null;
}

/** localStorage-like map kept with the page's data. */
export interface PageStorage {
  /** Never rejects. */
  readonly ready: Promise<void>;
  readonly mode: "server" | "local" | "memory";
  readonly length: number;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
}

export interface StateError extends Error {
  name: "BpStateError";
  code: StateErrorCode;
  /** HTTP status, 0 = no response. */
  status: number;
  /** Seconds. */
  retryAfter: number | null;
  serverCode: string | null;
}

export interface StateErrorConstructor {
  new (
    code: StateErrorCode,
    message: string,
    status?: number,
    retryAfter?: number | null,
    serverCode?: string | null,
  ): StateError;
}

/** The SDK object behind `window.brewpage` (and `window.bp` when that name is free). */
export interface Brewpage {
  readonly __brewpage: number;
  readonly version: string;
  state: StateFn;
  /** A text node of the value: safe way to show visitor input. */
  text(value: unknown): Text;
  readonly storage: PageStorage;
  readonly StateError: StateErrorConstructor;
}

declare global {
  interface Window {
    bp?: Brewpage;
    brewpage?: Brewpage;
  }
}
