import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { z } from "zod";

export const LEGACY_TOOL_NAMES = [
  "publish_html", "publish_file", "delete_resource", "get_page", "get_stats", "update_html", "publish_json",
  "update_json", "publish_kv", "set_kv", "get_limits", "search_gallery", "set_publication", "make_private",
  "bind_token", "mint_token", "set_domain", "list_domains", "check_domain", "remove_domain", "get_page_data",
  "set_page_data", "configure_page_data", "delete_page_data", "get_guide",
] as const;
export type LegacyToolName = typeof LEGACY_TOOL_NAMES[number];

export const COMPACT_TOOL_NAMES = [
  "publish", "list_publications", "read_publication", "update_publication", "publication_settings",
  "delete_publication", "read_page_data", "write_page_data", "delete_page_data", "domains", "account",
  "notifications", "get_guide",
] as const;
export type CompactToolName = typeof COMPACT_TOOL_NAMES[number];

export type PublicationKind = "html" | "site" | "file" | "json" | "kv";
export interface Target {
  kind: PublicationKind;
  namespace: string;
  id: string;
}
export type StateConfig = Record<string, unknown> | null;
export type ToolShape = Record<string, z.ZodType>;
export interface ToolSpec<Shape extends ToolShape> {
  title: string;
  annotations: ToolAnnotations;
  description: string;
  inputSchema: Shape;
  hidden?: ReadonlyArray<keyof Shape & string>;
  oauthScopes?: readonly Scope[];
}
export interface ToolAnswer {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  structuredContent?: Record<string, unknown>;
}
export interface Refusal { why: string; next: string }
export interface ApiAnswer { ok: boolean; status: number; data: unknown; headers: Headers }
export type OwnerProof = { ownerToken: string } | { manageKey: string };
export function bridgeOutcomeUnknown({ status, data }: ApiAnswer): boolean {
  return status === 502 && typeof data === "object" && data !== null && "code" in data && data.code === "bridge_outcome_unknown";
}

export function isTimeout(error: unknown): boolean {
  const { name, cause } = (error ?? {}) as { name?: unknown; cause?: { name?: unknown } | null };
  return name === "TimeoutError" || (name === "AbortError" && cause?.name === "TimeoutError");
}

export function isClientAbort(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === "AbortError" && !isTimeout(error);
}

export type Scope = "publications:read" | "publications:write" | "page-data:read" | "page-data:write"
  | "domains:read" | "domains:write" | "account:read" | "account:write";

interface CreateOptions {
  password?: string;
  ttlDays?: string | number;
  tags?: string[];
  deliveryMode?: "path" | "subdomain";
  state?: StateConfig;
  domain?: string;
  linkName?: string;
}
type Artifact =
  | { kind: "html"; content: string; format?: string; template?: string; filename?: string; showTopBar?: boolean; verbatim?: boolean }
  | { kind: "site"; files: Array<{ path: string; content: string }>; entry?: string }
  | { kind: "json"; json: unknown }
  | { kind: "kv"; key: string; value: string };
interface PublicationChanges {
  action?: "make_private" | "make_public" | "rotate_link" | "reset_manage_link" | "revoke_reader_access";
  listed?: boolean;
  badgeHidden?: boolean;
  title?: string;
  password?: string | null;
  extend?: boolean;
  deliveryMode?: "path" | "subdomain";
  expectedVersion?: number;
  linkName?: string | null;
  tags?: string[];
  state?: StateConfig;
}
interface PageAddress { kind?: "html" | "site"; namespace: string; id: string }

