# brewpage-mcp

[![npm version](https://img.shields.io/npm/v/brewpage-mcp.svg)](https://www.npmjs.com/package/brewpage-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for [BrewPage](https://brewpage.app) -- publish and manage HTML, KV, JSON, and file content directly from AI assistants.

## What is BrewPage

[BrewPage](https://brewpage.app) is a free instant hosting platform designed for AI agents and developers. One `POST` request publishes HTML, Markdown, a multi-file site, a JSON document, or a binary file and returns its primary HTTPS link -- no accounts, no API keys, no infrastructure setup. Every resource carries an **owner token** returned at creation time: use it to update content in place, delete the resource, or authenticate list operations across sessions. `brewpage-mcp` exposes this API as sixteen typed MCP tools so any compatible agent -- Claude, Codex, Gemini, Cursor, Cline -- can publish, update, fetch, and manage BrewPage HTML, JSON, KV, and file content without leaving the conversation.

## Quick Start

```bash
npx -y brewpage-mcp@1.9.2
```

Requires Node.js 20 or newer. This starts the stdio server for an MCP client.

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@1.9.2"]
    }
  }
}
```

### Claude Code

Register a project-scoped stdio server:

```bash
claude mcp add --transport stdio --scope project brewpage -- npx -y brewpage-mcp@1.9.2
```

This writes `.mcp.json` in the project root. Use `--scope user` for user-scoped registration. See the [official Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

### Cursor

Open **Settings > MCP** and add:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@1.9.2"]
    }
  }
}
```

### Cline (VS Code extension)

Open the Cline MCP settings panel and add:

```json
{
  "brewpage": {
    "command": "npx",
    "args": ["-y", "brewpage-mcp@1.9.2"]
  }
}
```

### Global Install

```bash
npm install -g brewpage-mcp@1.9.2
brewpage-mcp
```

## Tools

Sixteen tools are available. Creation returns an owner token; keep it to modify or delete the resource later. Updates (`PUT`/`PATCH`) require the original `ownerToken`. Supported password inputs use `X-Password`.

| Tool | Purpose |
|------|---------|
| `publish_html` | Publish HTML or Markdown |
| `update_html` | Replace page content; omitted format preserves stored format |
| `get_page` | Fetch raw page content |
| `publish_file` | Fetch a source URL and upload the file |
| `publish_site` | Publish a single page or complete multi-file site bundle |
| `republish_site` | Replace the complete site bundle at the same ID/link |
| `publish_json` | Publish a JSON object, array, or JSON-encoded string |
| `get_json` | Read a JSON document |
| `update_json` | Replace a JSON document |
| `publish_kv` | Create a KV store with an initial entry |
| `set_kv` | Set or replace a key in an owned KV store |
| `get_kv` | Read a KV value |
| `update_hosting` | Change eligible delivery mode with owner token and hosting version |
| `delete_resource` | Delete HTML, JSON, KV, or file content |
| `search_gallery` | Browse public content or list owned resources |
| `get_stats` | Read platform-wide statistics |

All five publish tools accept optional `deliveryMode: "path" | "subdomain"`, sent only as `X-Delivery-Mode`; authored JSON and multipart bodies keep their existing format. Visibility and password protection are separate choices. Omitted namespace still generates an unlisted `priv-<random>` namespace; anyone with an unpassworded unlisted link can read it. `public` grants gallery/search eligibility only; password-protected content remains excluded.

For a fresh publication, sites and non-public namespaces require Dedicated subdomain (`subdomain`); explicit `path` is rejected. Other public publications default to Promotion (`path`) and may choose Dedicated subdomain, including password-protected content. Promotion uses a BrewPage path with stricter active-document restrictions. Each NEW site gets one publication-specific host for its complete bundle, preserving relative/root-relative paths; missing assets return 404, with no SPA fallback. Third-party widgets may still need provider configuration.

