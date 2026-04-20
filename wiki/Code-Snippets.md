# Code Snippets

Copy-paste examples for working with BrewPage API in 6 languages.

---

## cURL

```bash
# Publish HTML
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{"content":"<h1>Hello</h1>","format":"HTML"}'

# Publish Markdown with password
curl -X POST https://brewpage.app/api/html \
  -H "Content-Type: application/json" \
  -d '{"content":"# Secret","format":"MARKDOWN","password":"s3cret"}'

# Upload file
curl -X POST https://brewpage.app/api/files/uploads \
  -F "namespace=assets" -F "file=@image.png"

# Read KV
curl https://brewpage.app/api/kv/myapp/config/theme

# Write KV
curl -X PUT https://brewpage.app/api/kv/myapp/config/theme \
  -H "Content-Type: application/json" -d '{"value":"dark"}'

# Delete (with owner token)
curl -X DELETE https://brewpage.app/api/html/demo/aBcDeFgHiJ \
  -H "X-Owner-Token: tok_abc..."

# Platform stats
curl https://brewpage.app/api/stats
```

---

## JavaScript (Fetch)

```javascript
// Publish HTML
const res = await fetch('https://brewpage.app/api/html', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: '<h1>Hello</h1>', format: 'HTML' })
});
const { url, ownerToken } = await res.json();
// Save ownerToken!

// Read KV
const kv = await fetch('https://brewpage.app/api/kv/myapp/config/theme');
const { value } = await kv.json();

// Upload file
const form = new FormData();
form.append('namespace', 'uploads');
form.append('file', fileInput.files[0]);
await fetch('https://brewpage.app/api/files/uploads', { method: 'POST', body: form });
```

---

## Python

```python
import requests

# Publish
r = requests.post('https://brewpage.app/api/html', json={
    'content': '# Hello from Python', 'format': 'MARKDOWN'
})
data = r.json()
print(f"URL: {data['url']}")
print(f"Token: {data['ownerToken']}")  # Save this!

# KV write
requests.put('https://brewpage.app/api/kv/app/config/lang', json={'value': 'en'})

# KV read
r = requests.get('https://brewpage.app/api/kv/app/config/lang')
print(r.json()['value'])

# Upload file
with open('photo.jpg', 'rb') as f:
    requests.post('https://brewpage.app/api/files/uploads',
                  data={'namespace': 'imgs'}, files={'file': f})
```

---

## Go

```go
// Publish
body := `{"content":"<h1>Hello from Go</h1>","format":"HTML"}`
resp, _ := http.Post("https://brewpage.app/api/html",
    "application/json", strings.NewReader(body))
defer resp.Body.Close()
var result map[string]any
json.NewDecoder(resp.Body).Decode(&result)
fmt.Println("URL:", result["url"])
fmt.Println("Token:", result["ownerToken"]) // Save this!
```

---

## Ruby

```ruby
require 'net/http'
require 'json'

uri = URI('https://brewpage.app/api/html')
res = Net::HTTP.post(uri,
  { content: '<h1>Hello</h1>', format: 'HTML' }.to_json,
  'Content-Type' => 'application/json')
data = JSON.parse(res.body)
puts "URL: #{data['url']}"
puts "Token: #{data['ownerToken']}"  # Save this!
```

---

## PHP

```php
$ch = curl_init('https://brewpage.app/api/html');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
        'content' => '<h1>Hello from PHP</h1>',
        'format' => 'HTML'
    ])
]);
$result = json_decode(curl_exec($ch), true);
echo "URL: {$result['url']}\n";
echo "Token: {$result['ownerToken']}\n"; // Save this!
```

---

## Sites

### Upload site (individual files) — curl

```bash
curl -X POST "https://brewpage.app/api/sites" \
  -F "files=@index.html;type=text/html" \
  -F "files=@style.css;type=text/css" \
  -F "paths=index.html" \
  -F "paths=style.css"
```

### Upload site (ZIP archive) — curl

```bash
curl -X POST "https://brewpage.app/api/sites?ttl=7" \
  -F "archive=@mysite.zip;type=application/zip"
```

### Get site info — curl

```bash
curl https://brewpage.app/api/sites/public/aBcDeFgHiJ \
  -H "X-Owner-Token: your-owner-token"
```

### Delete site — curl

```bash
curl -X DELETE https://brewpage.app/api/sites/public/aBcDeFgHiJ \
  -H "X-Owner-Token: your-owner-token"
```

### Upload site — JavaScript

```javascript
const formData = new FormData();
const html = '<html><body><h1>Hello!</h1></body></html>';
formData.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
formData.append('paths', 'index.html');

const res = await fetch('https://brewpage.app/api/sites', {
  method: 'POST',
  body: formData,
});
const site = await res.json();
console.log(site.link, site.ownerToken);
```