export interface BridgeInputs {
  publish: Artifact & CreateOptions & { namespace?: string };
  publish_file: CreateOptions & { kind: "file"; namespace?: string; filename?: string };
  list_publications: { kind?: PublicationKind; scope?: "mine"; status?: string; tag?: string; q?: string; expiring?: boolean; cursor?: string; limit?: number };
  read_publication: Target & { view?: "content" | "source" | "settings" | "stats"; key?: string; path?: string; offset?: number; range?: number; tz?: string; password?: string };
  update_publication: Artifact & CreateOptions & { namespace: string; id: string };
  update_file: Target & { kind: "file"; filename?: string };
  publication_settings: Target & Omit<PublicationChanges, "badgeHidden" | "title"> & { badgeHidden?: boolean | null; title?: string | null };
  delete_publication: Target & { key?: string };
  read_page_data: PageAddress & { collection?: string; order?: string; limit?: number; cursor?: string; countBy?: string; include?: "docs" | "files"; format?: "csv"; fileId?: string };
  write_page_data: PageAddress & { collection: string; docs: Array<{ key: string; value: unknown; version?: number }> };
  delete_page_data: PageAddress & { collection: string; docIds?: string[]; fileIds?: string[]; after?: string; before?: string; all?: boolean };
  merge_page_data: PageAddress & { state: StateConfig };
  search_gallery: { page?: number; size?: number; sort?: "date" | "views"; q?: string };
  limits: Record<string, never>;
  domains: Partial<Target> & { action?: "list" | "get" | "add" | "attach" | "check" | "detach" | "remove"; hostname?: string };
  account: Partial<Target> & { action?: "status" | "tokens" | "bind_token" | "mint_token" | "rename_token" | "revoke_token" | "revoke_others" | "claim" | "unclaim";
    tokenId?: string; label?: string; scope?: "publish" | "admin"; expiresIn?: "30d" | "90d" | "1y" | "never"; keep?: string[] };
  notifications: Partial<Target> & { action?: "list" | "unread_count" | "mark_read" | "get_settings" | "set_settings" | "get_page_switch" | "set_page_switch";
    section?: "notices" | "activity"; unread?: boolean; limit?: number; cursor?: string; ids?: number[]; all?: boolean; entries?: boolean | null;
    settings?: { enabled?: boolean; channel?: "site" | "site_email"; groups?: Partial<Record<"pages" | "entries", boolean>> } };
}
export type BridgeOperation = keyof BridgeInputs;
export type BridgeOptions<Operation> = Operation extends "publish_file" | "update_file" ? { file: Blob }
  : Operation extends "merge_page_data" ? { proof?: OwnerProof } : never;

export interface CompactContext {
  register<Shape extends ToolShape>(name: CompactToolName, spec: ToolSpec<Shape>,
    handler: (args: z.infer<z.ZodObject<Shape>>, cachedCall: boolean) => ToolAnswer | Promise<ToolAnswer>): void;
  legacy(name: LegacyToolName, args: Readonly<Record<string, unknown>>): Promise<ToolAnswer>;
  publicOrigin: string;
  accountOrigin: string;
  accountActionUrl(input: string): string | undefined;
  resolveNamespace(namespace?: string): string;
  siteForm(files: Array<{ path: string; content: string }>, stateText?: string): FormData;
  readPart(value: string, offset?: number): { header: string[]; part: string } | { refusal: Refusal };
  api(method: string, path: string, body?: unknown, headers?: Record<string, string>, responseType?: "json" | "text"): Promise<ApiAnswer>;
  raw(path: string, options: RequestInit): Promise<Response>;
  apiPath(...segments: string[]): string;
  withQuery(path: string, params: Array<[string, string | number | undefined]>): string;
  text(message: string, isError?: boolean): ToolAnswer;
  refuse(operation: string, refusal: Refusal): ToolAnswer;
  ownerToken(explicit?: string): { token?: string; fromEnv: boolean };
  manageTarget(link: string): (Target & { key: string }) | { refusal: Refusal };
  fetchSource(url: string): Promise<Blob>;
  authority: "unsigned" | "account";
  bridge<Operation extends BridgeOperation>(operation: Operation, args: BridgeInputs[Operation],
    options?: BridgeOptions<Operation>): Promise<ApiAnswer>;
}
