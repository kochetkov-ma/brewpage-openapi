# API Cheatsheet

Base URL: `https://brewpage.app` (alias: `https://brewdata.app`)

---

## HTML Pages

```
POST   /api/html              → Publish page
GET    /api/html/{ns}/{id}    → Get page
PUT    /api/html/{ns}/{id}    → Update page
DELETE /api/html/{ns}/{id}    → Delete page
GET    /api/html/{ns}         → List pages in namespace
```

**POST body:**
```json
{
  "namespace": "my-ns",
  "content": "<h1>Hello</h1>",
  "format": "HTML | MARKDOWN",
  "password": "optional",
  "ttlDays": 365,
  "tags": ["tag1"]
}
```

**Headers:** `X-Owner-Token: tok_xxx` (update/delete) · `X-Password: secret` (protected pages)

---

## Key-Value Store

```
PUT    /api/kv/{ns}/{id}/{key}  → Set key
GET    /api/kv/{ns}/{id}/{key}  → Get key
GET    /api/kv/{ns}/{id}        → List keys
DELETE /api/kv/{ns}/{id}/{key}  → Delete key
DELETE /api/kv/{ns}/{id}        → Delete store
```

Limits: **1,000 keys/store**, **1 MB/value**

---

## JSON Documents

```
POST   /api/json/{ns}/{collection}       → Create doc
GET    /api/json/{ns}/{collection}/{id}  → Get doc
GET    /api/json/{ns}/{collection}       → List docs
DELETE /api/json/{ns}/{collection}/{id}  → Delete doc
DELETE /api/json/{ns}/{collection}       → Delete collection
```

Limits: **10,000 docs/collection**, **1 MB/document**

---

## Files

```
POST   /api/files/uploads                → Upload (multipart)
GET    /api/files/{ns}/{id}/{filename}   → Download
GET    /api/files/{ns}                   → List files
DELETE /api/files/{ns}/{id}              → Delete file
```

Limits: **5 MB/file**, **1,000 files/namespace**

---

## Gallery & Stats

```
GET /api/gallery/pages              → Browse public pages
GET /api/gallery/files              → Browse public files
GET /api/gallery/pages?search=query → Search
GET /api/stats                      → Platform statistics
```

---

## Short URLs

Every resource gets: `https://brewpage.app/s/{code}`

---

## Rate Limits

| Operation | Limit |
|-----------|-------|
| Uploads (POST) | 60/hour/IP |
| Reads (GET) | 300/min/IP |

## Size Limits

| Resource | Max Size | Max Count |
|----------|----------|-----------|
| HTML page | 5 MB | — |
| KV value | 1 MB | 1,000 keys/store |
| JSON doc | 1 MB | 10,000 docs/collection |
| File | 5 MB | 1,000 files/ns |
| TTL | 30–365 days | — |
