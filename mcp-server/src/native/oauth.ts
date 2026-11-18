import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { discoverAuthorizationServerMetadata, discoverOAuthProtectedResourceMetadata, exchangeAuthorization, refreshAuthorization,
  startAuthorization, type OAuthTokens } from "@modelcontextprotocol/client";
import { knownScopes } from "../compact/auth.js";
import { CLIENT_ID, DEFAULT_SCOPE, type Credential, type CredentialStore, type Deployment, type Selection, subprocess, verifiedCredential } from "./credentials.js";

const CALLBACK = "/oauth/callback";
const PRODUCTION = "https://brewpage.app";
const DEFAULT_ISSUER = "https://account.brewpage.app";
const CLIENT = { client_id: CLIENT_ID, token_endpoint_auth_method: "none" as const };
const MAX_RESPONSE_BYTES = 65_536;

export class NativeReconnectRequired extends Error {
  constructor() { super("Reconnect BrewPage with the explicit login command, or sign out before choosing another identity."); }
}

export function nativeLoginScope(scopes: readonly string[] = [DEFAULT_SCOPE]): string {
  const validated = knownScopes(scopes);
  if (validated.length === 0 || validated.length !== scopes.length) {
    throw new Error("Choose supported BrewPage OAuth permissions for explicit login.");
  }
  return [...new Set(validated)].join(" ");
}

function url(raw: string, base?: string): URL | undefined {
  try { return new URL(raw, base); } catch { return undefined; }
}

export function deploymentFor(baseUrl: string, resource?: string, issuer?: string): Deployment | undefined {
  const base = url(baseUrl);
  if (!base) return undefined;
  const configured = base.origin === PRODUCTION
    ? { resource: resource ?? `${PRODUCTION}/mcp`, issuer: issuer ?? DEFAULT_ISSUER }
    : { resource, issuer };
  const endpoint = configured.resource && url(configured.resource);
  const authority = configured.issuer && url(configured.issuer);
  if (!endpoint || !authority || endpoint.origin !== base.origin || endpoint.href !== `${endpoint.origin}/mcp` ||
    endpoint.protocol !== "https:" || authority.protocol !== "https:" || authority.href !== `${authority.origin}/`) return undefined;
  return { resource: endpoint.href, issuer: authority.origin };
}

function guardedFetch(allowed: ReadonlySet<string>, request: typeof fetch): typeof fetch {
  return async (input, init) => {
    const destination = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!allowed.has(destination)) throw new Error("The OAuth endpoint did not match the configured BrewPage deployment.");
    const response = await request(input, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (let part = await reader.read(); !part.done; part = await reader.read()) {
      length += part.value.length;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("The OAuth server returned an oversized response.");
      }
      chunks.push(part.value);
    }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
}

async function browserOpen(destination: URL): Promise<void> {
  if (process.platform !== "darwin") throw new Error("This host uses the protected credential file for a BrewPage account.");
  const result = await subprocess("/usr/bin/osascript", ["-"], `open location ${JSON.stringify(destination.href)}\n`);
  if (result.code !== 0) throw new Error("Could not open the browser for BrewPage authorization.");
}

