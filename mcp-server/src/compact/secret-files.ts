import { SECRET_FILE_MODEL } from "./secret-file-types.js";

/** Compact model of the app's file-types.json (frontend/scripts/secret-files.mjs `model`). */
export interface SecretFileModel {
  maxFiles: number;
  minBytes: number;
  maxBytes: number;
  refusals: Record<string, { step: number; copy: string; hint?: string }>;
  denied: string[];
  bom: { utf8: string; le: string; be: string };
  controls: number[];
  notStart: string;
  rules: Record<string, { kind: "text"; startsWith?: string } | { kind: "der"; first: number; min: number; max: number }
    | { kind: "prefix"; hex: string } | { kind: "highBit" }>;
  groups: Array<{ id: string; label: string; extensions: string[]; names: string[]; namePrefixes: string[]; namePrefixParts: string[];
    content: string[] }>;
  neverAllowed: { categories: string[]; examples: string[] };
}
export interface SecretFileRefusal { step: number; code: string; copy: string; hint?: string }

const D = SECRET_FILE_MODEL;
const bytesOf = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const starts = (bytes: Uint8Array, prefix: Uint8Array) => bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);
const DENIED = D.denied.map(bytesOf);
const BOMS: Array<[Uint8Array, string]> = [[bytesOf(D.bom.utf8), "utf-8"], [bytesOf(D.bom.le), "utf-16le"], [bytesOf(D.bom.be), "utf-16be"]];
// Prefix + exactly one listed part (.env.local yes, .env.bat no), as the app's PREFIXED map.
const PREFIXED = new Map(D.groups.flatMap((group) => group.namePrefixes.flatMap((prefix) =>
  group.namePrefixParts.map((part) => [prefix + part, [group, prefix.replace(/\.+$/, "")]] as const))));

function refusal(code: string, step?: number): SecretFileRefusal {
  const known = D.refusals[code];
  const out: SecretFileRefusal = { step: step ?? known.step, code, copy: known.copy };
  if (known.hint !== undefined && out.step === 4) out.hint = known.hint;
  return out;
}

// Text rule: UTF-8 (BOM optional) or BOM-marked UTF-16, decoded fatally; no C0 but the allowed ones, no "#!" start.
function decodeText(bytes: Uint8Array): string | null {
  const [bom, encoding] = BOMS.find(([mark]) => starts(bytes, mark)) ?? [new Uint8Array(0), "utf-8"];
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes.subarray(bom.length));
  } catch {
    return null;
  }
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 0x20 && !D.controls.includes(text.charCodeAt(i))) return null;
  return text.startsWith(D.notStart) ? null : text;
}

function passes(rule: SecretFileModel["rules"][string], bytes: Uint8Array): boolean {
  switch (rule.kind) {
    case "text": {
      const text = decodeText(bytes);
      return text !== null && (rule.startsWith === undefined || text.startsWith(rule.startsWith));
    }
    case "der": return bytes.length >= 2 && bytes[0] === rule.first && bytes[1] >= rule.min && bytes[1] <= rule.max;
    case "prefix": return starts(bytes, bytesOf(rule.hex));
    default: return bytes.length > 0 && (bytes[0] & 0x80) !== 0;
  }
}

function match(name: string): [SecretFileModel["groups"][number], string] | null {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const extension = dot >= 0 && dot < lower.length - 1 ? lower.slice(dot) : null;
  const byExtension = extension === null ? undefined : D.groups.find((group) => group.extensions.includes(extension));
  if (byExtension) return [byExtension, extension!];
  const byName = D.groups.find((group) => group.names.includes(name));
  if (byName) return [byName, name];
  const prefixed = PREFIXED.get(lower);
  return prefixed ? [prefixed[0], prefixed[1]] : null;
}

/** Gate steps 2-5 of one file (the app's `check`); `textOnly` tries only text content rules (MCP input is text). */
export function checkSecretFile(name: string, bytes: Uint8Array, textOnly = false): SecretFileRefusal | null {
  if (bytes.length < D.minBytes) return refusal("SECRET_FILE_EMPTY");
  if (bytes.length > D.maxBytes) return refusal("SECRET_FILE_TOO_LARGE");
  if (DENIED.some((prefix) => starts(bytes, prefix))) return refusal("SECRET_FILE_TYPE", 3);
  const matched = match(name);
  if (!matched) return refusal("SECRET_FILE_TYPE");
  const rules = matched[0].content.map((id) => D.rules[id]).filter((rule) => !textOnly || rule.kind === "text");
  if (rules.some((rule) => passes(rule, bytes))) return null;
  const mismatch = refusal("SECRET_FILE_MISMATCH");
  return { ...mismatch, copy: mismatch.copy.split("{extension}").join(matched[1]) };
}

/** Allowed text-shaped names for tool hints: extensions, exact names and prefixed names of groups with a text rule. */
export const SECRET_TEXT_FILE_NAMES: readonly string[] = D.groups
  .filter((group) => group.content.some((id) => D.rules[id].kind === "text"))
  .flatMap((group) => [...group.extensions, ...group.names,
    ...group.namePrefixes.flatMap((prefix) => group.namePrefixParts.map((part) => prefix + part))]);
export const SECRET_FILE_MAX_BYTES = D.maxBytes;
