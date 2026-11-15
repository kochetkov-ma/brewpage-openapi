import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Doc } from "brewpage-data";
import { useCollection, usePageData, useStats } from "brewpage-data/react";

interface Entry {
  name: string;
  text: string;
}

const LIST = "guestbook";

export function App() {
  const { ready, state } = usePageData();
  const book = useCollection(LIST);
  const stats = useStats(LIST);
  const [entries, setEntries] = useState<Doc<Entry>[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    if (!book) return;
    setEntries(await book.list<Entry>({ limit: 50 }));
  }, [book]);

  useEffect(() => {
    refresh().catch((e: Error) => setNote(e.message));
  }, [refresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!book) return;
    try {
      await book.add<Entry>({ name: name.trim(), text: text.trim() });
      setText("");
      setNote("");
      await refresh();
    } catch (e) {
      setNote((e as Error).message);
    }
  }

  if (!ready) return <p>Loading…</p>;
  if (!state) return <p>Saving is not available on this page.</p>;

  return (
    <main>
      <h1>Guestbook</h1>
      <p>{stats ? `${stats.count} entries` : "Counting…"}</p>
      <form onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" required maxLength={60} />
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Say hello" required maxLength={500} />
        <button type="submit">Sign</button>
      </form>
      {note && <p role="alert">{note}</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id}>
            <strong>{entry.value.name}</strong>: {entry.value.text}
          </li>
        ))}
      </ul>
    </main>
  );
}
