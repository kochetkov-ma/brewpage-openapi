import { createHmac, randomBytes } from "node:crypto";

/** Client class: Claude (Anthropic egress or Claude UA), ChatGPT (OpenAI egress or UA), else other. */
export type ClientClass = "claude" | "chatgpt" | "other";
/** Egress source of the caller's IP: static shared CIDRs = Anthropic, published lists = OpenAI (deploy contract). */
export type Egress = "static" | "listed" | undefined;

const CLIENTS: readonly ClientClass[] = ["claude", "chatgpt", "other"];
const METHODS = ["initialize", "notifications/initialized", "tools/list", "tools/call", "ping", "server/discover", "other"];
const OUTCOMES = ["ok", "tool_error", "error", "client_closed"];
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

/** In-memory MCP usage counters in Prometheus text format; labels are closed sets, never IPs or arguments. */
export class UsageMetrics {
  private readonly requests = new Map<string, number>();
  private readonly toolCalls = new Map<string, number>();
  private day = "";
  private salt = Buffer.alloc(0);
  private readonly daily = new Map<ClientClass, Set<string>>();

  constructor(private readonly tools: readonly string[], private readonly now: () => Date = () => new Date()) {
    // Every series born at 0, so increase() sees the first call after a restart.
    for (const client of CLIENTS) {
      for (const method of METHODS) this.requests.set(`${method}\t${client}`, 0);
      for (const tool of [...tools, "unknown"]) for (const outcome of OUTCOMES) this.toolCalls.set(`${tool}\t${client}\t${outcome}`, 0);
    }
  }

  request(method: string, client: ClientClass): void {
    const key = `${METHODS.includes(method) ? method : "other"}\t${client}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
  }

  /** One tools/call; `address` only feeds the daily distinct set as a keyed hash. */
  toolCall(tool: string, client: ClientClass, outcome: string, address: string): void {
    const key = `${this.tools.includes(tool) ? tool : "unknown"}\t${client}\t${outcomeClass(outcome)}`;
    this.toolCalls.set(key, (this.toolCalls.get(key) ?? 0) + 1);
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
