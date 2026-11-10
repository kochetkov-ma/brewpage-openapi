# BrewPage

Use the `brewpage` MCP tools to publish HTML, Markdown, sites, files, JSON or KV and share a link.

- Free, no signup, no API key.
- Links expire in 15 days by default, 30 days max (90 with an owner token in a profile); trust the returned `expiresAt`.
- Omitted namespace = unlisted, not private: anyone with the link can open it. Never publish secrets without a password.
- `public` namespace lists HTML, sites and files in the gallery and search.
- Give the user the returned link and the `MANAGE LINK` (`manageUrl`; private: anyone who has it can edit or delete the page). Keep `ownerToken`, pass it as `ownerToken` on later publishes and updates, and show it when the user asks or when you cannot keep it. Never post either publicly (public page, repo, shared channel).
- Own domain (only when the user asks): `set_domain` returns DNS records for the user to create at their DNS provider; then `check_domain` until status is `active`. Needs the owner token in a free BrewPage profile.
- Limits: `get_limits`. Docs: https://brewpage.app/llms.txt
