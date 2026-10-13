# BrewPage API Wiki

> **Publish anything in seconds.** HTML, Markdown, files, JSON, key-value data, multi-file sites — no signup required.

**Resource types:**
- **HTML** — Single-page HTML or Markdown publishing
- **KV** — Key-value store
- **JSON** — Arbitrary JSON documents
- **Files** — File uploads and downloads
- **Sites** — Multi-file HTML site hosting via ZIP or individual files

---

## Quick Start — 4 Ways to Publish

### 1. Web UI (Zero Code)

```
Open brewpage.app  →  Drop your file  →  Click Publish  →  Get link
```

| Step | Action |
|:----:|--------|
| **1** | Open [brewpage.app](https://brewpage.app) |
| **2** | Drag & drop HTML / Markdown / CSV / any file |
| **3** | Click **Publish** |
| **4** | Copy your link and share |

---

### 2. Standalone Claude Skill (`/brewpage-publish`)

```
/brewpage-publish "Hello world"  →  Pick namespace  →  Get link
```

| Step | Action |
|:----:|--------|
| **1** | Install with Node 22.20.0+: `npx --yes skills@1.7.2 add kochetkov-ma/claude-brewcode --skill brewpage-publish` |
| **2** | In Claude Code: `/brewpage-publish "your text"` or `/brewpage-publish report.md` |
| **3** | Pick a namespace and optional password |
| **4** | Get link + owner token saved to `.claude/brewpage-history.md` |

Works with text, Markdown, JSON, and files. [Skill docs](https://doc-claude.brewcode.app/brewdoc/skills/publish/) · [Source](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish)

The linked brewdoc plugin guide uses `/brewdoc:publish`; the standalone skill above uses `/brewpage-publish`.

---

### 3. MCP Server (AI Agent)

```
"Publish this to BrewPage"  →  Claude calls API  →  Here's your link + token
```

| Step | Action |
|:----:|--------|
| **1** | Add `brewpage-mcp` to Claude config ([setup](MCP-Server)) |
| **2** | Ask Claude: *"Publish this to BrewPage"* |
| **3** | Claude publishes and returns link + token |

---

### 4. REST API (curl / code)

```
POST /api/html  →  Get URL + owner token  →  Share
```

```bash
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{"content":"<h1>Hello World</h1>","format":"HTML"}'
```

See [API Cheatsheet](API-Cheatsheet) · [Code Snippets](Code-Snippets)

---

## Wiki Pages

| Page | Description |
|------|-------------|
| [Quick Start](Quick-Start) | Step-by-step for all 4 methods |
| [API Cheatsheet](API-Cheatsheet) | Every endpoint at a glance |
| [Code Snippets](Code-Snippets) | Copy-paste in 6 languages |
| [Tips & Tricks](Tips-and-Tricks) | Power user hacks |
| [MCP Server](MCP-Server) | AI assistant integration |

## All Resources

| Resource | Link |
|----------|------|
| **brewpage.app** | [brewpage.app](https://brewpage.app) |
| **brewdata.app** (redirects to brewpage.app) | [brewdata.app](https://brewdata.app) |
| **API Docs (Scalar)** | [kochetkov-ma.github.io/brewpage-openapi](https://kochetkov-ma.github.io/brewpage-openapi/) |
| **OpenAPI Spec** | [openapi.yaml](https://github.com/kochetkov-ma/brewpage-openapi/blob/main/openapi/openapi.yaml) |
| **MCP Server** | [mcp-server/](https://github.com/kochetkov-ma/brewpage-openapi/tree/main/mcp-server) |
| **Claude Skill** | [brewpage-publish](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish) |
| **Skill Docs** | [Publishing skill docs](https://doc-claude.brewcode.app/brewdoc/skills/publish/) |
| **Brewcode Plugin** | [github.com/kochetkov-ma/claude-brewcode](https://github.com/kochetkov-ma/claude-brewcode) |
| **Brewcode Site** | [brewcode.app](https://brewcode.app) |
| **GitHub Action** | [github.com/kochetkov-ma/brewpage-action](https://github.com/kochetkov-ma/brewpage-action) |
| **Cookbook** | [github.com/kochetkov-ma/brewpage-cookbook](https://github.com/kochetkov-ma/brewpage-cookbook) |
| **brewdoc CLI** (document-to-Markdown) | [pypi.org/project/brewdoc](https://pypi.org/project/brewdoc/) · [source](https://github.com/kochetkov-ma/brewdoc) |
