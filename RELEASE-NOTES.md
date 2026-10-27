# Release Notes

## API contract 2.7.0 — 2026-10-27

- API contract version 2.7.0 is the backend-generated public snapshot exported from the clean brewpage-app source `8fca19e3af9f88141ce9a000c3400bdd6939cf6f` (branch `feat/archive-download-notice`, for backend `v2.7.0`).
- `POST /api/files` and `PUT /api/files/{ns}/{id}` add notice `archive-unverified` for archives (zip, 7z, gz incl. .tar.gz, tar): check contents before opening. `GET /api/files/{ns}/{id}` 200 adds header `X-BrewPage-Notice: archive-unverified` on archives. Additive: 47 paths and 62 operations; `publish_file` prints notices as sent, MCP unchanged.

## API contract 2.6.0 — 2026-10-26

- API contract version 2.6.0 is the backend-generated public snapshot exported from the clean brewpage-app source `12b53e5a749201ea39d6a9e42a3e845f0784cd8e` (tag `v2.6.0`).
- `HtmlUploadResponse` (`POST /api/html`) and `HtmlUpdateResponse` (`PUT /api/html/{ns}/{id}`) add optional `format`: the stored format after auto-detect (`html`, `markdown` or a code format); may differ from the requested one, absent when unknown. Additive: 47 paths and 62 operations; MCP unchanged.

## API contract 2.5.0 — 2026-10-26

- API contract version 2.5.0 is the backend-generated public snapshot exported from the clean brewpage-app source `a6f93bb4d96813dd8adab88554d9c61916c70755` (tag `v2.5.0`).
- `StatsResponse` (`GET /api/stats`) adds nullable `accountsToday` (accounts created today, `tz` day) and `totalAccounts` (all-time). Additive: 47 paths and 62 operations; `get_stats` returns the raw JSON, MCP unchanged.

## MCP 1.14.4 — 2026-10-26

- Remote mode (`dist/http.js`): a request holds its slot until the tool handler settles, not until the socket closes; a client disconnect aborts its backend calls and the `publish_file` download, and each backend call times out after 60 s. Separate light, standard and heavy pools queue a request (before its body is read) for up to 30 s instead of answering 503. Request body cap 8 -> 32 MiB so the largest site fits; run with a 512 MiB container and `--max-old-space-size=192`. `BREWPAGE_SHARED_EGRESS_CIDRS` and the daily-fetched `BREWPAGE_SHARED_EGRESS_LIST_URLS` (e.g. OpenAI connectors) list platform egress that skips per-IP caps and the download budget; malformed CIDRs fail startup. A body must arrive at ~250 KiB/s after 2 s. A client disconnect logs `client_closed`. `User-Agent: brewpage-mcp/1.14.4`; pins bumped. No tool or contract change.

## API contract 2.3.1 / MCP 1.14.3 — 2026-10-26

