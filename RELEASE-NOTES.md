# Release Notes

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
