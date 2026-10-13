# API Cheatsheet

Base URL: `https://brewpage.app` (`https://brewdata.app` redirects to it with 301)

---

## HTML Pages

```
POST   /api/html              → Publish page
GET    /api/html/{ns}/{id}    → Get page
PUT    /api/html/{ns}/{id}    → Update page
DELETE /api/html/{ns}/{id}    → Delete page
GET    /api/html?ns={ns}      → Owner-scoped list (X-Owner-Token)
```

**POST body:**
```json
{
  "content": "<h1>Hello</h1>"
}
```

**Headers:** `X-Owner-Token: tok_xxx` (update/delete) · `X-Password: secret` (protected pages)

Creation options use query parameters `ns`, `format`, `ttl`, `tags` and the `X-Password` header. REST omitted `ns` defaults to `public`; MCP omitted `namespace` generates an unlisted namespace. Use exact returned links. Rendered HTML/code, original owner-only `/source`, and browser viewers are distinct representations.

---

## Key-Value Store

```
POST   /api/kv                 → Create store
PUT    /api/kv/{ns}/{id}/{key}  → Set key (X-Owner-Token)
GET    /api/kv/{ns}/{id}/{key}  → Get key
GET    /api/kv/{ns}/{id}        → List keys
DELETE /api/kv/{ns}/{id}/{key}  → Delete key
DELETE /api/kv/{ns}/{id}        → Delete store
```

Limits: **1,000 keys/store**, **1 MB/value**

---

## JSON Documents

```
POST   /api/json              → Create arbitrary JSON document
GET    /api/json/{ns}/{id}     → Get document
PUT    /api/json/{ns}/{id}     → Update document (X-Owner-Token)
GET    /api/json?ns={ns}       → Owner-scoped list (X-Owner-Token)
DELETE /api/json/{ns}/{id}     → Delete document (X-Owner-Token)
```

Limits: **10,000 docs/namespace**, **1 MB/document**

---

## Files

```
POST   /api/files                       → Upload (multipart; ns query parameter)
GET    /api/files/{ns}/{id}              → Read file bytes
GET    /api/files?ns={ns}                → Owner-scoped list (X-Owner-Token)
DELETE /api/files/{ns}/{id}              → Delete file
```

Limits: **5 MB/file**, **1,000 files/namespace**

---

## Sites

| Action | Method | Endpoint |
|--------|--------|----------|
| Upload site (ZIP) | `POST` | `/api/sites` |
| Upload site (files) | `POST` | `/api/sites` |
| Get site info | `GET` | `/api/sites/{ns}/{id}` |
| Serve site file | `GET` | `/api/sites/{ns}/{id}/files/{filePath}` |
| Delete site | `DELETE` | `/api/sites/{ns}/{id}` |

**Query params (upload):** `ns` (default: public), `tags` (comma-separated), `ttl` (1-30 days), `entry` (override entry file)
**Headers:** `X-Password` (protection), `X-Owner-Token` (owner grouping / info / delete)
**Response (201):** `id`, `namespace`, `entryFile`, `link`, `ownerLink`, `fileCount`, `totalSizeBytes`, `expiresAt`, `tags`, `ownerToken`

---

## Gallery & Stats

```
GET /api/gallery                   → Browse eligible public publications
GET /api/gallery?search=query      → Search
GET /api/stats                      → Platform statistics
```

---

## Short URLs

Use the exact primary `link` and any `shortUrl` returned by the API; do not reconstruct publication URLs.

---

## Rate Limits

Limits depend on operation and visibility. Handle `429` and any `Retry-After` header returned by the running API.

## Size Limits

| Resource | Max Size | Max Count |
|----------|----------|-----------|
| HTML page | 5 MB | — |
| KV value | 1 MB | 1,000 keys/store |
| JSON doc | 1 MB | 10,000 docs/namespace |
| File | 5 MB | 1,000 files/ns |
| Site | 20 MB total, 5 MB/file | 100 files/site |
| TTL | 1–30 days (default 15) | — |

Repository defaults use MiB; video files allow up to 20 MiB. Deployment and owner-specific TTL caps can differ. Eligible content may receive automatic TTL extensions; `expiresAt` is authoritative. Site republishing without a new TTL retains the existing expiry. A ZIP uploaded as `archive` to `/api/sites` is extracted for hosting; a ZIP sent to `/api/files` is hosted as a file.

Unpassworded `public` publications may qualify for gallery/search. Eligible public native HTML/sites/files may permit indexing; unlisted, protected or otherwise ineligible native responses carry `noindex`. Public namespace is not a guarantee of listing or indexing.
