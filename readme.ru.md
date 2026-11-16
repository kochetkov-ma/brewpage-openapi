# BrewPage API: открытая публичная часть

[English](README.md)

Этот репозиторий — открытая часть [BrewPage](https://brewpage.app): контракт OpenAPI, документация и MCP-сервер `brewpage-mcp`. Сам сервис (бэкенд, фронтенд и инфраструктура) закрыт.

**Документация:** https://kochetkov-ma.github.io/brewpage-openapi/ | **Справочник API:** https://kochetkov-ma.github.io/brewpage-openapi/api-reference/

## Что такое BrewPage

[BrewPage](https://brewpage.app) — бесплатный хостинг HTML-страниц, Markdown-документов, многофайловых сайтов, AI-артефактов, JSON-документов, хранилищ ключ-значение и файлов. Регистрация и API-ключ не нужны. Используйте ссылку `link` из ответа без изменений: публикация может открываться по пути BrewPage или на собственном поддомене.

- **HTML и Markdown** — сырой HTML или Markdown, отрисованный в оформленную страницу, до 5 МиБ, с короткой ссылкой.
- **Сайты** — ZIP-архив или отдельные файлы (до 200 файлов, до 5 МиБ каждый, всего до 20 МиБ; актуальные значения: `GET /api/limits`).
- **Ключ-значение** — пары в хранилище по namespace и ID, до 1000 ключей, изменяются владельцем на месте.
- **JSON** — произвольные документы до 1 МиБ, до 10 000 документов в namespace.
- **Файлы** — изображения, PDF, видео, аудио, архивы, код; до 5 МиБ (видео до 20 МиБ), с предпросмотром.
- **Видимость** — без `?ns=` публикация приватная: не попадает в галерею и поиск, но открывается у любого, у кого есть ссылка. `ns=public` показывает страницы, сайты и файлы в галерее и карте сайта, их находят поисковые системы и AI-поиск. Секреты в открытые публикации не кладите. Публикации с паролем, JSON и ключ-значение не попадают в списки никогда.
- **Owner token** — каждый ответ на публикацию содержит `ownerToken`: им публикацию обновляют (ссылка не меняется), удаляют и перечисляют свои ресурсы. Аккаунт не нужен; по желанию можно бесплатно войти на https://account.brewpage.app, чтобы не терять страницы и токены. Ответ также содержит приватную ссылку управления `manageUrl`: ассистент отдаёт её пользователю вместе со ссылкой; публиковать её нельзя — кто её получил, может изменить или удалить страницу.
- **Срок хранения** — параметр `ttl` (в днях) при создании: до 30 дней без аккаунта, до 90 с бесплатным профилем. Без `ttl` действует срок по умолчанию; обновление не продлевает срок, ориентируйтесь на `expiresAt` из ответа.
- **Доступ** — чтение без пароля и создание не требуют аккаунта. Защищённое чтение — заголовок `X-Password`, изменение и удаление — `X-Owner-Token`. При `429` ждите `Retry-After`.

Базовый адрес API: `https://brewpage.app`.

## Быстрый старт

Опубликовать HTML-страницу и получить ссылку:

```bash
curl -X POST 'https://brewpage.app/api/html?ns=public&format=html' \
  -H "Content-Type: application/json" \
  -H "User-Agent: MyAgent/1.0" \
  -d '{"content": "<h1>Привет, мир!</h1>"}'
```

Опубликовать файл приватно:

```bash
curl -X POST 'https://brewpage.app/api/files' \
  -H "User-Agent: MyAgent/1.0" \
  -F "file=@report.pdf"
```

Опубликовать собранный сайт из ZIP:

```bash
curl -X POST 'https://brewpage.app/api/sites?ns=public' \
  -H "User-Agent: MyAgent/1.0" \
  -F "archive=@site.zip"
```

Откройте `link` из ответа в браузере — больше ничего делать не нужно.

## Для LLM и агентов

Агентам часто нужно поделиться результатом — отчётом, сгенерированным HTML, промежуточным JSON — по одной ссылке, которая не меняется при обновлении. BrewPage делает это одним `POST` без OAuth, бакетов и инфраструктуры. Краткая инструкция для моделей: https://brewpage.app/llms.txt, полная: https://brewpage.app/llms-full.txt.

## MCP-сервер

`brewpage-mcp` оборачивает API в 25 инструментов для любого MCP-клиента (Claude, Codex, Gemini, Cursor и другие). Полный список: [`mcp-server/README.md`](mcp-server/README.md).

Удалённый сервер без установки и авторизации: `https://brewpage.app/mcp` (Streamable HTTP). Claude Code:

```bash
claude mcp add --transport http brewpage --scope user https://brewpage.app/mcp
```

Локально через stdio (нужен Node.js):

```json
{
  "mcpServers": {
    "brewpage": {
      "command": "npx",
      "args": ["-y", "brewpage-mcp@2.1.0"]
    }
  }
}
```

## Ресурсы

| Ресурс | Адрес |
|--------|-------|
| Сервис | https://brewpage.app |
| Контекст для LLM | https://brewpage.app/llms.txt |
| Полный справочник для LLM | https://brewpage.app/llms-full.txt |
| Спецификация OpenAPI (YAML) | [`openapi/openapi.yaml`](openapi/openapi.yaml) |
| MCP-сервер | [`mcp-server/`](mcp-server/) |
| npm-пакет | https://www.npmjs.com/package/brewpage-mcp |
| Интерактивная документация | https://kochetkov-ma.github.io/brewpage-openapi/ |
| GitHub Action | https://github.com/kochetkov-ma/brewpage-action |
| Плагины и навык публикации | https://github.com/kochetkov-ma/brewpage-publish-plugins |
| Релизы | https://github.com/kochetkov-ma/brewpage-openapi/releases |

Зеркала репозитория: [GitFlic](https://gitflic.ru/project/brewcode/brewpage-openapi), [SourceCraft](https://sourcecraft.dev/kochetkov-ma/brewpage-openapi), [GitVerse](https://gitverse.ru/brewpage/brewpage-openapi).

## Лицензия

[Apache 2.0](LICENSE) распространяется на контракт и документацию в этом репозитории. MCP-сервер, который пакуется отдельно, распространяется под [MIT](mcp-server/LICENSE). Сервис BrewPage (бэкенд, фронтенд и инфраструктура) остаётся закрытым.