- API contract version 2.3.1 is the backend-generated public snapshot exported from the clean brewpage-app source `01af63af2f4a1736bf6e1507ce3c9af628b87aa8` (branch `fix/old-409-hint-webvisor`, for backend `v2.3.1`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `ErrorResponse.createUrl`: with `409 OLD_PUBLICATION_READ_ONLY` on every type, the create endpoint in the same namespace (`https://brewpage.app/api/{html|sites|files|json|kv}?ns={ns}`); POST the content there to publish it anew. `republishUrl` (HTML only) is the browser composer. The 409 descriptions on content updates and on password, rotate, manage-key and extend say to publish anew via `createUrl`. Additive: 47 paths and 62 operations.
- MCP 1.14.3: the 409 hint tells the client to POST the content to `createUrl` with the matching publish tool in that namespace (`republishUrl` is browser-only); update tool descriptions mention `createUrl`. `User-Agent: brewpage-mcp/1.14.3`; pins bumped.

## MCP 1.14.2 — 2026-10-26

- MCP Registry: `server.json` lists the remote endpoint `https://brewpage.app/mcp` (`remotes`, `streamable-http`, no auth) beside the npm stdio package, so registry clients can connect by URL. Root `server.json` moves to schema `2025-12-11` like `mcp-server/server.json`. `User-Agent: brewpage-mcp/1.14.2`; pins bumped. No tool or contract change.

## MCP 1.14.1 — 2026-10-26

- Security fix: `namespace`, `id` and `key` are percent-encoded as single path segments in every tool, and empty, `.` and `..` values are refused before any request, so a tool call can no longer reach a backend path outside `/api/<type>/`. Query strings are built with `URLSearchParams`. Valid inputs send the same requests. No contract change.

## MCP 1.14.0 — 2026-10-26

- Stateless Streamable HTTP entry `dist/http.js` (`POST /mcp`, `/healthz`) for the remote server at `https://brewpage.app/mcp`: trusted-proxy client IP forwarding, `Origin` -> 403, SSRF-safe `publish_file` downloads, owner token env refused. The Docker image default stays stdio. `User-Agent: brewpage-mcp/1.14.0` (`(remote)` over HTTP); `server.json` and `gemini-extension.json` stamps bumped. No contract change.
- Release workflow also builds, smoke-tests and pushes `ghcr.io/kochetkov-ma/brewpage-mcp:<version>` (exact tag, before npm publish).

## API contract 2.2.0 — 2026-10-25

- API contract version 2.2.0 is the backend-generated public snapshot exported from the clean brewpage-app source `f486700d7cc6cf6c7f3ea255113c7dd8c0cf3445` (branch `feat/gallery-card-previews`, for backend `v2.2.0`), built on the 2.1.5 wording. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it. Replaces the earlier 2.2.0 snapshot from `1806d1cf13a37c9c027e3ab696cf23a1f3cd288a`.
- `GalleryItem` (`GET /api/gallery`) restores nullable `preview` (`PublicationPreviewResponse`; null while previews are off and on password rows) and nullable `format` (`type=file`: lowercase extension, else null). `PublicationPreviewResponse` adds optional `branded` (true = type card, not a page or content render; absent when false). Additive: 47 paths and 62 operations. No MCP release; `search_gallery` returns the fields as sent.

## API contract 2.1.5 / MCP 1.13.2 — 2026-10-25

- API contract version 2.1.5 mirrors production BrewPage v2.1.5: `https://brewpage.app/api/openapi.json` with `servers` normalized to `https://brewpage.app` exactly as the backend exporter writes it; provenance names the release source `d99fa959b8003fb2db99fd358f935a94fe504076` (tag `v2.1.5`) and its backend source hash. Deterministic YAML and the byte-identical Scalar copy are regenerated with it.
- `ns` on `POST /api/html` and `POST /api/files`: `public` is listed in the gallery and sitemap so Google, Bing and AI search can find and index it, is served on the brewpage.app domain (a page needing its own origin gets a subdomain automatically), and must never hold secrets; omitted = private, unlisted and not indexed, the link still opens. `POST /api/sites`: the same, with "A site always gets its own subdomain." `POST /api/json` and `POST /api/kv`: JSON and KV are never listed or indexed in any namespace. `access`, `listed`, `visibilityNotice` and the create `X-Password` descriptions state the listing plainly.
- `republishUrl` on `409 OLD_PUBLICATION_READ_ONLY` is HTML-only; site, JSON, KV and file 409 descriptions drop it.
- The 2.2.0 snapshot (unreleased branch `feat/gallery-card-previews`) is superseded: `GalleryItem.preview` and `GalleryItem.format` are not served by production and return with backend 2.2.0. 47 paths and 62 operations.
- MCP 1.13.2: `namespace` descriptions follow the per-type `ns` text (HTML/file, site, JSON/KV); private `publish_json`/`publish_kv` results no longer suggest `public` for listing; update tools say old publications were made before 5 October 2026; the 409 hint mentions `republishUrl` only when the server sends it. `User-Agent: brewpage-mcp/1.13.2`; pins bumped.

## MCP 1.13.1 — 2026-10-25

- `update_html`, `republish_site`, `update_json` and `set_kv` say old publications (made before 5 October 2026) answer `409 OLD_PUBLICATION_READ_ONLY`; that failure adds a hint: publish the content anew in the same namespace and give the user the new URL and owner token (`republishUrl` is browser-only); for KV, read all keys with `get_kv` and publish them together. No contract change.

## API contract 2.1.0 — 2026-10-25

- API contract version 2.1.0 identifies the backend-generated public snapshot exported from the clean brewpage-app source `9f7e87fd7f84730ca61da21e423e6cf63fe63a7f` (branch `fix/v2-observability-polish`, released as `v2.1.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `PublicationPreviewResponse` and `GET /preview/{ns}/{id}/{variant}.webp` (`previewWebp`): the `full` variant now exists for every type: page top for pages and sites, else the 1200 px card. Description-only: 47 paths and 62 operations. No MCP release.

## API contract 2.0.1 / MCP 1.13.0 — 2026-10-25

- API contract version 2.0.1 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `03d2f3f9991edf69297b4232c5847f64196bb068` (tag `v2.0.1`; the app took a major version for the owner features). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `access` descriptions add the public JSON/KV wording "Public: anyone with the link. Not listed."
- REST create and list without `ns`: private, notice `namespace-defaulted`. `ns` description: "Namespace. Omitted: private. `public` = gallery & search." Create operations state: "Secrets allowed; likely ones are flagged in notices. For a secret: private namespace + password."
- Create responses add `manageUrl` (private; present only when minted), `listed` and `visibilityUrl`; `access` is the enum `public`, `unlisted`, `protected`; `notices` are advisories about the request or its result.
- New security scheme `ManageKey` (`X-Manage-Key`): owner operations accept the owner token or the management key.
- New operations: `setVisibility`, `setPassword`, `resetManageKey`, `extendPublication`, `rotatePublicationLink`, `replaceFile` (`PUT /api/files/{ns}/{id}`), `hostOwnerCheck`, `bindOwnerToken`, `mintOwnerToken`, `revokeOwnerToken`, `revokeOtherOwnerTokens`, `listPublications`, `getPublicationStats`, `previewWebp` and `ownerPreviewWebp`.
- Old publications are read-only: content writes answer `409 OLD_PUBLICATION_READ_ONLY` with `republishUrl`. KV key name `hosting` is reserved (400). `GET /api/limits` with optional `X-Owner-Token` adds `reach` and `ownerMaxTtlDays`. HTML `/source` and `/settings` failures carry `ErrorResponse`; `/settings` adds `readOnly`. Owner-check schemas name the wire field `isOwner`. `GET /api/publications` (profile token: whole profile; filters `type`, `status`, `q`, `expiring`; cursor; 24 per page) and `.../stats?range&tz`; hosting GET adds `title`, `listed`, `createdAt`, `expiresAt` and, for sites, `fileCount`, and answers `410 PUBLICATION_UNAVAILABLE` to a proven owner of a moderated row; gallery `mine=true` items add `expiresAt`. 47 paths and 62 operations.
- `POST /api/files` (`upload`): when an existing publication is returned (file or HTML-as-page duplicate), `result` = `{code: duplicate, action: merged, extras.isOwner}`; `ownerToken` is optional and omitted when another owner's publication is returned. MCP then prints no owner-token banner.
- MCP 1.13.0: `User-Agent: brewpage-mcp/1.13.0`; optional `BREWPAGE_OWNER_TOKEN` default (named, never printed); `ownerToken` on `publish_html` and `publish_file`; new tools `set_visibility`, `bind_token`, `mint_token` (twenty tools); `delete_resource` deletes sites and encodes path segments; prints `MANAGE LINK (private)`, `VISIBILITY` and `WARNING (code)` lines; an optional account sign-in hint only for a newly minted owner token; wrong-token 403 hint; hf-space pins 1.13.0.

## API contract 1.135.0 — 2026-10-23

- API contract version 1.135.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `1538d1a448ea44679c79aa06942e4176cd6e9d7a` (tag `v1.135.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `POST /api/html` (`create_1`), `PUT /api/html/{ns}/{id}` (`update_1`) and a public HTML file published as a page via `POST /api/files` (`upload`): an `html` page pasted from a chat is repaired. A wrapping ```` ```html ```` fence or chat text around the page is removed (notice `chat-text-removed`); an entity-escaped page is restored to HTML (notice `escaped-html-restored`). Anything else is stored unchanged.
- New optional boolean query parameter `verbatim` on those three operations: `true` stores the bytes exactly as sent, without repair. `GET /api/html/{ns}/{id}/source` returns the page as stored (repaired unless sent with `verbatim=true`). 33 paths and 47 operations. No MCP release.

## API contract 1.134.0 — 2026-10-23

- API contract version 1.134.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `62daf7989d142f2a0a950d7c5179554731d5646c` (tag `v1.134.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `POST /api/files` (`upload`): a UTF-8 `.html`/`.htm` file sent to namespace `public` without a password is published as an HTML page with the same rules and limits as `POST /api/html`; `id`, `link` and `ownerLink` then belong to that page (manage it via `/api/html`), `contentType` is `text/html`, `sizeBytes` is the page size (UTF-8 BOM removed) and the notice `html-file-as-page` names the page link. Any other HTML file is stored as a file and shown as source with the notice `html-file-as-source`. When the same content is already published under another owner, the response returns that page with `X-Existing-Resource: 1` and the notice `existing-page-not-owned`: the returned owner token cannot edit or delete it. `GET /api/files/{ns}/{id}` (`download`) of such a page answers `308` to `/api/html/public/{id}` (query string kept); `DELETE /api/files/{ns}/{id}` deletes the page with the same owner token.
- `POST /api/files`, `POST /api/html` and `POST /api/sites` document `403` with `ErrorResponse` (`Upload refused`); `PUT /api/html/{ns}/{id}` and `PUT /api/sites/{ns}/{id}` describe their `403` as "Missing or wrong owner token, or upload refused".
- `format` on `POST /api/html`: raw reads of `xml` pages answer `text/plain`; downloads keep `text/xml`. Site `entry` (create and republish) takes an `.html`/`.htm` path; a missing or non-HTML entry falls back to `index.html`, else the shallowest HTML file, and is reported in notices. 33 paths and 47 operations. No MCP release.

## API contract 1.133.0 — 2026-10-23

- API contract version 1.133.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `1dcfb6e2911a76df1da11e0d06691bd76ae3319f` (tag `v1.133.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `GET /api/gallery` (`getGallery`) descriptions now match behavior: the public listing covers live pages, files and sites; `q` is a case-insensitive substring search by title (filename for files, id when untitled; no tag search); `mine=true` with `X-Owner-Token` lists all of the caller's live pages, files and sites in any namespace, including password-protected ones, each with its real `namespace` and a `visibility` of my_public, my_public_password or my_private; without the token it returns an empty page. `GalleryItem.type` is a page's stored format (`html`, `markdown` or a code format), `file` or `site`; KV and JSON stores are never listed. Description-only: no path, operation or schema change, 33 paths and 47 operations. No MCP release.

## API contract 1.132.0 — 2026-10-22

- API contract version 1.132.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `4f019a448e3e9d50b1d0be110b922191212c3795` (tag `v1.132.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `POST /api/reports` (`submitReport`) documents `429` (`ErrorResponse`, "Too many reports from this address today"); the response carries `Retry-After`. No other path, operation or schema change since 1.130.0: 33 paths and 47 operations. No MCP release.

## API contract 1.130.0 / MCP 1.12.1 — 2026-10-22

- API contract version 1.130.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `47cb4b776560591ebf134dc3c8bea2251fcdc023` (tag `v1.130.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `info.description` ends with a link to the comparison hub: how BrewPage compares with GitHub Pages, GitHub Gist, Netlify Drop, Cloudflare Drop, Tiiny Host and Static.app (https://brewpage.app/compare). No path, operation or schema change since 1.125.1: 33 paths and 47 operations.
- MCP 1.12.1: the root and package READMEs link the comparison page; the root README states the current seventeen tools. Same tools, tool descriptions, inputs and HTTP behavior.

## API contract 1.125.1 — 2026-10-22

- API contract version 1.125.1 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `e507d2854c7b48a982983045e9e5b6bd4df3f752` (tag `v1.125.1`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `HtmlUploadRequest` gains optional nullable `format` (same values as the `format` query parameter; the body value takes precedence). The only schema change since 1.123.0; backend releases 1.124.x and 1.125.0 carried no public contract change. 33 paths and 47 operations.
- Behaviour without a schema change: `PUT /api/html/{ns}/{id}` ignores a blank body `format`; a JSON object body without `content` (and no non-null content alias) is published as the content itself with the `body-as-content` notice instead of `400`.

Contract-only sync — no MCP version bump (MCP stays 1.12.0; `publish_html` sends `format` as a query parameter, `update_html` omits an empty one), no npm publish, no tag. Docs site auto-redeploys via `.github/workflows/docs.yml` on push to `main`.

## API contract 1.123.0 / MCP 1.12.0 — 2026-10-22

- API contract version 1.123.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `6acc7512c8a6beaed2b52afb4df16a609af3d5d8` (tag `v1.123.0`). Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- Added `GET /api/limits` (`getLimits`, tag `Limits`): user-facing upload limits only, as `LimitsResponse` `{requestMaxBytes, sites}` with `SiteLimitsResponse` `{maxFiles, maxFileBytes, maxTotalBytes, maxArchiveExpansionBytes, maxPathChars, maxPathBytes, maxNameBytes, defaultTtlDays, maxTtlDays, allowedExtensions, skippedFileNames, skippedRootFolders}`; `429` on rate limit. Production defaults: 25 MiB per request, 200 files (was 100), 5 MiB per file, 20 MiB total, 40 MiB ZIP expansion, 380 characters / 900 bytes per path, 200 bytes per name, TTL 15/30 days.
- `POST /api/sites` and `PUT /api/sites/{ns}/{id}`: `400` descriptions point to `GET /api/limits`; new `413` (request over the per-request size, too many files and form fields, or a file path too long); `422` (no servable file left) replaces `415`. Damaged, non-UTF-8 or password-protected ZIPs and `..` path segments answer `400`; system files (`skippedFileNames`, `skippedRootFolders`) are dropped before any limit.
- Behaviour without a schema change since 1.121.0: unstorable metadata is stored as the closest valid value with notices (`tags-truncated`, `*-control-chars-removed`, `content-nul-replaced`), other data errors answer `400` instead of `409`; an aborted upload gets a `408` JSON error from the edge instead of `503`.
- 33 paths and 47 operations (1.121.0: 32 and 46). `scripts/verify-openapi.mjs` asserts the limits route, its exact field sets and the site `400`/`413`/`422` responses without `415`.
- MCP 1.12.0: new `get_limits` tool (`GET /api/limits`); `publish_site` and `republish_site` describe the limits, entry rule, skipped files and status codes. Seventeen tools.

## API contract 1.121.0 — 2026-10-22

- API contract version 1.121.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `78491e73e815e4f8d44e90985698a8654536c1ad`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `GET /galleries` (`galleries`) is paginated with `rel=prev/next`: optional query parameter `page` (1-based, omitted = page 1). An invalid page number or one past the last page answers `404` with a `noindex` HTML page; the contract declares that response without a body schema.
- No other path, operation or schema change since 1.119.0 (backend releases 1.119.1, 1.119.2 and 1.120.0 carried no public contract change): 32 paths and 46 operations.

Contract-only sync — no MCP version bump (MCP stays 1.11.0), no npm publish, no tag. Docs site auto-redeploys via `.github/workflows/docs.yml` on push to `main`.

## API contract 1.119.0 / MCP 1.11.0 — 2026-10-21

- API contract version 1.119.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `f09d781a0d309232f614a2a61bee6f4caa835e07`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it. 32 paths and 46 operations.
- Owner ruling 2026-10-21: publish endpoints accept fixable inputs and report each adjustment in an advisory `notices` array of `{code, message}` (`PublishNotice`) on successful create/update responses, omitted when empty. Covered: TTL parsing (`2w`, `36h`, fractions) and clamping (`ttl-converted`, `ttl-clamped`, `ttl-invalid`, `ttl-ignored` on updates), format aliases and content detection, site members skipped instead of rejecting the bundle (422 only without an HTML entry), file type sniffing with an inert `text/plain` fallback, namespace normalisation, empty `X-Password` and blank `X-Owner-Token`.
- MCP 1.11.0: every publish/update tool prints server notices as `Notice (code): message`; `ttlDays` takes a positive number or a string such as `2w` (the client-side 1-30 limit is gone, the server clamps); `publish_html` `format` is a free string mapped by the server; `republish_site` TTL is documented as ignored. Same sixteen tools.

## API contract 1.118.0 / MCP 1.10.0 — 2026-10-21

- API contract version 1.118.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `132899c6693019f4b3996a108e01b816bcdba54b`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- Owner ruling 2026-10-21: delivery-mode and hosting-version mismatches are reported, not rejected. Responses carry the real `link`, `requestedDeliveryMode`/`effectiveDeliveryMode`, `deliveryModeMatched: false`, a `deliveryModeReason` code and a human-readable `deliveryNotice`.
- Removed rejections: `400 DELIVERY_MODE_REQUIRED` (explicit `path` on a fresh site or non-public `html` page now publishes on its subdomain, `policy:subdomain-required`; a content update turning a non-public `path` page into `html` moves it to its subdomain and the old path redirects), `400 HOSTING_OPERATION_REQUIRED`/`HOSTING_UPDATE_REQUIRED` (`X-Delivery-Mode` on a content update or site republish is ignored, `policy:republish-keeps-mode`), `400 HOSTING_MODE_LOCKED` (`policy:mode-locked`, OLD links `policy:classic-link`) and `409 HOSTING_VERSION_CONFLICT` (applied, `policy:version-stale`).
- `HostingUpdateRequest.expectedVersion` is optional; a malformed value (not a positive integer) still answers `400 INVALID_HOSTING_VERSION`. `PATCH /api/{type}/{ns}/{id}/hosting` also routes `sites` (always the mode-locked answer) and no longer declares `409`. `HostingProjection` gains optional `deliveryModeReason` and `deliveryNotice`, omitted when null. `INVALID_DELIVERY_MODE` and `503` outages are unchanged.
- `POST /api/files`: the multipart `file` part is no longer required; when it is absent, any single file part is accepted. Sending `file` stays the documented form. 32 paths and 46 operations.
- MCP 1.10.0: `update_hosting` takes an optional `expectedVersion` and prints the server's `deliveryModeReason` and `Delivery notice:` line; same sixteen tools. `scripts/verify-openapi.mjs` asserts the optional version, the projection fields, the sites route and the absent `409`.

## API contract 1.117.0 / MCP 1.9.5 — 2026-10-21

- API contract version 1.117.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `e2350cd5317c2460de4cd8650db7bcbb5728e357`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- Owner ruling 2026-10-21: `subdomain` is required only for NEW sites (any namespace) and NEW HTML pages of format `html` outside `public`; explicit `path` there answers `400 DELIVERY_MODE_REQUIRED`, as does a content update turning a non-public `path` page into format `html`. Everything else in non-public namespaces (Markdown, code/text, files, JSON, KV) now defaults to `path` and may choose `subdomain`, like public. Previously every non-public publication required `subdomain`. Existing publications keep their mode.
- Markdown rendering: raw HTML passes an allowlist (formatting, images, video/audio, `details`/`summary`, tables kept; scripts, styles, event handlers, forms, frames/embeds, `meta`/`base`/`link` removed; links `http`/`https`/`mailto`/`tel`/relative/`#anchor`, images also `data:`); a lone unknown tag shows as text. Earlier pages change only when republished. No API shape change.
- `X-Delivery-Mode` parameter descriptions and the hosting `PATCH` summary change in the backend-generated snapshot; no path, operation or schema change.
- MCP 1.9.5 is a wording patch: `deliveryMode` and `update_hosting` describe the new rule; in the default unlisted `priv-*` namespace `publish_html` with format `HTML` still gets `subdomain`, while Markdown, files, JSON and KV now get `path` unless `subdomain` is chosen. Same sixteen tools and HTTP behavior.

## API contract 1.113.0 / MCP 1.9.4 — 2026-10-20

- API contract version 1.113.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `827943c74bb29eef2082d1e3ffcc972889521659`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- The outcome schema referenced by `result` (HTML and site create/update responses, `ErrorResponse`) is now named `PublicationResult`, with a plain description: action `merged` means an existing publication was returned instead of a new one. Its fields, enum values and required set are unchanged, so response bodies are byte-identical; generated clients see a new type name.
- `result` property descriptions are reworded neutrally. No path or operation change: 32 paths and 46 operations, as in 1.108.0.
- `POST /api/files` answers `X-Existing-Resource: 1` when it returns an existing upload, the same value HTML and site creation already send.
- MCP 1.9.4 is a wording patch: tool text describes a create that returns an existing publication in plain terms. Same sixteen tools, input defaults and HTTP behavior.

## API contract 1.108.0 — 2026-10-14

- API contract version 1.108.0 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `7c6cec4145b86fd11bcbbcd11bae8b9f948f7f81`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- Added `GET /preview/{ns}/{id}.jpg` (`previewJpeg`): the canonical social preview image, a 1200×630 JPEG card with `ETag`/`If-None-Match` support. Images for non-public namespaces and protected content carry `X-Robots-Tag: noindex`; any failure answers 302 to the static `/og-image.png?v=3`.
- `GET /preview/{ns}/{id}.png` (`preview`) stays as the legacy URL for links shared earlier: it serves the same JPEG card with identical bytes, headers and fallbacks, and its 200 response now declares `image/jpeg`. The static fallback moved from `/og-image.png?v=2` to `?v=3`.
- The preview images and the social-bot meta page (`/preview-html/{ns}/{id}`) share one `preview` tag; 1.107.6 declared that tag twice.
- 32 paths and 46 operations (1.107.6: 31 and 45). `scripts/verify-openapi.mjs` checks both preview image routes and rejects duplicate tag names.

Contract-only sync — no MCP version bump (MCP stays 1.9.3), no npm publish, no tag. Docs site auto-redeploys via `.github/workflows/docs.yml` on push to `main`.

## API contract 1.107.6 — 2026-10-13

- API contract version 1.107.6 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `c8671524647f411c4ce2a5e5a1994617b253f965`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- `info.license` is set: `Apache-2.0` (`https://www.apache.org/licenses/LICENSE-2.0`), the licence of this repository's contract and docs layer (`LICENSE`). The last handwritten contract and the docs site footer said MIT; MIT covers only the independently packaged MCP server (`mcp-server/LICENSE`). The footer now states both.
- No path, operation, schema or access change: 31 paths and 45 operations, as in 1.107.4. The brewpage-app release v1.107.5 was frontend-only and kept backend build 1.107.4, so it has no snapshot.
- README and getting-started: `brewdata.app` is a redirect domain (every path answers 301 to `brewpage.app`), not a second API host.

Contract-only sync — no MCP version bump (MCP stays 1.9.3), no npm publish, no tag. Docs site auto-redeploys via `.github/workflows/docs.yml` on push to `main`.

## API contract 1.107.4 — 2026-10-12

- API contract version 1.107.4 identifies the backend-generated public snapshot exported from the clean brewpage-app release source `3e50e80b17b45d15f22eb16b1410647d726989a1`. Deterministic YAML, the byte-identical Scalar copy and export provenance are regenerated with it.
- Contract metadata restored: `info.termsOfService` (`https://brewpage.app/terms`), `info.contact` (BrewPage, `https://brewpage.app`) and top-level `externalDocs` (`https://kochetkov-ma.github.io/brewpage-openapi/`). The generated 1.107.2 snapshot did not carry them.
- `info.license` is not restored in this version; 1.107.6 sets it.
- No path, operation, schema or access change: 31 paths and 45 operations, as in 1.107.2.

Contract-only sync — no MCP version bump (MCP stays 1.9.3), no npm publish, no tag. Docs site auto-redeploys via `.github/workflows/docs.yml` on push to `main`.

## API contract 1.107.2 / MCP 1.9.3 — 2026-10-11

- Backend-generated public JSON replaces handwritten YAML schema authority. Deterministic YAML and byte-identical Scalar copies carry backend export provenance; verification checks schema references, operation IDs, path parameters, access schemes and parity.
- Administrative routes are excluded from public artifacts. Authored examples and guidance retain REST/MCP namespace differences, owner/password access and exact returned hosting links; documented limits/TTL describe repository defaults and owner/extension exceptions.
- API contract version 1.107.2 identifies the backend-generated public snapshot. This synchronization corrects schema/access/serialization metadata; it adds no runtime endpoint feature. Older release attachments retain their historical contracts.
- Contract corrections include flattened required hosting metadata with nullable values where serialized, optional owner/password security alternatives, owner-only source/settings access, arbitrary JSON values, HTML text/binary representations, named site-file path parameters, actual error DTOs and bodyless redirect/not-modified responses. Export snapshots normalize the production server origin only; runtime Swagger retains the request/local origin.
- Independently versioned MCP 1.9.3 is a metadata patch: tool/discovery descriptions clarify unlisted link access, exact returned links, conditional native indexing, limits, owner/extension TTL exceptions, site-republish expiry retention and API content representations. Input defaults, HTTP behavior and the sixteen-tool set are preserved. SDK/CLI modules remain proposals.

## v1.104.0 — 2026-10-06

### Added
- OpenAPI: optional `deliveryModeReason` and `deliveryNotice` on `HtmlUploadResponse` and `HtmlUpdateResponse`. A public HTML or Markdown page created without `X-Delivery-Mode` may be published on its own subdomain when it needs browser features a BrewPage (`path`) link does not provide (`auto:<codes>`); `advisory:<codes>` means the address was not changed. Codes: `storage`, `cookies`, `history`, `downloads`, `top-navigation`, `media-capture`, `pointer-lock`, `embeds`, `fullscreen`. Both fields are omitted when nothing applies.
- OpenAPI: `visibilityNotice` on both HTML responses and `result` on `HtmlUpdateResponse`.
- OpenAPI: `POST /api/html` documents the `200` response with header `X-Existing-Resource: 1`, returned when a repost matches a page that is already published (same body shape as 201, `result.code: duplicate`, `result.action: merged`).
- OpenAPI: `PUT /api/html/{ns}/{id}` documents the optional `format` (body field and query parameter); omitted keeps the stored format.

### Changed
- OpenAPI spec version bumped `1.101.0` → `1.104.0` to track the brewpage-app v1.104.0 backend contract.
- Install commands and config snippets pin the exact MCP version everywhere (`llms.txt`, `mcp.json`, wiki).

### MCP 1.9.0

- `publish_html` and `update_html` print `deliveryModeReason` and a `Delivery notice:` line when the server returns them; nothing is printed when the fields are absent.
- No input changes; same 16 tools.

### MCP 1.9.1

- Dependency maintenance: refreshed the locked dependency versions used to build and test the server. No functional change; same 16 tools.

### MCP 1.9.2

- Dependencies are declared as exact versions, so an installed server uses the same SDK and `zod` versions it is built and tested with. No functional change; same 16 tools.

## v1.86.0 — 2026-06-08

### Added
- OpenAPI: `PUT /api/sites/{ns}/{id}` — site republish (full replace). The uploaded bundle becomes the complete new file set at the same URL (files absent are removed, new files added, matching files overwritten). Multipart `archive` (ZIP) or parallel `files[]` + `paths[]`; query params `tags`, `ttl`, `entry`. Requires `X-Owner-Token` (a missing token returns 403). Responses: 200 (`SiteUpdateResponse` — no owner token returned), 400, 403, 404, 410 (soft-hidden), 415, 429.
- OpenAPI: admin owner-tier endpoints under the `Admin` tag (`X-Admin-Password`):
  - `GET /api/admin/owners?search=<value>` — search owners; a 32-char base62 value resolves as a raw owner token to its `owner_id`, otherwise matched as an `owner_id` prefix. `OwnerInfo` now carries `tier` + `label`.
  - `GET /api/admin/owners/resolve?token=<raw>` — resolve a raw owner token to `{ ownerId }`.
  - `POST /api/admin/owners/{ownerId}/promote` — set tier `DEFAULT|PRIVILEGED` with optional `maxTtlDays` (PRIVILEGED ceiling 730), `label`, `note`.
  - `POST /api/admin/owners/{ownerId}/demote` — idempotent revert to `DEFAULT`.

### Changed
- OpenAPI spec version bumped `1.85.7` → `1.86.0` to track the brewpage-app v1.86.0 backend contract.

New schemas: `SiteUpdateResponse`, `OwnerResolveResponse`, `OwnerPromoteRequest`, `OwnerTierResponse`. Spec-only — no MCP version bump, no npm publish in this entry.

## v1.57.2 — 2026-05-21

### Added
- OpenAPI: `info.termsOfService` → `https://brewpage.app/terms` (was unset).
- OpenAPI: top-level `externalDocs` → Scalar docs site at `https://kochetkov-ma.github.io/brewpage-openapi/`. Gives every API directory (Postman, public-apis-*, awesome-openapi, etc.) a clean outbound link to the hosted documentation.

Spec-only patch — no MCP version bump, no npm publish, no tag. Docs site auto-redeploys via `.github/workflows/docs.yml` on push to `main`.

## v1.57.1 — 2026-05-21

### Fixed
- API docs site (Scalar @latest): removed 3 residual `example:` fields that Scalar's parseSafe rejects ("Invalid YAML object" error). Aligns with project's known scalar compat policy.
- **API Reference page: removed embedded renderer entirely** — Scalar 1.25.x through 1.57.x failed to parse our OpenAPI 3.1 spec; Redoc embed had unreadable dark-on-dark text + broken scroll inside Starlight layout. Replaced with a CTA card linking to external viewers (Redocly hosted, Swagger UI live on server, Scalar hosted) plus direct spec downloads. Pragmatic — no iframe, no CSS warfare, users open spec in their tool of choice.

### MCP 1.5.1

- Bumped `@modelcontextprotocol/sdk` ^1.12.0 → ^1.29.0 (minor; resolves 5 transitive vulns: 4 moderate + 1 high in fast-uri/hono/ip-address chain).
- Raised `engines.node` floor `>=18` → `>=20` (Node 18 EOL'd 2025-04-30).
- No public-surface API changes; same 14 tools.

## v1.57.0 (2026-05-21)

### Added
- OpenAPI: `GET /api/html/{ns}/{id}/source` -- owner-only raw HTML source (requires `X-Owner-Token`)
- OpenAPI: `GET /api/html/{ns}/{id}/settings` -- owner-only page settings (requires `X-Owner-Token`)

### Changed
- OpenAPI: `POST /api/html` documents all three accepted content types -- `application/json`, `application/octet-stream`, `multipart/form-data`
- OpenAPI: TTL parameters documented with string suffix form (`'30d'`) alongside numeric `ttlDays`
- OpenAPI: short-link resolver documents `?raw=1` query param to bypass HTML rendering
- OpenAPI spec version bumped from `1.31.0` to `1.57.0` -- tracks current backend contract surface (brewpage-app v1.57.0)

### MCP 1.5.0

New MCP tools for full public API parity:
- `update_html` -- PUT /api/html/{ns}/{id} (owner-token authorized)
- `publish_json` -- POST /api/json
- `get_json` -- GET /api/json/{ns}/{id}
- `update_json` -- PUT /api/json/{ns}/{id} (owner-token)
- `publish_kv` -- POST /api/kv
- `set_kv` -- PUT /api/kv/{ns}/{id}/{key} (owner-token)
- `get_kv` -- GET /api/kv/{ns}/{id}/{key}
- `search_gallery` -- GET /api/gallery (free-text + pagination + mine-filter)

## v1.2.0 (2026-05-01)

### Added
- OpenAPI: `POST /api/sites` examples for multi-file publishing modes — `archive_zip` (ZIP upload) and `files_paths` (parallel arrays), plus 201 response example
- MCP `publish_site`: multi-file site support via `files: [{path, content}]` array (backward compatible with existing `entryContent` single-file mode)
- MCP `publish_site`: optional `entry` override to pick the entry file from a multi-file set
- MCP `publish_site`: XOR validation between `entryContent` and `files` (exactly one required)

### Changed
- MCP `publish_site`: `ns` and `ttl` moved from formData to query string (matches actual API)
- MCP `publish_site`: TTL default doc corrected to 15 days
- OpenAPI spec bumped to `1.7.11` (additive examples only — contract unchanged)

## v1.7.6 (2026-04-24)

### Added
- Reports API: `POST /api/reports` public abuse report submission (rate-limited 60/hr/IP)
- Admin API: `GET /api/admin/reports`, `GET /api/admin/reports/{id}`, `PATCH /api/admin/reports/{id}` (protected by `X-Admin-Password`)
- Schemas: `ReportRequest`, `ReportResponse`, `ReportSummary`, `ReportDetail`, `ReportUpdateRequest`
- Tags: `Reports`, `Admin`

### Changed
- OpenAPI spec version bumped to `1.7.6` (matches brewpage-app backend)
- `openapi/openapi.json` regenerated from YAML (was stale at `1.1.0`)

## v1.1.1 (2026-04-20)

### Fixed
- OpenAPI: `{filePath}` parameter now documents multi-segment slash support (`allowReserved: true`, example added)
- OpenAPI: `ErrorResponse` schema now includes `timestamp` field (matches backend)
- OpenAPI: `SiteUploadResponse` and `SiteInfoResponse` `fileCount` now typed as `int32`
- MCP: `publish_site` tool now accepts and forwards `X-Owner-Token` for owner grouping
- MCP: server runtime version corrected to `1.1.1`
- MCP: `publish_site` description corrected to accurately describe single-page upload
- Docs: `api-reference.mdx` Files row fixed to reference correct endpoints

## v1.1.0 (2026-04-20)

### Added
- Sites API: multi-file site upload via ZIP archive or individual files with paths
- Sites endpoints: `POST /api/sites`, `GET /api/sites/{ns}/{id}`, `GET /api/sites/{ns}/{id}/files/{filePath}`, `DELETE /api/sites/{ns}/{id}`
- Schemas: `SiteUploadResponse`, `SiteInfoResponse`, `SiteFileInfo`
- MCP tool `publish_site`: publish a multi-file HTML site from Claude Desktop or Claude Code

### Changed
- OpenAPI spec version bumped from `1.0.0` to `1.1.0`
- README rewritten with open-source layer declaration, What's Open/Proprietary tables, ToC, and Sites API examples
- All docs and wiki updated with Sites API endpoints and examples

## v1.0.0 (2026-03-31)

Initial release.

### Included

- OpenAPI 3.1 specification (JSON + YAML) for all BrewPage API endpoints
- Interactive API documentation powered by Scalar
- Astro documentation site with getting started guide, examples, and MCP server docs
- MCP server (`brewpage-mcp`) with 5 tools for AI-assisted content publishing
- GitHub Actions: automatic docs deployment to GitHub Pages
- GitHub Actions: tag-triggered releases

### API Coverage

- **HTML** -- Publish, retrieve, update, delete HTML/Markdown pages
- **KV** -- Key-value store operations (get, set, list, delete keys)
- **JSON** -- JSON document CRUD with collection management
- **Files** -- File upload, download, list, delete
- **Gallery** -- Browse public content
- **Stats** -- Platform-wide usage statistics
- **Short Links** -- URL shortener for published content
- **SEO** -- Sitemap and robots.txt endpoints
