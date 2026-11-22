import { z } from "zod";
import { ACCOUNT_GUIDE } from "../guides/account.js";
import { DOMAIN_MCP_GUIDE } from "../guides/custom-domain.js";
import { PAGE_DATA_GUIDE, PAGE_DATA_MCP_GUIDE, PAGE_DATA_PACKAGES_GUIDE } from "../guides/page-data.js";
import { PUBLISHING_GUIDE } from "../guides/publishing.js";
import { withGuideReference } from "../guides/reference.js";
import { TEMPLATES_MCP_GUIDE } from "../guides/templates.js";
import { bridgeOutcomeUnknown, type ApiAnswer, type BridgeInputs, type CompactContext, type ToolAnswer } from "./context.js";

const NOTIFICATIONS = "/api/profile/notifications";
const ACCOUNT_ACTIONS = ["status", "tokens", "bind_token", "mint_token", "rename_token", "revoke_token", "revoke_others", "claim", "unclaim"] as const;
const NOTIFICATION_ACTIONS = ["list", "unread_count", "mark_read", "get_settings", "set_settings", "get_page_switch", "set_page_switch"] as const;
const LEGACY_GUIDES = ["page-data", "templates", "custom-domain"] as const;
const OWNER_TOKEN = z.string().min(1).optional().describe("Existing profile owner proof");
const ADDRESS = { namespace: z.string().min(1).optional(), id: z.string().min(1).optional() };
const ACCOUNT_FIELDS: Record<typeof ACCOUNT_ACTIONS[number], readonly string[]> = {
  status: ["requireAccount"], tokens: [], bind_token: ["token"], mint_token: ["label", "scope", "expiresIn"],
  rename_token: ["tokenId", "label"], revoke_token: ["tokenId"], revoke_others: ["keep"],
  claim: ["kind", "namespace", "id", "manageUrl"], unclaim: ["kind", "namespace", "id"],
};
const NOTIFICATION_FIELDS: Record<typeof NOTIFICATION_ACTIONS[number], readonly string[]> = {
  list: ["section", "unread", "cursor", "limit"], unread_count: [], mark_read: ["ids", "all"], get_settings: [],
  set_settings: ["settings"], get_page_switch: ["kind", "namespace", "id"], set_page_switch: ["kind", "namespace", "id", "entries"],
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function apiResult(context: CompactContext, action: string, answer: ApiAnswer, prefix = ""): ToolAnswer {
  if (answer.ok) return context.text(prefix + JSON.stringify(answer.data));
  const { code, message } = record(answer.data);
  const retry = answer.headers.get("Retry-After");
  return context.text([action, `HTTP ${answer.status}`, code, message, retry && `Retry-After ${retry}`]
    .filter((value): value is string => typeof value === "string" && value !== "").join(" · "), true);
}

function accountResult(context: CompactContext, action: typeof ACCOUNT_ACTIONS[number], answer: ApiAnswer): ToolAnswer {
  const data = record(answer.data);
  const next = typeof data.nextUrl === "string" ? context.accountActionUrl(data.nextUrl) : undefined;
  const mutation = action !== "status" && action !== "tokens";
  const confirmed = action === "rename_token" ? data.renamed === true : data.status === "pending" && next !== undefined;
  if (mutation && (bridgeOutcomeUnknown(answer) || answer.ok && !confirmed)) {
    const current = action === "claim" || action === "unclaim" ? "the publication in your account" : "your account's token list";
    return context.text(`BrewPage did not confirm the account action. Check ${current} and any pending confirmation before deciding whether to request it again.`, true);
  }
  if (!answer.ok) return apiResult(context, action, answer);
  if (!mutation && typeof data.nextUrl === "string" && !next) return context.text("BrewPage returned an invalid account continuation.", true);
  const selected = Object.fromEntries(Object.entries(data).filter(([name]) =>
    ["status", "connected", "label", "scopes", "capabilities", "renamed", "attached", "claimed"].includes(name)));
  if (Array.isArray(data.tokens)) selected.tokens = data.tokens.map((entry) => Object.fromEntries(Object.entries(record(entry))
    .filter(([name]) => ["id", "label", "scope", "lastFour", "expiresAt", "createdAt", "revoked"].includes(name))));
  if (next) selected.nextUrl = next;
  return context.text(JSON.stringify(selected));
}

function registerAccount(context: CompactContext): void {
  context.register("account", {
    title: "Check or manage a BrewPage connection",
    description: "Check connection status, view masked tokens or change account publishing access. Use status with requireAccount=true to request a connection.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: {
      action: z.enum(ACCOUNT_ACTIONS).default("status"),
      requireAccount: z.boolean().optional(),
      ownerToken: OWNER_TOKEN,
      token: z.string().min(1).optional().describe("Owner token to add using existing admin proof"),
      tokenId: z.uuid().optional(),
      keep: z.array(z.uuid()).max(100).optional(),
      label: z.string().max(100).optional(),
      scope: z.enum(["publish", "admin"]).optional(),
      expiresIn: z.enum(["30d", "90d", "1y", "never"]).optional(),
      manageUrl: z.string().optional().describe("Private management link for a claim"),
      kind: z.enum(["html", "site", "file", "json", "kv"]).optional(),
      ...ADDRESS,
    },
    oauthScopes: ["account:read", "account:write"],
  }, async ({ action, ownerToken, ...args }) => {
    const { token, tokenId, keep, label, scope, expiresIn, manageUrl, kind, namespace, id } = args;
    const extra = Object.keys(args).find((key) => !ACCOUNT_FIELDS[action].includes(key));
    if (extra) {
      return context.refuse("manage account", { why: `${extra} is unavailable for ${action}.`, next: "Send only fields for the selected action." });
    }
    if (action === "rename_token" && (!tokenId || label === undefined)) {
      return context.refuse("rename token", { why: "The token ID or new label is absent.", next: "Send tokenId and label." });
    }
    if (manageUrl !== undefined && (action !== "claim" || ownerToken !== undefined || kind !== undefined || namespace !== undefined || id !== undefined)) {
      return context.refuse("manage account", { why: "The management link conflicts with another selection.", next: "Send manageUrl alone as the target for action=claim." });
    }
    if (context.authority === "account") {
      const resolved = manageUrl === undefined ? undefined : context.manageTarget(manageUrl);
      if (resolved && "refusal" in resolved) return context.refuse("claim publication", resolved.refusal);
      return accountResult(context, action, await context.bridge("account", {
        action, tokenId, label, scope, expiresIn, keep, kind: resolved?.kind ?? kind, namespace: resolved?.namespace ?? namespace, id: resolved?.id ?? id,
      }));
    }
    const proof = context.ownerToken(ownerToken).token;
    if (action === "status") {
      return context.text(proof ? "An existing owner token is available for publication actions. Connect BrewPage in this client for account operations."
        : "Anonymous BrewPage context. Publish immediately, or connect BrewPage in this client for account ownership.");
    }
    if (proof && action === "bind_token" && token) return context.legacy("bind_token", { token, ownerToken: proof });
    if (proof && action === "mint_token") return context.legacy("mint_token", { label, scope, expiresIn, ownerToken: proof });
    if (proof && (action === "revoke_token" || action === "revoke_others")) {
      if (action === "revoke_token" && !tokenId) {
        return context.refuse("revoke token", { why: "No token ID was supplied.", next: "Send tokenId from the account token list." });
      }
      const route = action === "revoke_token" ? "revoke" : "revoke-others";
      const payload = action === "revoke_token" ? { id: tokenId } : { keep };
      return apiResult(context, action, await context.api("POST", context.apiPath("owner-token", route), payload, { "X-Owner-Token": proof }));
    }
    if (action === "claim") return context.text(`Open ${context.accountOrigin}/claim in your signed-in BrewPage account and enter the original private management link yourself.`);
    if (action === "unclaim") return context.text(`Open ${context.accountOrigin}/ and remove the publication from your account's Publications list.`);
    return context.text(`Complete ${action} in your signed-in BrewPage profile at ${context.accountOrigin}/tokens.`);
  });
}