Responses use the server's primary `link` verbatim, including the root slash, and expose `routingCohort`, actual/requested/effective modes, `deliveryModeMatched`, `modeLocked`, `hostingVersion`, access and the trusted-apex `managementLink` when present. Never reconstruct a host from namespace or ID. NEW password links are clean URLs: do not add `?p=`; browser readers unlock through the trusted gateway. Owner tokens and API calls stay on the configured apex API origin.

When `deliveryMode` is omitted for a `public` HTML or Markdown page, the server may publish it on its own subdomain if the page needs browser features a BrewPage link does not provide. `publish_html` then prints `deliveryModeReason: "auto:<codes>"` and a `Delivery notice:` line with the server's explanation; pass `deliveryMode: "path"` to keep a BrewPage link, or change it later with `update_hosting`. `advisory:<codes>` (from `publish_html` or `update_html`) means the address was not changed but such features were found. Codes are comma-separated, drawn from `storage`, `cookies`, `history`, `downloads`, `top-navigation`, `media-capture`, `pointer-lock`, `embeds`, `fullscreen`. Neither line appears when nothing applies.

An existing deduplication winner keeps its actual URL, cohort and mode, even when another mode was requested. OLD publications display **Existing link**, with null mode metadata; their legacy links and behavior remain unchanged. Ordinary content updates and site republishing preserve hosting. An eligible NEW public non-site may change mode separately with `update_hosting`.

### Hosting

### `update_hosting`

Change an eligible NEW public non-site between Promotion and Dedicated subdomain. Parameters: `type` (`html` | `file` | `json` | `kv`), `namespace`, `id`, `ownerToken`, `deliveryMode` (`path` | `subdomain`), and `expectedVersion` (current server `hostingVersion`, integer ≥1).

The tool sends owner-only `PATCH /api/{html|files|json|kv}/{namespace}/{id}/hosting` with `{deliveryMode, expectedVersion}` and `X-Owner-Token`. OLD links, sites and non-public publications are locked. The server returns 403 for invalid owner authority, 400 for locked hosting, and 409 for a stale version; reload current metadata before retrying. A paused real change returns 503. Selecting the current mode returns 200 without incrementing the version. Use the returned primary link after a successful change; the publication host identity is retained through both directions.

```text
update_hosting(type="html", namespace="public", id="aBcDeFgHiJ", ownerToken="tok_...", deliveryMode="subdomain", expectedVersion=1)
```

### HTML

### `publish_html`

Publish HTML or Markdown content to BrewPage. Returns a public URL and owner token.

Parameters: `content` (string), `format` (`HTML` | `MARKDOWN`, default `HTML`), `namespace` (optional -- **omit for unlisted content**; pass `public` only for gallery/search eligibility, except when password-protected), `password` (optional), `ttlDays` (1--30, default 15), `filename` (optional, used as title fallback), `showTopBar` (optional boolean -- adds a toolbar with filename, Download button, and theme toggle), `deliveryMode` (optional).

The result includes `deliveryModeReason` and a `Delivery notice:` line when the server returns them (see above).

Example prompt that invokes this tool:

> "Save this HTML report so I can share the link with my team."

```
publish_html(content="<h1>Report</h1>...", format="HTML", ttlDays=15)
```

---

### `update_html`

Update an existing HTML or Markdown page in place, preserving its short URL. Requires the original `ownerToken` returned at creation.

Parameters: `namespace` (string), `id` (string), `content` (string, the new body), `ownerToken` (string), `format` (optional HTML/Markdown alias or supported code language such as `json`, `yaml`, or `typescript`; omitted preserves the stored format).

An update never changes the link or delivery mode; an advisory `deliveryModeReason` and `Delivery notice:` line are printed when the server returns them.

Example prompt:

> "Fix the typo in the report I published earlier -- same link."

```
update_html(namespace="public", id="aBcDeFgHiJ", content="<h1>Updated</h1>...", ownerToken="tok_...")
```

---

### `get_page`

Fetch the content of a published BrewPage HTML page by namespace and ID.

Returns the actual response body as text, including authored HTML or JSON code. Hosting metadata and the primary link come only from server response headers; JSON fields inside the publication are never treated as platform metadata. The existing apex HTML API route is retained.

