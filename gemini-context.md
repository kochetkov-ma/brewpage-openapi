# BrewPage

Use the `brewpage` MCP tools to publish HTML, Markdown, sites, files, JSON or KV and share a link.

- Free, no signup, no API key.
- Links expire in 15 days by default, 30 days max (90 with an owner token in a profile); trust the returned `expiresAt`.
- Omitted namespace = unlisted, not private: anyone with the link can open it. Never publish secrets without a password.
- `public` namespace lists HTML, sites and files in the gallery and search.
- Give the user the returned link; save `ownerToken` privately (never in chat) and send it as `X-Owner-Token` on later publishes and updates.
- Limits: `get_limits`. Docs: https://brewpage.app/llms.txt