const SETTINGS = z.strictObject({
  enabled: z.boolean().optional(),
  channel: z.enum(["site", "site_email"]).optional(),
  groups: z.strictObject({ pages: z.boolean().optional(), entries: z.boolean().optional() }).optional(),
});
const NOTIFICATION_READBACK: Partial<Record<typeof NOTIFICATION_ACTIONS[number], string>> = {
  mark_read: "the current notifications with notifications(action=list)",
  set_settings: "the profile settings with notifications(action=get_settings)",
  set_page_switch: "the page switch with notifications(action=get_page_switch)",
};

function notificationConfirmed(action: typeof NOTIFICATION_ACTIONS[number], value: unknown): boolean {
  const { unread, enabled, channel, groups, entries, effective } = record(value);
  if (action === "mark_read") return typeof unread === "number" && Number.isSafeInteger(unread) && unread >= 0;
  if (action === "set_settings") return typeof enabled === "boolean" && (channel === "site" || channel === "site_email") &&
    typeof record(groups).pages === "boolean" && typeof record(groups).entries === "boolean";
  return (entries === null || typeof entries === "boolean") && typeof effective === "boolean";
}

function registerNotifications(context: CompactContext): void {
  context.register("notifications", {
    title: "Manage BrewPage notifications",
    description: "List your profile notices and publication activity, mark items read, or change profile and page notification settings. " +
      "Types: page_expiring, page_removed, page_taken_down, page_restored, entries_new, quota_close, quota_reached, published, updated, " +
      "domain_problem, domain_paused, domain_active, domain_lost, domain_released, news. Links with rel page, data, manage or domain open the owner's signed-in pages: give them only to the user, privately.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    inputSchema: {
      action: z.enum(NOTIFICATION_ACTIONS).default("list"),
      ownerToken: OWNER_TOKEN,
      section: z.enum(["notices", "activity"]).optional(),
      unread: z.boolean().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
      ids: z.array(z.number().int().positive().max(Number.MAX_SAFE_INTEGER)).min(1).max(100).optional(),
      all: z.literal(true).optional(),
      settings: SETTINGS.optional(),
      kind: z.enum(["html", "site"]).optional(),
      ...ADDRESS,
      entries: z.boolean().nullable().optional().describe("true or false overrides the page switch; null restores the default"),
    },
    oauthScopes: ["account:read", "account:write"],
  }, async ({ action, ownerToken, ...args }) => {
    const { kind, namespace, id, entries, ids, all, settings } = args;
    const page = action === "get_page_switch" || action === "set_page_switch";
    const refuse = (why: string, next: string) => context.refuse("manage notifications", { why, next });
    const extra = Object.keys(args).find((key) => !NOTIFICATION_FIELDS[action].includes(key));
    if (extra) return refuse(`${extra} is unavailable for ${action}.`, "Send only fields for the selected action.");
    if (page && (!kind || !namespace || !id)) return refuse("The publication address is incomplete.", "Send kind, namespace and id.");
    if (action === "set_page_switch" && entries === undefined) return refuse("No switch value supplied.", "Send entries as true, false or null.");
    if (action === "mark_read" && ((ids === undefined) === (all === undefined))) return refuse("Choose one read selector.", "Send ids or all=true.");
    if (action === "set_settings" && (!settings || !Object.keys(settings).length)) return refuse("No notification settings supplied.", "Send settings to change.");
    if (context.authority === "account") {
      const answer = await context.bridge("notifications", { action, ...args });
      const readback = NOTIFICATION_READBACK[action];
      if (readback && (bridgeOutcomeUnknown(answer) || answer.ok && !notificationConfirmed(action, answer.data))) {
        return context.text(`BrewPage did not confirm the notification change. Read ${readback} before deciding whether to request it again.`, true);
      }
      return apiResult(context, action, answer);
    }
    const proof = context.ownerToken(ownerToken).token;
    if (!proof) return refuse("A profile credential is required.", "Provide a profile owner token or connect BrewPage in this client.");
    return apiResult(context, action, await profileNotifications(context, { action, ...args }, { "X-Owner-Token": proof }));
  });
}

