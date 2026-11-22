# MCP Server

Use BrewPage directly from Claude Desktop, Claude Code, or any MCP client.

---

## How it works

```
┌─────────────────────────────────────────────────────┐
│  YOU       "Publish this to BrewPage"               │
│    ↓                                                │
│  CLAUDE    Calls publish via MCP                    │
│    ↓                                                │
│  BREWPAGE  Creates page, returns URL                │
│    ↓                                                │
│  CLAUDE    "Here's your link: ... Save your token!" │
└─────────────────────────────────────────────────────┘
```

---

## Install

### Remote (no install)

One remote MCP server for every client: `https://brewpage.app/mcp` (Streamable HTTP, anonymous access or optional account connection). Add it by URL in Claude (a custom connector), ChatGPT (a custom MCP server) or any Streamable HTTP client.

Claude Code: `claude mcp add --transport http brewpage --scope user https://brewpage.app/mcp` (leave out `--scope user` to add it to the current project only), or in `.mcp.json`:

```json
{
  "mcpServers": {
    "brewpage": {
      "type": "http",
      "url": "https://brewpage.app/mcp"
    }
  }
}
```

### Claude.ai and Claude Desktop

Claude calls a remote MCP server a custom connector. Add it once in Claude on the web; Claude Desktop picks it up too. Nothing to install.

1. Open **Customize** > **Connectors**.
2. Click **+ Add**, then **Add custom connector**.
3. Name it **BrewPage**, paste `https://brewpage.app/mcp` and click **Continue**.
4. Choose anonymous access for immediate publishing or connect BrewPage for account access.

The free plan includes one custom connector.

Local fallback (stdio, needs Node.js; the same tools): edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@3.2.0"]
    }
  }
}
```

Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude Code

The remote command above is the default. Local fallback: run `claude mcp add --transport stdio --scope project brewpage -- npx -y brewpage-mcp@3.2.0`, or add this to project-root `.mcp.json`:

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@3.2.0"]
    }
  }
}
```

### Direct run

```bash
npx -y brewpage-mcp@3.2.0
```

---

## Legacy tool reference

