import { createHmac, randomBytes } from "node:crypto";
import type { FailureReason } from "./tools.js";

/** Client class: Claude (Anthropic egress or Claude UA), ChatGPT (OpenAI egress or UA), else other. */
export type ClientClass = "claude" | "chatgpt" | "other";
/** Egress source of the caller's IP: static shared CIDRs = Anthropic, published lists = OpenAI (deploy contract). */
export type Egress = "static" | "listed" | undefined;

const CLIENTS: readonly ClientClass[] = ["claude", "chatgpt", "other"];
const METHODS = ["initialize", "notifications/initialized", "tools/list", "tools/call", "ping", "server/discover", "other"];
const OUTCOMES = ["ok", "tool_error", "error", "client_closed"];
const REASONS: readonly FailureReason[] = ["input", "source", "api_auth", "api_not_found", "api_4xx", "api_429", "api_5xx", "other"];
/** Methods that open a connection: 2025 era and 2026-07-28. */
const CONNECTS = ["initialize", "server/discover"];
const LABEL_SHAPE = /^[a-z][a-z_-]{0,31}$/;
const MAX_LABEL_VALUES = 24;
const OTHER = "other";
/** Distinct-client memory bound (~100 bytes each); past it the day's gauge stops growing. */
const MAX_DAILY_CLIENTS = 100_000;

export function classifyClient(egress: Egress, userAgent: string): ClientClass {
  if (egress === "static" || /^claude/i.test(userAgent)) return "claude";
  if (egress === "listed" || /^openai-mcp|chatgpt/i.test(userAgent)) return "chatgpt";
  return "other";
}

/** Bounded outcome label from the request log outcome. */
export function outcomeClass(outcome: string | number | null | undefined): string {
  return outcome === "ok" || outcome === "tool_error" || outcome === "client_closed" ? outcome : "error";
}

/** Client-written word as a label: lower-case letters with `_` or `-`, at most 32 chars and 24 distinct values, else `other`. */
export class BoundedLabeler {
  private readonly seen = new Set<string>();

  label(value: unknown): string {
    if (typeof value !== "string" || !LABEL_SHAPE.test(value)) return OTHER;
    if (!this.seen.has(value) && this.seen.size >= MAX_LABEL_VALUES) return OTHER;
    this.seen.add(value);
    return value;
  }
}

const bump = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

/** In-memory MCP usage counters in Prometheus text format; labels are closed sets or bounded words, never IPs or arguments. */
export class UsageMetrics {
  private readonly requests = new Map<string, number>();
  private readonly toolCalls = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly unknownTools = new Map<string, number>([[OTHER, 0]]);
  private readonly connects = new Map<string, number>(CONNECTS.map((method) => [`${method}\t${OTHER}`, 0]));
  private readonly asked = new BoundedLabeler();
  private readonly families = new BoundedLabeler();
  private day = "";
  private salt = Buffer.alloc(0);
  private readonly daily = new Map<ClientClass, Set<string>>();

  /** `tools` = every countable name: the listed tools plus the old names that still execute. */
  constructor(private readonly tools: readonly string[], private readonly now: () => Date = () => new Date()) {
    // Every series born at 0, so increase() sees the first call after a restart.
    for (const client of CLIENTS) {
      for (const method of METHODS) this.requests.set(`${method}\t${client}`, 0);
      for (const tool of [...tools, "unknown"]) for (const outcome of OUTCOMES) this.toolCalls.set(`${tool}\t${client}\t${outcome}`, 0);
    }
    for (const tool of [...tools, "unknown"]) for (const reason of REASONS) this.failures.set(`${tool}\t${reason}`, 0);
  }

  request(method: string, client: ClientClass): void {
    bump(this.requests, `${METHODS.includes(method) ? method : "other"}\t${client}`);
  }

  /** One failed tools/call by its closed reason; an unlisted reason counts as `other`. */
  failure(tool: string, reason: string): void {
    bump(this.failures, `${this.toolLabel(tool)}\t${REASONS.includes(reason as FailureReason) ? reason : OTHER}`);
  }