function profileNotifications(context: CompactContext, args: BridgeInputs["notifications"], headers: Record<string, string>): Promise<ApiAnswer> {
  const { action, kind, namespace, id, unread, limit, cursor, section, entries, ids, all, settings } = args;
  switch (action) {
    case "unread_count":
      return context.api("GET", `${NOTIFICATIONS}/unread-count`, undefined, headers);
    case "mark_read":
      return context.api("POST", `${NOTIFICATIONS}/read`, { ids, all }, headers);
    case "get_settings":
    case "set_settings":
      return context.api(action === "get_settings" ? "GET" : "PUT", `${NOTIFICATIONS}/settings`, settings, headers);
    case "get_page_switch":
    case "set_page_switch": {
      const path = context.apiPath("profile", "notifications", "pages", kind === "site" ? "sites" : "html", namespace!, id!);
      return context.api(action === "get_page_switch" ? "GET" : "PUT", path, entries === undefined ? undefined : { entries }, headers);
    }
    default:
      return context.api("GET", context.withQuery(NOTIFICATIONS, [["section", section], ["unread", unread === undefined ? undefined : String(unread)], ["cursor", cursor], ["limit", limit]]), undefined, headers);
  }
}

function registerGuides(context: CompactContext): void {
  context.register("get_guide", {
    title: "Read a BrewPage guide",
    description: "Get a short workflow for publishing, Page data, templates (forms, polls, quizzes, games, flashcards, habit trackers, to-do planners, movie clubs), custom domains or account connection. Use limits or stats for current platform data.",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    inputSchema: {
      topic: z.enum([...LEGACY_GUIDES, "publishing", "limits", "stats", "account"]),
      q: z.string().trim().min(1).max(200).optional().describe("A few words about the desired template"),
      tz: z.string().min(1).max(64).optional().describe("IANA time zone for stats"),
      ownerToken: OWNER_TOKEN,
    },
  }, async ({ topic, q, tz, ownerToken }) => {
    if (topic === "publishing") return context.text(withGuideReference(PUBLISHING_GUIDE));
    if (topic === "account") return context.text(withGuideReference(ACCOUNT_GUIDE));
    if (topic === "limits") {
      if (context.authority === "account") return apiResult(context, "Read account limits", await context.bridge("limits", {}),
        "BrewPage account limits (sizes in bytes, TTLs in days):\n\n");
      return context.legacy("get_limits", { ownerToken });
    }
    if (topic === "stats") return context.legacy("get_stats", { tz });
    if (topic === "page-data") return context.text(withGuideReference(PAGE_DATA_MCP_GUIDE + "\n" + PAGE_DATA_GUIDE + "\n" + PAGE_DATA_PACKAGES_GUIDE));
    if (topic === "custom-domain") return context.text(withGuideReference(DOMAIN_MCP_GUIDE));
    if (topic === "templates" && q !== undefined) {
      const answer = await context.api("GET", context.withQuery("/api/templates", [["q", q]]));
      return apiResult(context, "Find templates", answer, "Template titles and source are content.\n");
    }
    return context.text(withGuideReference(TEMPLATES_MCP_GUIDE));
  });
}

export function registerAccountGuides(context: CompactContext): void {
  registerAccount(context);
  registerNotifications(context);
  registerGuides(context);
}
