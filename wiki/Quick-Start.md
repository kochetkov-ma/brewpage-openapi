# Quick Start

Four ways to publish content on BrewPage. Pick the one that fits your workflow.

---

## Method 1: Web UI

> **Best for:** Quick one-off publishing, non-developers

```
┌─────────────────────────────────────────────────────┐
│  1. OPEN         brewpage.app                       │
│       ↓                                             │
│  2. DROP         HTML / Markdown / CSV / File       │
│       ↓                                             │
│  3. PUBLISH      Click the button                   │
│       ↓                                             │
│  4. SHARE        Copy link → send to anyone         │
└─────────────────────────────────────────────────────┘
```

| # | What to do | Details |
|:-:|-----------|---------|
| 1 | Open [brewpage.app](https://brewpage.app) | Works in any browser |
| 2 | Drag & drop your content | `.html`, `.md`, `.csv`, `.txt`, images, PDFs, any file |
| 3 | Click **Publish** | Optional: password, TTL, tags |
| 4 | Copy your link | Short URL for sharing, owner token for management |

**UI features:** Markdown preview · Password toggle · TTL selector · Tag input · Dark/light theme

---

## Method 2: Claude Skill (`/brewpage`)

> **Best for:** Claude Code users who want one-command publishing

```
┌─────────────────────────────────────────────────────┐
│  1. INSTALL      npx skills add claude-brewcode     │
│       ↓                                             │
│  2. COMMAND      /brewpage "your text"              │
│       ↓                                             │
│  3. CHOOSE       Namespace + password (interactive) │
│       ↓                                             │
│  4. DONE         Link + token saved automatically   │
└─────────────────────────────────────────────────────┘
```

### Install (one-time)

```bash
npx skills add kochetkov-ma/claude-brewcode
```

### Usage

```
/brewpage "Hello, world!"              # Text → Markdown page
/brewpage report.md                    # File → upload
/brewpage '{"status": "ok"}'           # JSON → formatted document
/brewpage screenshot.png --ttl 1       # File with 1-day expiry
```

Or use natural language in any prompt:
```
Publish this to brewpage
Upload report.md to brewpage.app
Сделай публичную ссылку
```

**What happens:**
1. Claude detects content type (text/JSON/file)
2. Asks you for namespace and password
3. Calls brewpage.app API
4. Returns public URL
5. Saves owner token to `.claude/brewpage-history.md`

[Skill docs](https://doc-claude.brewcode.app/brewdoc/brewpage/) · [Source](https://github.com/kochetkov-ma/claude-brewcode/tree/main/skills/brewpage-publish)

---

## Method 3: MCP Server (AI Agent)

> **Best for:** Claude Desktop users, automated AI workflows

```
┌─────────────────────────────────────────────────────┐
│  1. INSTALL      Add brewpage-mcp to config         │
│       ↓                                             │
│  2. ASK          "Publish this HTML to BrewPage"    │
│       ↓                                             │
│  3. DONE         Claude returns URL + owner token   │
└─────────────────────────────────────────────────────┘
```

### Install (one-time)

**Claude Desktop** — `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp"]
    }
  }
}
```

**Claude Code** — `settings.json`:
```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp"]
    }
  }
}
```

### Usage

Just tell Claude what to publish:

| You say | What happens |
|---------|-------------|
| "Publish this HTML to BrewPage" | `publish_html` → URL + token |
| "Create a BrewPage with my notes" | `publish_html` (MARKDOWN) |
| "Upload this image to BrewPage" | `publish_file` |
| "Delete page demo/abc123 token tok_xyz" | `delete_resource` |

See [MCP Server](MCP-Server) for full details.

---

## Method 4: REST API (curl / code)

> **Best for:** Scripts, CI/CD, integrations, non-Claude tools

```
┌─────────────────────────────────────────────────────┐
│  1. POST         Send content to /api/html          │
│       ↓                                             │
│  2. RECEIVE      URL + shortUrl + ownerToken        │
│       ↓                                             │
│  3. SHARE        Use URL anywhere                   │
└─────────────────────────────────────────────────────┘
```

### Publish HTML

```bash
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{"content":"<h1>Hello World</h1>","format":"HTML"}'
```

### Publish Markdown

```bash
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{"content":"# My Page\n\n**Bold** text","format":"MARKDOWN"}'
```

### Upload a File

```bash
curl -X POST https://brewpage.app/api/files/uploads \
  -F "namespace=assets" -F "file=@photo.jpg"
```

### Response

```json
{
  "namespace": "demo",
  "id": "aBcDeFgHiJ",
  "url": "https://brewpage.app/demo/aBcDeFgHiJ",
  "shortUrl": "https://brewpage.app/s/xYz123",
  "ownerToken": "tok_abc123..."
}
```

> **Save your `ownerToken`!** It's the only way to delete or update content later.

### With Options

```bash
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "myproject",
    "content": "# Private Notes",
    "format": "MARKDOWN",
    "password": "secret123",
    "ttlDays": 90,
    "tags": ["notes"]
  }'
```

See [API Cheatsheet](API-Cheatsheet) · [Code Snippets](Code-Snippets)

---

## What's Next?

| Want to... | Go to |
|-----------|-------|
| See all API endpoints | [API Cheatsheet](API-Cheatsheet) |
| Copy code in your language | [Code Snippets](Code-Snippets) |
| Learn power-user tips | [Tips & Tricks](Tips-and-Tricks) |
| Full MCP setup guide | [MCP Server](MCP-Server) |
| Interactive API explorer | [API Docs](https://kochetkov-ma.github.io/brewpage-openapi/) |
| Brewcode plugin suite | [github.com/kochetkov-ma/claude-brewcode](https://github.com/kochetkov-ma/claude-brewcode) |