async function callbackServer(issuer: string, state: string, timeout: number) {
  let finish!: (value: { code: string; iss: string }) => void;
  let fail!: (error: Error) => void;
  const response = new Promise<{ code: string; iss: string }>((resolve, reject) => { finish = resolve; fail = reject; });
  void response.catch(() => undefined);
  let callback = "";
  let completed = false;
  const server = createServer((req, res) => {
    const incoming = url(req.url ?? "/", callback);
    res.setHeader("Content-Type", "text/plain; charset=UTF-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const only = (name: string) => incoming?.searchParams.getAll(name).length === 1 ? incoming.searchParams.get(name) : null;
    const code = only("code");
    const error = only("error");
    if (!incoming || completed || req.method !== "GET" || req.headers.host !== new URL(callback).host ||
      incoming.origin + incoming.pathname !== callback || only("state") !== state || only("iss") !== issuer ||
      Boolean(code) === Boolean(error) || (code?.length ?? 0) > 4096) {
      res.writeHead(400).end("This callback did not match the BrewPage authorization request.");
      return;
    }
    completed = true;
    if (error) {
      res.end("BrewPage authorization ended. You can close this tab.");
      fail(new Error("BrewPage authorization was cancelled or refused."));
      return;
    }
    res.end("BrewPage received the authorization response. You can close this tab.");
    finish({ code: code!, iss: issuer });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  callback = `http://127.0.0.1:${(server.address() as { port: number }).port}${CALLBACK}`;
  const timer = setTimeout(() => fail(new Error("Timed out waiting for BrewPage authorization.")), timeout);
  return { callback, response, close() { clearTimeout(timer); server.closeAllConnections(); server.close(); } };
}

export function nativeOAuth(deployment: Deployment, request: typeof fetch = fetch, openBrowser = browserOpen, callbackTimeout = 180_000) {
  const { issuer, resource } = deployment;
  const resourceMetadata = new URL("/.well-known/oauth-protected-resource/mcp", resource).href;
  const authorizationMetadata = `${issuer}/.well-known/oauth-authorization-server`;
  const authority = {
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
  };
  const http = guardedFetch(new Set([resourceMetadata, authorizationMetadata, authority.token_endpoint, authority.revocation_endpoint]), request);

  async function metadata() {
    const protectedResource = await discoverOAuthProtectedResourceMetadata(resource, { resourceMetadataUrl: resourceMetadata }, http);
    if (protectedResource.resource !== resource || protectedResource.authorization_servers?.length !== 1 ||
      protectedResource.authorization_servers[0] !== issuer) throw new Error("The MCP resource did not advertise the configured authorization server.");
    const document = await discoverAuthorizationServerMetadata(issuer, { fetchFn: http });
    if (document?.issuer !== issuer || !document.authorization_response_iss_parameter_supported ||
      !document.code_challenge_methods_supported?.includes("S256") || !document.token_endpoint_auth_methods_supported?.includes("none") ||
      Object.entries(authority).some(([field, value]) => (document as Record<string, unknown>)[field] !== value)) {
      throw new Error("The authorization server did not match the configured BrewPage OAuth endpoints.");
    }
    return document;
  }

  function credential(tokens: OAuthTokens, binding: string, scope: string, previous?: string): Credential {
    const granted = tokens.scope ?? scope;
    if (tokens.token_type.toLowerCase() !== "bearer" || !tokens.refresh_token || tokens.refresh_token === previous ||
      !tokens.expires_in || !granted || granted.split(/\s+/).some((value) => !scope.split(" ").includes(value))) {
      throw new Error("BrewPage returned an unusable authorization grant.");
    }
    return verifiedCredential({ version: 1, binding, clientId: CLIENT_ID, ...deployment, scope: granted,
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000 }, deployment);
  }

  return {
    async login(scopes?: readonly string[]): Promise<Credential> {
      const scope = nativeLoginScope(scopes);
      const document = await metadata();
      const state = randomBytes(32).toString("base64url");
      const local = await callbackServer(issuer, state, callbackTimeout);
      try {
        const { authorizationUrl, codeVerifier } = await startAuthorization(issuer, {
          metadata: document, clientInformation: CLIENT, redirectUrl: local.callback, scope, state, resource,
        });
        await openBrowser(authorizationUrl);
        const { code, iss } = await local.response;
        const answer = await exchangeAuthorization(issuer, { metadata: document, clientInformation: CLIENT, authorizationCode: code,
          iss, codeVerifier, redirectUri: local.callback, resource, fetchFn: http });
        return credential(answer, randomUUID(), scope);
      } finally {
        local.close();
      }
    },
    async refresh(stored: Credential): Promise<Credential> {
      const document = await metadata();
      const answer = await refreshAuthorization(issuer, { metadata: document, clientInformation: CLIENT,
        refreshToken: stored.refreshToken, resource, fetchFn: http });
      return credential(answer, stored.binding, stored.scope, stored.refreshToken);
    },
    async revoke(stored: Credential): Promise<void> {
      await metadata();
      const answer = await http(authority.revocation_endpoint, { method: "POST",
        body: new URLSearchParams({ token: stored.refreshToken, token_type_hint: "refresh_token", client_id: CLIENT_ID, resource }) });
      if (!answer.ok) throw new Error("BrewPage could not confirm connection revocation.");
    },
  };
}

export function nativeSession(store: CredentialStore, selection: Selection, oauth = nativeOAuth(store.deployment)) {
  async function active() {
    const credential = await store.read(selection).catch(() => { throw new NativeReconnectRequired(); });
    if (credential.blocked) throw new NativeReconnectRequired();
    return credential;
  }
  return {
    async token(signal?: AbortSignal): Promise<string> {
      signal?.throwIfAborted();
      const current = await active();
      if (current.expiresAt > Date.now() + 30_000 && !await store.refreshPending(selection)) return current.accessToken;
      signal?.throwIfAborted();
      return await store.lock(async () => {
        const current = await active();
        if (await store.refreshPending(selection)) throw new NativeReconnectRequired();
        signal?.throwIfAborted();
        if (current.expiresAt > Date.now() + 30_000) return current.accessToken;
        try {
          // A rotating exchange can consume the refresh token without returning a response.
          await store.beginRefresh(selection);
          const checkpointed = await active();
          if (checkpointed.expiresAt > Date.now() + 30_000) {
            await store.finishRefresh(selection);
            return checkpointed.accessToken;
          }
          const next = await oauth.refresh(checkpointed);
          try {
            await store.save(selection, next);
          } catch (error) {
            await oauth.revoke(next).catch(() => undefined);
            throw error;
          }
          await store.finishRefresh(selection);
          return next.accessToken;
        } catch {
          throw new NativeReconnectRequired();
        }
      });
    },
    async invalidate(token: string): Promise<void> {
      await store.lock(async () => {
        const current = await store.read(selection);
        if (current.accessToken === token) await store.save(selection, { ...current, blocked: true });
      });
    },
  };
}
