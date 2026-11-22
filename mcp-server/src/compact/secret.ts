import { createCipheriv, randomBytes } from "node:crypto";
import { isClientAbort, type CompactContext, type ToolAnswer } from "./context.js";
import { apiError, record } from "./settings-domains.js";

/** Contract of `POST /api/secrets` (OpenAPI `createSecret`). */
export const SECRET_TTLS = ["1h", "1d", "7d", "30d"] as const;
export const SECRET_MAX_VIEWS = 10;
const MAX_CIPHERTEXT_CHARS = 54_000;
const SECRET_ID = /^[A-Za-z0-9_-]{22}$/;

export interface SealedSecret { ciphertext: string; iv: string; key: string }

/** AES-GCM-256 like the app's secret-crypto.js: ciphertext+16-byte tag, iv, 32-byte key, all base64url; fixed bytes only from tests. */
export function sealSecret(text: string, fixed?: { key: Uint8Array; iv: Uint8Array }): SealedSecret {
  const key = fixed?.key ?? randomBytes(32);
  const iv = fixed?.iv ?? randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const sealed = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext: sealed.toString("base64url"), iv: Buffer.from(iv).toString("base64url"), key: Buffer.from(key).toString("base64url") };
}

export interface SecretArgs { text?: string; ttl?: typeof SECRET_TTLS[number]; maxViews?: number }

/** `publish` kind=secret: encrypts here, stores only ciphertext and returns the one link that carries the key in its #fragment. */
export async function publishSecret(context: CompactContext, { text, ttl, maxViews }: SecretArgs): Promise<ToolAnswer> {
  if (text === undefined || text.trim().length === 0) {
    return context.refuse("create secret", { why: "`text` is required for kind=secret.", next: 'Use {"kind":"secret","text":"<the password or key>"}.' });
  }
  const sealed = sealSecret(text);
  if (sealed.ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    return context.refuse("create secret", { why: "The text is too long for a one-time secret (about 40 KB of UTF-8 at most).",
      next: "Share a shorter secret, or publish longer material as a password-protected page." });
  }
  let answer;
  try {
    answer = await context.api("POST", context.apiPath("secrets"), { ciphertext: sealed.ciphertext, iv: sealed.iv, ttl, maxViews });
  } catch (error) {
    if (isClientAbort(error)) throw error;
    return context.text("BrewPage did not confirm the secret. No link was given out, so nothing can open it; create it again if needed.", true);
  }
  const data = record(answer.data);
  if (!answer.ok) return context.text(`Failed to create secret: ${apiError(answer)}`, true);
  if (typeof data.id !== "string" || !SECRET_ID.test(data.id) || typeof data.expiresAt !== "string" || typeof data.maxViews !== "number") {
    return context.text("BrewPage returned an invalid secret receipt. No link was given out; create it again if needed.", true);
  }
  const link = `${new URL(context.publicOrigin).origin}/secret/${data.id}#${sealed.key}`;
  const views = data.maxViews === 1 ? "once" : `${data.maxViews} times`;
  const structuredContent = { kind: "secret", id: data.id, link, expiresAt: data.expiresAt, maxViews: data.maxViews };
  return { ...context.text([
    "One-time secret created.",
    `SECRET LINK (give it only to the intended recipient): ${link}`,
    `It can be opened ${views}, then it stops working; unopened, it expires at ${data.expiresAt}.`,
    "The key is only in the link's #fragment: BrewPage stores ciphertext and never sees the key or the text. " +
      "This MCP server and you saw the plain text: do not repeat it elsewhere. Do not open the link yourself; pressing Show secret spends a view.",
    JSON.stringify(structuredContent),
  ].join("\n")), structuredContent };
}