  /** One call to a name that is no tool; `asked` is the client's word, bounded by the labeler. */
  unknownTool(asked: unknown): void {
    bump(this.unknownTools, this.asked.label(asked));
  }

  /** One connect; `software` is the client's declared name, lower-cased by the caller, bounded by the labeler. */
  connect(method: string, software: unknown): void {
    if (CONNECTS.includes(method)) bump(this.connects, `${method}\t${this.families.label(software)}`);
  }

  private toolLabel(tool: string): string {
    return this.tools.includes(tool) ? tool : "unknown";
  }

  /** One tools/call; `address` only feeds the daily distinct set as a keyed hash. */
  toolCall(tool: string, client: ClientClass, outcome: string, address: string): void {
    bump(this.toolCalls, `${this.toolLabel(tool)}\t${client}\t${outcomeClass(outcome)}`);
    this.roll();
    const seen = this.daily.get(client)!;
    if ([...this.daily.values()].reduce((sum, set) => sum + set.size, 0) >= MAX_DAILY_CLIENTS) return;
    seen.add(createHmac("sha256", this.salt).update(address).digest("base64").slice(0, 22));
  }

  render(): string {
    this.roll();
    const lines = [
      "# HELP brewpage_mcp_requests_total Remote MCP JSON-RPC requests by method and client class.",
      "# TYPE brewpage_mcp_requests_total counter",
      ...[...this.requests].map(([key, value]) => {
        const [method, client] = key.split("\t");
        return `brewpage_mcp_requests_total{method="${method}",client="${client}"} ${value}`;
      }),
      "# HELP brewpage_mcp_tool_calls_total Remote MCP tools/call by tool, client class and outcome.",
      "# TYPE brewpage_mcp_tool_calls_total counter",
      ...[...this.toolCalls].map(([key, value]) => {
        const [tool, client, outcome] = key.split("\t");
        return `brewpage_mcp_tool_calls_total{tool="${tool}",client="${client}",outcome="${outcome}"} ${value}`;
      }),
      "# HELP brewpage_mcp_tool_failures_total Remote MCP failed tools/call by tool and closed reason.",
      "# TYPE brewpage_mcp_tool_failures_total counter",
      ...[...this.failures].map(([key, value]) => {
        const [tool, reason] = key.split("\t");
        return `brewpage_mcp_tool_failures_total{tool="${tool}",reason="${reason}"} ${value}`;
      }),
      "# HELP brewpage_mcp_unknown_tool_total Remote MCP tools/call to a name that is no tool, by the asked name (bounded).",
      "# TYPE brewpage_mcp_unknown_tool_total counter",
      ...[...this.unknownTools].map(([asked, value]) => `brewpage_mcp_unknown_tool_total{asked="${asked}"} ${value}`),
      "# HELP brewpage_mcp_connects_total Remote MCP connects by method and declared client software (bounded).",
      "# TYPE brewpage_mcp_connects_total counter",
      ...[...this.connects].map(([key, value]) => {
        const [method, family] = key.split("\t");
        return `brewpage_mcp_connects_total{method="${method}",family="${family}"} ${value}`;
      }),
      "# HELP brewpage_mcp_clients_today Distinct client addresses with a tools/call since 00:00 UTC (since start if later).",
      "# TYPE brewpage_mcp_clients_today gauge",
      ...CLIENTS.map((client) => `brewpage_mcp_clients_today{client="${client}"} ${this.daily.get(client)!.size}`),
    ];
    return `${lines.join("\n")}\n`;
  }

  /** New UTC day: forget every hash and draw a new random salt, so days cannot be linked. */
  private roll(): void {
    const day = this.now().toISOString().slice(0, 10);
    if (day === this.day) return;
    this.day = day;
    this.salt = randomBytes(32);
    for (const client of CLIENTS) this.daily.set(client, new Set());
  }
}