Parameters: `namespace` (string), `id` (string), `password` (optional, if the page is password-protected).

Example prompt:

> "Retrieve the content of my published page so I can continue editing it."

```
get_page(namespace="public", id="aBcDeFgHiJ")
```

---

### Files

### `publish_file`

Upload a file to BrewPage by fetching it from a URL. Returns a public URL and owner token. Supports images, PDFs, video, audio, code files, and archives.

Parameters: `url` (string, the source URL to fetch), `namespace` (optional -- omit to keep the file private/unlisted: reachable only by its link, not in the gallery, not search-indexed; pass `public` only for gallery/search eligibility), `filename` (optional custom filename), `deliveryMode` (optional). This tool does not expose base64, password, or TTL inputs.

Example prompt:

> "Upload this PNG and give me a shareable link."

```
publish_file(url="https://example.com/diagram.png")
```

---

### Sites

### `publish_site`

Publish a single-page or multi-file HTML site. Pass `entryContent` for a single page or `files` (array of `{path, content}`) for a multi-file site. Supports password protection, TTL, and owner token grouping.

Parameters: exactly one of `entryContent` (string) or non-empty `files` (array of `{path, content}`), `entry` (optional entry file path, default `index.html`), `namespace` (optional -- omit for unlisted content; `public` grants gallery eligibility except when password-protected), `password` (optional), `ttlDays` (1--30, default 15), `ownerToken` (optional, groups site under an existing owner), `deliveryMode` (optional; fresh sites require `subdomain`).

Example prompt:

> "Deploy this static site with index.html and style.css."

```
publish_site(files=[{"path": "index.html", "content": "..."}, {"path": "style.css", "content": "..."}])
```

---

### `republish_site`

Replace an owned site's complete file set at the same ID and primary link. Files absent from the new bundle are removed; matching files are overwritten and new files added. Hosting stays unchanged.

Parameters: `namespace`, `id`, `ownerToken`, exactly one of `entryContent` or a non-empty `files` array of `{path, content}`, optional `entry` (default `index.html`), `ttlDays` (1--30, default 15), and `tags`.

```text
republish_site(namespace="public", id="aBcDeFgHiJ", ownerToken="tok_...", files=[{"path":"index.html","content":"<h1>Updated site</h1>"}])
```

---

### JSON

### `publish_json`

Publish a JSON document to BrewPage. Returns a public URL and owner token. The body may be passed as a JSON string or as a structured object.

Parameters: `json` (string, object, or array), `namespace` (optional -- omit for unlisted content; `public` grants gallery/search eligibility, except when password-protected), `password` (optional), `ttlDays` (1--30, default 15), `tags` (optional `string[]`), `ownerToken` (optional existing owner), `deliveryMode` (optional).

Example prompt:

> "Save this config blob as a JSON document I can fetch later."

```
publish_json(json={"mode": "dark", "version": 3}, ttlDays=15)
```

---

### `get_json`

Fetch a published JSON document by namespace and ID.

Parameters: `namespace` (string), `id` (string), `password` (optional, sent as `X-Password` if set).

Example prompt:

> "Read back the JSON document I just stored."

```
get_json(namespace="public", id="aBcDeFgHiJ")
```

---

### `update_json`

Update an existing JSON document in place, preserving its short URL. Requires the original `ownerToken`.

Parameters: `namespace` (string), `id` (string), `json` (string, object, or array), `ownerToken` (string).

Example prompt:

> "Bump the version field in that JSON doc to 4."

```
update_json(namespace="public", id="aBcDeFgHiJ", json={"mode": "dark", "version": 4}, ownerToken="tok_...")
```

---

### KV

### `publish_kv`

Create a new KV (key/value) entry. Returns a public URL and owner token. The KV entry is addressed by `(namespace, id, key)`; this tool creates the entry and emits the generated `id` along with the owner token.

Parameters: `key` (string), `value` (string), `namespace` (optional -- omit for unlisted content; `public` grants gallery/search eligibility, except when password-protected), `password` (optional), `ttlDays` (1--30, default 15), `tags` (optional `string[]`), `ownerToken` (optional existing owner), `deliveryMode` (optional).

