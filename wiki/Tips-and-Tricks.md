# Tips & Tricks

Power user tips for getting the most out of BrewPage.

---

## Both domains work the same

`brewpage.app` and `brewdata.app` serve the exact same API. Content published on one is accessible from both.

```bash
# Publish on brewpage.app
curl -X POST https://brewpage.app/api/html -d '...'

# Access from brewdata.app
curl https://brewdata.app/demo/aBcDeFgHiJ  # Same content!
```

---

## Short URLs for sharing

Every published resource gets a short URL:

```
https://brewpage.app/s/xYz123
```

Use it in emails, chats, docs — much cleaner than the full URL.

---

## Password-protect anything

```bash
# Publish with password
curl -X POST https://brewpage.app/api/html \
  -d '{"content":"Secret stuff","format":"HTML","password":"mypass"}'

# Access with password
curl -H "X-Password: mypass" https://brewpage.app/ns/id
# or
curl "https://brewpage.app/ns/id?p=mypass"
```

---

## Auto-expire with TTL

Set TTL to auto-delete content after N days (30-365):

```bash
curl -X POST https://brewpage.app/api/html \
  -d '{"content":"Temporary","format":"HTML","ttlDays":30}'
```

---

## KV as feature flags

```bash
# Set flags
curl -X PUT https://brewpage.app/api/kv/myapp/flags/dark_mode \
  -H "Content-Type: application/json" -d '{"value":"true"}'

# Check from any language — just a GET request
curl -s https://brewpage.app/api/kv/myapp/flags/dark_mode | jq -r .value
```

---

## JSON as a simple database

```bash
# Create records
curl -X POST https://brewpage.app/api/json/myapp/users \
  -d '{"document":{"name":"Alice","role":"admin"}}'

# List all
curl https://brewpage.app/api/json/myapp/users
```

---

## Gallery for discovery

All public content (namespace `public`, no password) is browsable:

```bash
curl https://brewpage.app/api/gallery/pages
curl "https://brewpage.app/api/gallery/pages?search=tutorial"
```

---

## Batch upload files

```bash
for f in *.png; do
  curl -X POST https://brewpage.app/api/files/uploads \
    -F "namespace=screenshots" -F "file=@$f"
done
```

---

## CI/CD integration

Publish build reports or test results from GitHub Actions:

```yaml
- name: Publish test report
  run: |
    curl -X POST https://brewpage.app/api/html \
      -H "Content-Type: application/json" \
      -d "{\"namespace\":\"ci\",\"content\":\"$(cat report.html)\",\"format\":\"HTML\",\"ttlDays\":30}"
```

---

## Tags for organization

```bash
curl -X POST https://brewpage.app/api/html \
  -d '{"content":"Tagged","format":"HTML","tags":["tutorial","python"]}'
```

Tags help organize content and make it searchable in the gallery.

---

## Monitor with stats

```bash
curl -s https://brewpage.app/api/stats | jq .
```
