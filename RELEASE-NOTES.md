# Release Notes

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
