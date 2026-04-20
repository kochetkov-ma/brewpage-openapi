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
      "args": ["-y", "brewpage-mcp"]
    }
  }
}
```

Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude Code

Edit `~/.claude/settings.json`:

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

### Direct run

```bash
npx brewpage-mcp
```

---

## Tools

| Tool | What it does |
|------|-------------|
| `publish_html` | Publish HTML or Markdown → URL + token |
| `publish_file` | Upload file from URL → URL + token |
| `publish_site` | Publish a multi-file HTML site from HTML content (`entryContent`, `namespace?`, `password?`, `ttlDays?`) |
| `delete_resource` | Delete with owner token |
| `get_page` | Fetch page content |
| `get_stats` | Platform statistics |

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
