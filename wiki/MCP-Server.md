# MCP Server

Use BrewPage directly from Claude Desktop, Claude Code, or any MCP client.

---

## How it works

```
┌─────────────────────────────────────────────────────┐
│  YOU       "Publish this to BrewPage"               │
│    ↓                                                │
│  CLAUDE    Calls publish_html via MCP               │
│    ↓                                                │
│  BREWPAGE  Creates page, returns URL                │
│    ↓                                                │
│  CLAUDE    "Here's your link: ... Save your token!" │
└─────────────────────────────────────────────────────┘
```

---

## Install

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@1.9.4"]
    }
  }
}
```

Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude Code

Run `claude mcp add --transport stdio --scope project brewpage -- npx -y brewpage-mcp@1.9.4`, or add this to project-root `.mcp.json`:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@1.9.4"]
    }
  }
}
```

### Direct run

```bash
npx -y brewpage-mcp@1.9.4
```

---

## Tools

| Tool | What it does |
|------|-------------|
| `publish_html` | Publish HTML or Markdown → URL + token |
| `publish_file` | Upload file from URL → URL + token |
| `publish_site` | Publish a multi-file HTML site from HTML content (`entryContent`, `namespace?`, `password?`, `ttlDays?`) |
| `delete_resource` | Delete with owner token |
| `get_page` | Fetch the API's rendered HTML or raw code response; original authored source is owner-only |
| `get_stats` | Platform statistics |
| `republish_site` | Replace a site's files with owner authority |
| `update_html` | Update HTML with owner authority |
| `publish_json` | Publish a JSON document |
| `get_json` | Read a JSON document |
| `update_json` | Update JSON with owner authority |
| `publish_kv` | Create a KV store |
| `set_kv` | Upsert a key with owner authority |
| `get_kv` | Read a key |
| `search_gallery` | Search eligible public publications |
| `update_hosting` | Change hosting with owner authority and the expected hosting version |

Omitted `namespace` generates an unlisted namespace. Use `public` explicitly for discovery eligibility; password protection excludes discovery independently. Unlisted links remain readable by anyone who has them unless protected. Keep the exact server-returned `link`, cohort and effective mode. Eligible public native HTML, sites and files may permit indexing; unlisted, protected or otherwise ineligible native responses carry `noindex`.

---

## Usage flow

```
┌────────────────────────────────────────────────┐
│  Step 1: Tell Claude what to publish           │
│  "Publish my meeting notes as Markdown"        │
│                                                │
│  Step 2: Claude calls publish_html             │
│  → content: "# Meeting Notes\n..."            │
│  → format: MARKDOWN                            │
│                                                │
│  Step 3: You get the result                    │
│  URL: https://brewpage.app/notes/aBcDeFgHiJ   │
│  Token: tok_abc123...                          │
│                                                │
│  ⚠ SAVE YOUR TOKEN — needed for delete/update  │
└────────────────────────────────────────────────┘
```

---

## Example prompts

| You say | Tool called |
|---------|------------|
| "Publish this HTML to BrewPage" | `publish_html` |
| "Create a BrewPage with my notes in Markdown" | `publish_html` (MARKDOWN) |
| "Upload this image to BrewPage" | `publish_file` |
| "Make it password-protected with 'secret'" | `publish_html` (password) |
| "Set it to expire in 30 days" | `publish_html` (ttlDays) |
| "Delete my page demo/abc123, token tok_xyz" | `delete_resource` |
| "Show BrewPage stats" | `get_stats` |

---

## Owner Token

Every publish response includes an **owner token**. This token is:
- The **only** way to delete or update your content
- **Not recoverable** if lost
- Claude will always remind you to save it

---

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `BREWPAGE_URL` | `https://brewpage.app` | API base URL |

---

## Source

[github.com/kochetkov-ma/brewpage-openapi/tree/main/mcp-server](https://github.com/kochetkov-ma/brewpage-openapi/tree/main/mcp-server)
