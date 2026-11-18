import type { Target } from "./context.js";

export const PUBLICATION_SEGMENTS = { html: "html", site: "sites", file: "files", json: "json", kv: "kv" } as const;

export function validatedAccountManagementUrl(link: unknown, accountOrigin: string,
  { kind, namespace, id }: Omit<Target, "kind"> & { kind?: Target["kind"] }): string | undefined {
  if (typeof link !== "string" || !URL.canParse(link)) return;
  const url = new URL(link);
  if (url.origin !== accountOrigin || !["https:", "http:"].includes(url.protocol)) return;
  const segments = kind ? [PUBLICATION_SEGMENTS[kind]] : [PUBLICATION_SEGMENTS.html, PUBLICATION_SEGMENTS.site];
  const address = `${encodeURIComponent(namespace)}/${encodeURIComponent(id)}`;
  if (segments.some((segment) => url.href === `${accountOrigin}/p/${segment}/${address}`)) return url.href;
}