Example prompt:

> "Store the selected theme so I can reuse it next session."

```
publish_kv(key="theme", value="dark")
```

---

### `set_kv`

Set or replace the value at an existing `(namespace, id, key)` slot. Requires the original `ownerToken`.

Parameters: `namespace` (string), `id` (string), `key` (string), `value` (string), `ownerToken` (string).

Example prompt:

> "Change the selected theme to light."

```
set_kv(namespace="public", id="aBcDeFgHiJ", key="theme", value="light", ownerToken="tok_...")
```

---

### `get_kv`

Fetch the value stored at `(namespace, id, key)`.

Parameters: `namespace` (string), `id` (string), `key` (string), `password` (optional, sent as `X-Password` if set).

Example prompt:

> "What theme did I store?"

```
get_kv(namespace="public", id="aBcDeFgHiJ", key="theme")
```

---

### Discovery

### `search_gallery`

Browse the public gallery of BrewPage pages, or list resources you own. Returns a paged result with metadata (id, title, view count, created date). All parameters are optional; with no parameters this returns the most recent public pages.

Parameters: `q` (optional search query), `page` (optional, 0-indexed), `size` (optional page size), `sort` (optional `date` | `views`), `mine` (optional boolean -- list only resources owned by `ownerToken`), `ownerToken` (required only when `mine=true`).

Example prompt:

> "What did I publish last week?"

```
search_gallery(mine=true, ownerToken="tok_...", sort="date")
```

---

### Management

### `delete_resource`

Delete a BrewPage resource (HTML page, KV store, JSON collection, or file) using the owner token received at creation.

Parameters: `type` (`html` | `kv` | `json` | `file`), `namespace` (string), `id` (string), `ownerToken` (string).

Sites are not supported by this tool; use the REST site deletion endpoint.

Example prompt:

> "Delete the page I just published -- namespace public, id aBcDeFgHiJ."

```
delete_resource(type="html", namespace="public", id="aBcDeFgHiJ", ownerToken="tok_...")
```

---

### `get_stats`

Get platform-wide BrewPage usage statistics (page count, file count, storage, daily totals). Supports an optional IANA timezone for the "today" boundary.

Parameters: `tz` (optional IANA timezone string, e.g. `Europe/Lisbon`, defaults to UTC).

Example prompt:

> "How many pages are currently hosted on BrewPage?"

```
get_stats()
```

## Common LLM Query to BrewPage Tool Mapping

| LLM query / intent | Tool | Notes |
|--------------------|------|-------|
| "Publish this HTML so I can share it" | `publish_html` | `format=HTML`; save `ownerToken` |
| "Share these meeting notes as a link" | `publish_html` | `format=MARKDOWN`; readable rendered output |
| "Host this AI-generated artifact" | `publish_html` | `namespace` optional; **private/unlisted by default**; `public` grants gallery/search eligibility except when protected |
| "Upload this image / PDF / video" | `publish_file` | Fetches from URL; inline preview on short URL |
| "Deploy this static site" | `publish_site` | Pass `files` array or `entryContent` |
| "Replace the site I published" | `republish_site` | Owner token; complete bundle replaces all existing files |
| "Give my public page a dedicated address" | `update_hosting` | NEW public non-site; owner token + current hosting version |
| "Fix a typo in the page I shared -- same link" | `update_html` | Requires `ownerToken`; URL stays the same |
| "Remove the page I published" | `delete_resource` | Requires `ownerToken` from creation |
| "Read back the page I published" | `get_page` | Returns raw content for editing |
| "How many pages are on BrewPage?" | `get_stats` | Returns platform totals |
| "Store JSON state between turns" | `publish_json` | Returns short URL + owner token |
| "Read that JSON document back" | `get_json` | By `namespace` + `id` |
| "Update the JSON I stored" | `update_json` | Requires `ownerToken`; preserves URL |
| "Save a value under a label / key" | `publish_kv` | Create a new KV slot |
| "Change the KV value I stored" | `set_kv` | Requires `ownerToken` |
| "What did I store under that key?" | `get_kv` | By `namespace` + `id` + `key` |
| "List my published pages" / "What did I publish?" | `search_gallery` | Set `mine=true` + `ownerToken` |
| "Browse the public BrewPage gallery" | `search_gallery` | Optional `q`, `sort=date\|views` |