| Tool | What it does |
|------|-------------|
| `publish_html` | Publish a page (`content`: HTML, Markdown, code or JSON) or a static site (`files`) → link, owner token, management link |
| `update_html` | Replace a page's content or every file of a site with owner authority; the link stays |
| `publish_file` | Upload file from URL → link, owner token, management link; HTML and Markdown become pages |
| `delete_resource` | Delete with owner token (incl. sites) |
| `set_publication` | Change settings: `listed`, `badgeHidden` (profile, up to 5 hidden), `title`, `password`, `extend`, `deliveryMode`; only what you send changes |
| `make_private` | Make a public publication private: new private link; it can be made public again later |
| `bind_token` | Add a token to your profile (admin token) |
| `mint_token` | Mint a profile token, shown once (admin token) |
| `set_domain` | Connect a domain you own to an HTML page or site → DNS records to create |
| `check_domain` | Run a DNS check once the records exist; `pending_dns` → `verifying` → `active` |
| `list_domains` | Read one custom domain's status without a check, or list the profile's custom domains (admin token) |
| `remove_domain` | Remove a custom domain; BrewPage link keeps working |
| `get_page` | Read a page (the API's rendered HTML or raw code), a JSON document (`type: "json"`) or a KV value (`type: "kv"`, `key`); long content continues by `offset` |
| `get_stats` | Platform statistics |
| `get_limits` | Current upload limits (`GET /api/limits`) |
| `publish_json` | Publish a JSON document |
| `update_json` | Update JSON with owner authority |
| `publish_kv` | Create a KV store |
| `set_kv` | Upsert a key with owner authority |
| `search_gallery` | Search the public gallery; `mine: true` lists your own publications |
| `get_guide` | Read a short guide: Page data before writing a page that saves what visitors enter, ready templates and how to publish a copy, or the custom-domain steps |
| `get_page_data` | Read what visitors saved on your page: settings and usage, one list's entries, its uploaded files (`include: "files"`) or totals per answer (`countBy`) |
| `set_page_data` | Write author entries (for example today's menu) without republishing |
| `configure_page_data` | Turn Page data on or off, change who can read a list and its limits; only what you name changes |
| `delete_page_data` | Delete entries (`docIds`) or files (`fileIds`) by id, by time range, or the whole list (`all: true`) |

Version 3.2.0 lists 13 compact tools. Its saved calls include the 25 tool names from 2.1.2 and eight earlier aliases, including `publish_site` and `update_hosting`. [Compact tool reference](https://github.com/kochetkov-ma/brewpage-openapi/tree/main/mcp-server)

Omitted `namespace` is private (a generated namespace): unlisted and not indexed; anyone with the link can still open it. `public` lists HTML, sites and files in the gallery and sitemap, so Google, Bing and AI search can index them. Password-protected publications are never listed. Keep the exact server-returned `link`, cohort and effective mode.

---

## Page data

A published HTML page or site can save what its visitors enter: form answers, a guestbook, votes, scores, game progress. Ask for it in plain words ("make a guestbook page that saves messages"): the assistant reads `get_guide`, writes the page with the script `https://brewpage.app/js/state.js` and publishes it with `state`.

- Each visitor reads and writes only their own entries by default; a `shared` list is readable by everyone; a `shared` list with `write: "author"` is written only by you.
- You read everything: in the Data tab behind the management link, or by asking the assistant ("show me what people wrote").
- After publishing, the assistant gives you the page link and the management link. The management link is private: whoever has it can edit or delete the page and read its data. The assistant keeps the owner token and shows it on request; neither is ever posted publicly.
- In a later chat, paste the management link: `get_page_data`, `set_page_data`, `configure_page_data` and `delete_page_data` take it as `manageUrl` instead of the owner token.

---

## Usage flow

```
┌────────────────────────────────────────────────┐
│  Step 1: Tell Claude what to publish           │
│  "Publish my meeting notes as Markdown"        │
│                                                │
│  Step 2: Claude calls publish_html             │
│  → content: "# Meeting Notes\n..."            │
│  → format: markdown                            │
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
| "Create a BrewPage with my notes in Markdown" | `publish_html` (format markdown) |
| "Upload this image to BrewPage" | `publish_file` |
| "Deploy this static site" | `publish_html` (files) |
| "Make it password-protected with 'secret'" | `publish_html` (password); later: `set_publication` (password) |
| "Set it to expire in 30 days" | `publish_html` (ttlDays) |
| "Take it out of the gallery" / "Rename it" | `set_publication` (listed, title) |
| "Read back the JSON I stored" | `get_page` (type json) |
| "Delete my page demo/abc123, token tok_xyz" | `delete_resource` |
| "Show BrewPage stats" | `get_stats` |
| "How many files can a BrewPage site have?" | `get_limits` |
| "Make a guestbook page that saves messages" | `get_guide`, then `publish_html` (state) |
| "Show me what people wrote on my page" | `get_page_data` |
| "How did the vote go?" | `get_page_data` (countBy) |
| "Remove these spam entries" | `delete_page_data` |

---

## Owner Token

Every publish response includes an **owner token**. This token is:
- Needed to delete or update your content
- **Not recoverable** if lost
- Claude will always remind you to save it

Optional: sign in free (Google or any email) at https://account.brewpage.app to never lose your pages or tokens and to mint tokens that never expire. Not needed to publish.

---

## Configuration

| Env Variable | Default | Description |
|-------------|---------|-------------|
| `BREWPAGE_URL` | `https://brewpage.app` | API base URL |
| `BREWPAGE_OWNER_TOKEN` | unset | Default owner token; never printed |

---

## Source

[github.com/kochetkov-ma/brewpage-openapi/tree/main/mcp-server](https://github.com/kochetkov-ma/brewpage-openapi/tree/main/mcp-server)
