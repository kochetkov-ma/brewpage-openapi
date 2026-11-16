# brewpage-data

Typed loader and framework wrappers for [BrewPage](https://brewpage.app) Page data: pages published on BrewPage can save what visitors enter (guestbooks, sign-ups, polls, votes, uploads) with no backend of their own.

The package ships types and thin wrappers only. The Page data script itself is served by BrewPage; the package loads it and never bundles a copy.

```bash
npm i brewpage-data@0.1.1
```

Entry points: `brewpage-data` (types and loader), `brewpage-data/react`, `brewpage-data/vue`, `brewpage-data/svelte`, `brewpage-data/angular`, `brewpage-data/elements`. React (18+), Vue (3.2+), Svelte (4+) and Angular (17+) are optional peer dependencies: install only the one you use.

Guide and full reference: [brewpage.app/page-data](https://brewpage.app/page-data).

## Setup

Put the script tag in your `index.html`, before your app:

```html
<script src="https://brewpage.app/js/state.js"></script>
```

Without the tag the package injects it on first use. Keep the tag anyway: the page's owner is recognised only when the script is in the page from the start.

Page data is turned on when the page is published (the `state` setting of the publish request). On `localhost` and from disk the same code runs against a local preview kept in the browser, so a dev server works with no setup.

## Plain TypeScript

```ts
import { openPageData } from "brewpage-data";

const { state, reason } = await openPageData();
if (!state) {
  console.log("Saving is off here:", reason);
} else {
  const book = state.col("guestbook");
  await book.add({ name: "Ada", text: "Hello!" });
  for (const entry of await book.list<{ name: string; text: string }>()) {
    console.log(entry.value.name, entry.value.text);
  }
}
```

`loadPageData()` resolves the SDK object itself (`window.brewpage`), or `null` outside a browser.

## React

```tsx
import { useCollection, usePageData, useRole, useStats } from "brewpage-data/react";

export function Guestbook() {
  const { ready, state, reason } = usePageData();
  const book = useCollection("guestbook");
  const stats = useStats("guestbook");
  const role = useRole();

  if (!ready) return <p>Loading…</p>;
  if (!state) return <p>Saving is off here ({reason}).</p>;
  return (
    <>
      <p>{stats?.count ?? 0} entries</p>
      <button onClick={() => book?.add({ text: "Hello!" })}>Sign</button>
      {role === "owner" && <p>You own this page.</p>}
    </>
  );
}
```

| Hook | Returns |
|---|---|
| `usePageData()` | `{ state, reason, ready }`; `ready` is false until the page's data has opened |
| `useCollection(name)` | the list, or `null` before ready or without Page data |
| `useStats(name, { countBy? })` | live totals, `null` until the first answer |
| `useRole()` | `"owner"` or `"visitor"` (`"visitor"` until ready) |

## Vue

The same four names; every value is a ref.

```vue
<script setup lang="ts">
import { useCollection, usePageData, useStats } from "brewpage-data/vue";

const { ready, state, reason } = usePageData();
const book = useCollection("guestbook");
const stats = useStats("poll", { countBy: "choice" });
</script>

<template>
  <p v-if="!ready">Loading…</p>
  <p v-else-if="!state">Saving is off here ({{ reason }}).</p>
  <template v-else>
    <p>{{ stats?.by?.yes ?? 0 }} said yes</p>
    <button @click="book?.add({ text: 'Hello!' })">Sign</button>
  </template>
</template>
```

## Svelte

Readable stores; they work the same in Svelte 4 and 5.

```svelte
<script lang="ts">
  import { pageData, role, stats } from "brewpage-data/svelte";

  const totals = stats("guestbook");
</script>

{#if !$pageData.ready}
  <p>Loading…</p>
{:else if !$pageData.state}
  <p>Saving is off here ({$pageData.reason}).</p>
{:else}
  <p>{$totals?.count ?? 0} entries</p>
  <button on:click={() => $pageData.state?.col("guestbook").add({ text: "Hello!" })}>Sign</button>
  {#if $role === "owner"}<p>You own this page.</p>{/if}
{/if}
```

| Store | Value |
|---|---|
| `pageData` | `{ state, reason, ready }`; `ready` is false until the page's data has opened |
| `stats(name, { countBy? })` | live totals, `null` until the first answer |
| `role` | `"owner"` or `"visitor"` (`"visitor"` until ready) |

## Angular

One function, every value a signal. Call `injectPageData()` in a field initializer or a constructor.

```ts
import { Component } from "@angular/core";
import { injectPageData } from "brewpage-data/angular";

@Component({
  selector: "app-guestbook",
  standalone: true,
  template: `
    @if (!data.ready()) {
      <p>Loading…</p>
    } @else if (!data.state()) {
      <p>Saving is off here ({{ data.reason() }}).</p>
    } @else {
      <p>{{ totals()?.count ?? 0 }} entries</p>
      <button (click)="sign()">Sign</button>
      @if (data.role() === "owner") {
        <p>You own this page.</p>
      }
    }
  `,
})
export class GuestbookComponent {
  readonly data = injectPageData();
  readonly totals = this.data.stats("guestbook");

  sign() {
    void this.data.state()?.col("guestbook").add({ text: "Hello!" });
  }
}
```

| Member | Value |
|---|---|
| `state`, `reason`, `ready` | signals; `ready()` is false until the page's data has opened |
| `role` | signal of `"owner"` or `"visitor"` (`"visitor"` until ready) |
| `stats(name, { countBy? })` | signal of live totals, `null` until the first answer; it stops with the component |

## Custom elements

For plain HTML and any framework that renders custom elements (Astro, Solid, Qwik). Importing the entry registers both elements.

```html
<script type="module">
  import "brewpage-data/elements";

  document.querySelector("bp-page-data").addEventListener("bp-state", (event) => {
    const { state, reason } = event.detail;
    if (!state) console.log("Saving is off here:", reason);
  });
</script>

<bp-page-data></bp-page-data>
<p><bp-count list="guestbook"></bp-count> entries</p>
<p><bp-count list="poll" count-by="choice" value="yes"></bp-count> said yes</p>
```

| Element | Behaviour |
|---|---|
| `<bp-page-data>` | reflects the attributes `data-role` (`owner` or `visitor`) and `reason`; fires `bp-state` with `detail = { state, reason }` |
| `<bp-count list count-by value>` | its text is the list's live count, or the count of one `value` when `count-by` and `value` are set |

## Files

A list that takes files exposes `files === true`; upload a `File` or `Blob` and keep the returned `url` in an entry.

```ts
const photos = state.col("photos");
if (photos.files) {
  const file = await photos.upload(input.files[0]);
  await photos.add({ photo: file.url });
}
```

## Errors

Every rejection is a `StateError` with a `code` (typed as `StateErrorCode`) and a `message` that is safe to show.

```ts
import type { StateError } from "brewpage-data";

try {
  await book.add({ text });
} catch (e) {
  showNote((e as StateError).message);
}
```

## Showing visitor input

Render what visitors saved as text, never as HTML: React, Vue, Svelte and Angular templates do this by default; in plain code use `window.brewpage.text(value)` or `textContent`.

## Example

[`examples/guestbook`](https://github.com/kochetkov-ma/brewpage-openapi/tree/main/packages/data/examples/guestbook): a React and Vite guestbook (add, list, live count).

```bash
npm ci && npm run build          # in packages/data
cd examples/guestbook
npm ci && npm run dev            # local preview on localhost
```

## License

MIT
