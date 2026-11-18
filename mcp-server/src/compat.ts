/** Reserved argument a rewritten old-name call carries: the old name, read and stripped at registration. */
export const RETIRED_ARGUMENT = "_retired";
export const TOOL_SELECTION_HEADER = "BrewPage-Tool-Selection";
export const HTML_ONLY_FAILURE = "This BrewPage connection permits HTML publishing only.";
export type ToolSelection = "legacy" | "publish_html";

type Arguments = Record<string, unknown>;

interface RetiredTool {
  /** Current tool that serves the call. */
  tool: string;
  /** Argument mapping as the note line words it. */
  mapping: string;
  /** Arguments the old tool took; any other key was dropped by its validator and is dropped here. */
  takes: readonly string[];
  /** Old arguments -> the current tool's, so that the API request stays the one the old tool sent. */
  adapt?: (args: Arguments) => Arguments;
}

const ADDRESS = ["type", "namespace", "id", "ownerToken"];
const SITE_CONTENT = ["entryContent", "files", "entry", "tags", "state", "ownerToken"];

/** `entryContent` as the one file of `files`, named by `entry`; both sent = neither, which the tool refuses. */
function siteFiles({ entryContent, ...rest }: Arguments): Arguments {
  if (typeof entryContent !== "string") return rest;
  const { files, ...others } = rest;
  if (Array.isArray(files) && files.length > 0) return others;
  const entry = typeof rest.entry === "string" && rest.entry ? rest.entry : "index.html";
  return { ...others, files: [{ path: entry, content: entryContent }] };
}

/** Tool names of 1.x that left the list in 2.0.0: never listed, still callable; removed in a later major, on usage data. */
export const RETIRED_TOOLS: ReadonlyMap<string, RetiredTool> = new Map<string, RetiredTool>([
  ["publish_site", { tool: "publish_html", mapping: "`entryContent` is now one file in `files`",
    takes: [...SITE_CONTENT, "namespace", "password", "ttlDays", "domain", "deliveryMode"], adapt: siteFiles }],
  // `ttlDays` was accepted and ignored by the API: accepted here, not sent.
  ["republish_site", { tool: "update_html", mapping: "`entryContent` is now one file in `files`",
    takes: [...SITE_CONTENT, "namespace", "id"], adapt: siteFiles }],
  ["get_json", { tool: "get_page", mapping: "with `type: json`",
    takes: ["namespace", "id", "password", "offset"], adapt: (args) => ({ ...args, type: "json" }) }],
  ["get_kv", { tool: "get_page", mapping: "with `type: kv`",
    takes: ["namespace", "id", "key", "password", "offset"], adapt: (args) => ({ ...args, type: "kv" }) }],
  ["set_visibility", { tool: "set_publication", mapping: "same arguments", takes: [...ADDRESS, "listed"] }],
  // Without a value the old tools answered the current state: `current` asks the same route for it.
  ["set_badge", { tool: "set_publication", mapping: "`hidden` is now `badgeHidden`", takes: [...ADDRESS, "hidden"],
    adapt: ({ hidden, ...rest }) => hidden === undefined ? { ...rest, current: "badge" } : { ...rest, badgeHidden: hidden } }],
  ["set_title", { tool: "set_publication", mapping: "same arguments", takes: [...ADDRESS, "title"],
    adapt: (args) => args.title === undefined ? { ...args, current: "title" } : args }],
  ["update_hosting", { tool: "set_publication", mapping: "same arguments", takes: [...ADDRESS, "deliveryMode", "expectedVersion"] }],
]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function permitsHtmlOnly(name: unknown, args: unknown): boolean {
  return name === "publish_html" && (!isObject(args) ||
    (!Object.hasOwn(args, "files") && (!Object.hasOwn(args, "kind") || args.kind === "html")));
}

/** A parsed `tools/call` of an old name as the call of its current tool, marked with the old name; any other message as it is. */
export function currentCall<Message>(message: Message): Message {
  if (!isObject(message) || message.method !== "tools/call" || !isObject(message.params)) return message;
  const { name, arguments: sent } = message.params;
  const retired = typeof name === "string" ? RETIRED_TOOLS.get(name) : undefined;
  if (!retired) return message;
  const taken = Object.fromEntries(Object.entries(isObject(sent) ? sent : {}).filter(([key]) => retired.takes.includes(key)));
  const args = { ...(retired.adapt?.(taken) ?? taken), [RETIRED_ARGUMENT]: name };
  return { ...message, params: { ...message.params, name: retired.tool, arguments: args } };
}

/** Last line of an answer to an old-name call; undefined when `old` is no old name of `tool`. */
export function retiredNote(old: unknown, tool: string): string | undefined {
  const retired = typeof old === "string" ? RETIRED_TOOLS.get(old) : undefined;
  return retired?.tool === tool ? `Note: ${old} is now ${tool} (${retired.mapping}); the old name still works.` : undefined;
}
