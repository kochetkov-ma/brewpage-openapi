import type { PublicationKind, Refusal, Target } from "./context.js";

export const PUBLICATION_SEGMENTS = { html: "html", site: "sites", file: "files", json: "json", kv: "kv" } as const;
export const DEFAULT_ACCOUNT_ORIGIN = "https://account.brewpage.app";

export function validatedAccountManagementUrl(link: unknown, accountOrigin: string,
  { kind, namespace, id }: Omit<Target, "kind"> & { kind?: Target["kind"] }): string | undefined {
  if (typeof link !== "string" || !URL.canParse(link)) return;
  const url = new URL(link);
  if (url.origin !== accountOrigin || !["https:", "http:"].includes(url.protocol)) return;
  const segments = kind ? [PUBLICATION_SEGMENTS[kind]] : [PUBLICATION_SEGMENTS.html, PUBLICATION_SEGMENTS.site];
  const address = `${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
  if (segments.some((segment) => url.href === `${accountOrigin}/p/${segment}/${address}`)) return url.href;
}

export type AccountLinkTarget = Target | { kind: "secret"; id: string };

const KINDS: Record<string, PublicationKind> = { html: "html", sites: "site", files: "file", json: "json", kv: "kv" };
const ACCOUNT_PUBLICATION_PATH = /^\/p\/(html|sites|files|json|kv)\/([^/]+)\/([A-Za-z0-9]{10})\/?$/;
const ACCOUNT_SECRET_PATH = /^\/p\/secrets\/([A-Za-z0-9]{10})\/?$/;

/** Account management link a signed receipt returns (`{account}/p/<segment>/<ns>/<id>`, `/p/secrets/<ref>`) -> its target. */
export function accountLinkTarget(link: unknown, accountOrigin = DEFAULT_ACCOUNT_ORIGIN): AccountLinkTarget | undefined {
  if (typeof link !== "string" || !URL.canParse(link.trim())) return;
  const url = new URL(link.trim());
  if (url.origin !== new URL(accountOrigin).origin || url.username || url.password || url.search || url.hash) return;
  const secret = ACCOUNT_SECRET_PATH.exec(url.pathname);
  if (secret) return { kind: "secret", id: secret[1] };
  const path = ACCOUNT_PUBLICATION_PATH.exec(url.pathname);
  if (!path) return;
  let namespace: string;
  try { namespace = decodeURIComponent(path[2]); } catch { return; }
  if (/^[a-z0-9-]{1,32}$/.test(namespace)) return { kind: KINDS[path[1]], namespace, id: path[3] };
}

/** Tools that take an account link, and the kinds each can act on. */
const ACCOUNT_LINK_KINDS: Partial<Record<string, readonly AccountLinkTarget["kind"][]>> = {
  read_publication: ["html", "site", "file", "json", "kv", "secret"],
  update_publication: ["html", "site", "file", "json", "kv", "secret"],
  publication_settings: ["html", "site", "file", "json", "kv", "secret"],
  delete_publication: ["html", "site", "file", "json", "kv", "secret"],
  read_page_data: ["html", "site"],
  write_page_data: ["html", "site"],
  delete_page_data: ["html", "site"],
};

export const ACCOUNT_LINK_NEEDS_ACCOUNT: Refusal = {
  why: "this is the owner's account management link: it carries no key and works only while this client is signed in to the owning BrewPage account.",
  next: "connect BrewPage in this client and send it again (or kind and id), or use the private manageUrl with #k= or the ownerToken from an unsigned receipt.",
};

/** A call naming an account link -> the same call by kind, namespace and id; undefined = no account link. */
export function fromAccountLink(tool: string, args: Record<string, unknown>, accountOrigin: string):
  { args: Record<string, unknown> } | { refusal: Refusal } | undefined {
  const target = accountLinkTarget(args.manageUrl, accountOrigin);
  if (!target) return;
  const kinds = ACCOUNT_LINK_KINDS[tool];
  if (!kinds) return { refusal: { why: "this operation does not take an account management link.", next: "send kind, namespace and id from the receipt." } };
  if (!kinds.includes(target.kind)) {
    return { refusal: { why: "this account link is for another kind of publication.", next: "Page data exists only on HTML pages and sites: pass the account link of the page or site." } };
  }
  const { manageUrl: _link, ...rest } = args;
  const fields = { kind: target.kind, ...("namespace" in target ? { namespace: target.namespace } : {}), id: target.id };
  const mixed = rest.ownerToken !== undefined || (["kind", "namespace", "id"] as const)
    .some((field) => rest[field] !== undefined && rest[field] !== (fields as Record<string, unknown>)[field]);
  if (mixed) return { refusal: { why: "the account link was mixed with another target or owner token.", next: "send the account link alone." } };
  return { args: { ...rest, ...fields } };
}
