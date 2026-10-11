# Tips & Tricks

Power user tips for getting the most out of BrewPage.

---

## API alias and publication links

`brewdata.app` is an API alias. Keep the exact returned publication `link`; native publication hosts and legacy links have different routing behavior.

```bash
# Publish on brewpage.app
curl -X POST https://brewpage.app/api/html -d '...'

# Access from brewdata.app
curl https://brewdata.app/demo/aBcDeFgHiJ  # Same content!
```

---

## Short URLs for sharing

Use any `shortUrl` returned by the API, for example:

```
https://brewpage.app/s/xYz123
```

Use it in emails, chats, docs — much cleaner than the full URL.

---

## Password-protect anything

```bash
# Publish with password
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" -H "X-Password: mypass" \
  -d '{"content":"Secret stuff"}'

# Access with password
curl -H "X-Password: mypass" https://brewpage.app/api/html/public/aBcDeFgHiJ
# Query passwords apply only to legacy publications; NEW API reads use X-Password.
```

---

## Auto-expire with TTL

Set TTL to expire content after 1–30 days (default 15); owner-specific caps and eligible automatic extensions can affect the returned expiry:

```bash
curl -X POST 'https://brewpage.app/api/html?ttl=30' \
  -H "Content-Type: application/json" -d '{"content":"Temporary"}'
```

---

## KV as feature flags

Create the store first with `POST /api/kv`, then use its returned namespace, store ID and owner token for writes.

```bash
# Set flags
curl -X PUT https://brewpage.app/api/kv/myapp/flags/dark_mode \
  -H "X-Owner-Token: your-owner-token" \
  -H "Content-Type: application/json" -d '{"value":"true"}'

# Check from any language — just a GET request
curl -s https://brewpage.app/api/kv/myapp/flags/dark_mode | jq -r .value
```

---

## JSON as a simple database

```bash
# Create a document
curl -X POST 'https://brewpage.app/api/json?ns=myapp' \
  -H "Content-Type: application/json" -d '{"name":"Alice","role":"admin"}'

# List all
curl 'https://brewpage.app/api/json?ns=myapp' -H "X-Owner-Token: your-owner-token"
```

---

## Gallery for discovery

Unpassworded `public` publications may qualify for gallery/search discovery. Eligible public native HTML, sites and files may permit indexing; unlisted, protected or otherwise ineligible native responses carry `noindex`:

```bash
curl https://brewpage.app/api/gallery
curl "https://brewpage.app/api/gallery?search=tutorial"
```

---

## Batch upload files

```bash
for f in *.png; do
  curl -X POST 'https://brewpage.app/api/files?ns=screenshots' \
    -F "file=@$f"
done
```

---

## CI/CD integration

Publish build reports or test results from GitHub Actions:

```yaml
- name: Publish test report
  run: |
    curl -X POST 'https://brewpage.app/api/html?ns=ci&ttl=30' \
      -H "Content-Type: application/json" \
      -d "$(jq -Rs '{content: .}' report.html)"
```

---

## Tags for organization

```bash
curl -X POST 'https://brewpage.app/api/html?tags=tutorial,python' \
  -H "Content-Type: application/json" -d '{"content":"Tagged"}'
```

Tags help organize content and make it searchable in the gallery.

---

## Monitor with stats

```bash
curl -s https://brewpage.app/api/stats | jq .
```