## Owner Token

Every publish response includes an **owner token** -- the only credential that allows updating or deleting your content. **Save it. It cannot be recovered.**

- Reuse it with `publish_site`, `publish_json`, or `publish_kv` to group new resources under one owner; REST creates accept `X-Owner-Token`.
- Pass it to `delete_resource` to remove content.
- Pass it to `search_gallery` with `mine=true` to list owned resources. `get_page` has no owner-token input; protected reads use `password`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BREWPAGE_URL` | `https://brewpage.app` | Authorized apex API base URL; never a publication host |

## Links

- [brewpage.app](https://brewpage.app) -- Live platform
- [brewpage.app/llms.txt](https://brewpage.app/llms.txt) -- LLM context file
- [brewpage.app/llms-full.txt](https://brewpage.app/llms-full.txt) -- Full LLM reference
- [API Documentation](https://kochetkov-ma.github.io/brewpage-openapi/) -- Interactive docs
- [API Reference](https://kochetkov-ma.github.io/brewpage-openapi/api-reference/) -- Scalar API explorer
- [OpenAPI Spec](https://github.com/kochetkov-ma/brewpage-openapi/blob/main/openapi/openapi.yaml) -- Full specification
- [Claude Skill](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish) -- `/brewpage` slash command
- [Brewcode Plugin](https://github.com/kochetkov-ma/claude-brewcode) -- Claude Code plugin suite

## Changelog

## 1.9.2 -- 2026-10-06

- Dependencies are declared as exact versions, so an installed server uses the same SDK and `zod` versions it is built and tested with. No functional change.

## 1.9.1 -- 2026-10-06

- Dependency maintenance: refreshed the locked dependency versions used to build and test the server. No functional change.

## 1.9.0 -- 2026-10-06

- `publish_html` and `update_html` print `deliveryModeReason` and a `Delivery notice:` line when the server returns them. No input changes.

## 1.8.0 -- 2026-10-05

- Add `update_hosting` and the optional `deliveryMode` input on publish tools; responses show the server's hosting metadata. Tool count: 15 -> 16.

## 1.7.0 -- 2026-06-08

- Add `republish_site` -- replace a published site's files at the same URL. Tool count: 14 -> 15.

## 1.6.0 -- 2026-06-05

- **Private-by-default publishing.** When `namespace` is omitted, all five publish tools (`publish_html`, `publish_file`, `publish_site`, `publish_json`, `publish_kv`) now send an explicit unlisted namespace (`priv-<random>`) instead of letting the backend default to `public`. Omitted namespace = unlisted (reachable only by its link, not gallery-listed, not search-indexed); pass `namespace: "public"` explicitly to list + index. Non-breaking: `namespace` stays optional.
- Publish responses for non-public namespaces now append an "Unlisted link" notice explaining how to make content public.
- Tool descriptions and README rewritten to reflect the private-by-default model.

## 1.5.0 -- 2026-05-21

- Add 8 new MCP tools: `update_html`, `publish_json`, `get_json`, `update_json`, `publish_kv`, `set_kv`, `get_kv`, `search_gallery`.
- Tool count: 6 -> 14. Full coverage of HTML update, JSON CRUD, KV CRUD, and gallery discovery (incl. owner-scoped listing via `mine=true`).
- Update operations (`update_html`, `update_json`, `set_kv`) require the original `ownerToken`; `password` (when set) is forwarded as `X-Password`.

## 1.4.0 -- 2026-05-12

- Sync to spec 1.31.0 -- adds raw `text/*` and `application/octet-stream` variants on `POST /api/html`; PUT mirror; 422 with `supportedTypes`.

## License

[MIT](LICENSE)
