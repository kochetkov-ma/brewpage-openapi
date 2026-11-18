import { z } from "zod";
import { bridgeOutcomeUnknown, isClientAbort, type ApiAnswer, type BridgeInputs, type CompactContext, type OwnerProof, type PublicationKind, type Refusal, type Target } from "./context.js";

const PUBLICATION_KINDS = ["html", "site", "file", "json", "kv"] as const;
const PAGE_KINDS = ["html", "site"] as const;
const SEGMENT = { html: "html", site: "sites", file: "files", json: "json", kv: "kv" };
const ACTIONS = {
  make_private: ["private"],
  rotate_link: ["rotate"],
  reset_manage_link: ["manage-key"],
  revoke_reader_access: ["access", "revoke"],
} as const;
export const SETTINGS_OUTCOME_UNKNOWN = "BrewPage did not confirm the settings change. Read the current publication settings before deciding which changes to request again.";

export const ownerAddress = {
  namespace: z.string().regex(/^[a-z0-9-]{1,32}$/).optional().describe("Namespace from the publication receipt"),
  id: z.string().regex(/^[A-Za-z0-9]{10}$/).optional().describe("ID from the publication receipt"),
  ownerToken: z.string().trim().min(1).optional().describe("Owner token for this publication"),
  manageUrl: z.string().min(1).optional().describe("Private management link; use in place of the address and owner token"),
};

interface OwnerAddress {
  kind?: PublicationKind;
  namespace?: string;
  id?: string;
  manageUrl?: string;
  ownerToken?: string;
}

export function resolveOwnerAddress(context: CompactContext, args: OwnerAddress, kinds: readonly PublicationKind[],
  requireKind: true): { target: Target; proof?: OwnerProof } | { refusal: Refusal };
export function resolveOwnerAddress(context: CompactContext, args: OwnerAddress, kinds: readonly PublicationKind[],
  requireKind?: false): { target: Omit<Target, "kind"> & { kind?: PublicationKind }; proof?: OwnerProof } | { refusal: Refusal };
export function resolveOwnerAddress(context: CompactContext, args: OwnerAddress, kinds: readonly PublicationKind[], requireKind = false) {
  const { kind, namespace, id, manageUrl, ownerToken } = args;
  if (manageUrl !== undefined) {
    if (ownerToken !== undefined) return { refusal: { why: "Both manageUrl and ownerToken were supplied.", next: "Send one owner proof." } };
    const parsed = context.manageTarget(manageUrl);
    if ("refusal" in parsed) return parsed;
    if (!ownerAddress.namespace.safeParse(parsed.namespace).success || !kinds.includes(parsed.kind) || (kind !== undefined && kind !== parsed.kind) ||
      (namespace !== undefined && namespace !== parsed.namespace) || (id !== undefined && id !== parsed.id)) {
      return { refusal: { why: "manageUrl does not match the publication target.", next: "Send the correct management link by itself." } };
    }
    const { key, ...target } = parsed;
    return { target, proof: { manageKey: key } };
  }
  if (!namespace || !id || (requireKind && !kind)) {
    return { refusal: { why: "The publication address is incomplete.", next: `Send ${requireKind ? "kind, " : ""}namespace and id from the receipt, or the private manageUrl.` } };
  }
  const target = { kind, namespace, id };
  if (ownerToken === undefined && context.authority === "account") return { target };
  const { token } = context.ownerToken(ownerToken);
  if (token) return { target, proof: { ownerToken: token } };
  return { refusal: { why: "An owner credential is required.", next: "Send the ownerToken or private manageUrl from the receipt, or connect the owning account." } };
}

export function ownerHeaders(proof: OwnerProof): Record<string, string> {
  return "manageKey" in proof ? { "X-Manage-Key": proof.manageKey } : { "X-Owner-Token": proof.ownerToken };
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function apiError(answer: ApiAnswer): string {
  const { code, message, reason } = record(answer.data);
  const retryAfter = answer.headers.get("Retry-After");
  return [`HTTP ${answer.status}`, code, message, reason, retryAfter ? `Retry-After: ${retryAfter}` : undefined]
    .filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
}

const ordinaryFields = {
  listed: z.boolean().optional().describe("List or unlist an eligible public publication"),
  badgeHidden: z.boolean().optional().describe("Hide or show the BrewPage badge"),
  title: z.string().max(200).optional().describe("One-line title; empty restores the content title"),
  password: z.string().nullable().optional().describe("Reader password; null removes it"),
  extend: z.literal(true).optional().describe("Set true to extend storage to the profile limit"),
  deliveryMode: z.enum(["path", "subdomain"]).optional(),
  expectedVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional().describe("Hosting version, with deliveryMode only"),
  state: z.record(z.string(), z.unknown()).nullable().optional().describe("{} enables Page data, named rules merge, null disables and keeps entries"),
};
const settingsSchema = {
  ...ownerAddress,
  kind: z.enum(PUBLICATION_KINDS).optional(),
  action: z.enum(["make_private", "rotate_link", "reset_manage_link", "revoke_reader_access"]).optional()
    .describe("Use alone. Making private is one-way, replaces the public address and detaches its custom domain"),
  ...ordinaryFields,
};
type Changes = Pick<BridgeInputs["publication_settings"], keyof typeof ordinaryFields | "action">;
const ROUTES = {
  listed: ["visibility", "listed"],
  badgeHidden: ["badge", "hidden"],
  title: ["title", "title"],
  password: ["password", "password"],
} as const;
const SETTINGS_ORDER = ["listed", "badgeHidden", "title", "password", "extend", "deliveryMode", "state"] as const;
type SettingName = typeof SETTINGS_ORDER[number];

function settingConfirmed(field: string, value: unknown): boolean {
  const data = record(value);
  switch (field) {
    case "listed": return typeof data.listed === "boolean" && typeof data.link === "string" && Boolean(data.link);
    case "badgeHidden": return typeof data.hidden === "boolean";
    case "title": return typeof data.title === "string" && typeof data.custom === "boolean";
    case "password": return typeof data.access === "string" && Boolean(data.access) && typeof data.listed === "boolean";
    case "extend": return typeof data.expiresAt === "string" && Boolean(data.expiresAt);
    case "deliveryMode": return typeof data.link === "string" && Boolean(data.link) && typeof data.deliveryModeMatched === "boolean";
    case "state": return typeof data.declared === "boolean";
    case "make_private":
    case "rotate_link":
      return typeof data.kind === "string" && typeof data.namespace === "string" && typeof data.id === "string" &&
        typeof data.link === "string" && Boolean(data.link) && typeof data.domainDetached === "boolean";
    case "revoke_reader_access": return data.revoked === true;
    default: return false;
  }
}

export function settingsConfirmed(value: unknown, fields: readonly string[]): boolean {
  const { applied } = record(value);
  return Array.isArray(applied) && fields.length === applied.length && fields.every((field, index) => {
    const row = record(applied[index]);
    return row.field === field && settingConfirmed(field, row.result);
  });
}

async function unsignedSetting(context: CompactContext, target: Target, proof: OwnerProof, changes: Changes, name: SettingName) {
  if (name === "state") {
    const kind = target.kind as "html" | "site";
    return context.bridge("merge_page_data", { ...target, kind, state: changes.state! }, { proof });
  }
  const prefix = [SEGMENT[target.kind], target.namespace, target.id];
  const headers = ownerHeaders(proof);
  if (name === "extend") return context.api("POST", context.apiPath(...prefix, "extend"), undefined, headers);
  if (name === "deliveryMode") {
    return context.api("PATCH", context.apiPath(...prefix, "hosting"),
      { deliveryMode: changes.deliveryMode, expectedVersion: changes.expectedVersion }, headers);
  }
  const [suffix, key] = ROUTES[name];
  return context.api("POST", context.apiPath(...prefix, suffix), { [key]: changes[name] }, headers);
}

function signedSettings(context: CompactContext, answer: ApiAnswer, fields: readonly string[]) {
  const data = record(answer.data);
  const progress = ["applied", "failed", "skipped"].filter((key) => data[key] !== undefined);
  if (bridgeOutcomeUnknown(answer)) {
    return context.text(SETTINGS_OUTCOME_UNKNOWN, true);
  }
  if (answer.ok && data.failed == null && fields[0] === "reset_manage_link") {
    const pending = record(data.pending);
    const next = typeof pending.nextUrl === "string" ? context.accountActionUrl(pending.nextUrl) : undefined;
    if (pending.status !== "pending" || !next) {
      return context.text("BrewPage returned an invalid management-link reset continuation. Check the existing publication before requesting another reset.", true);
    }
    return context.text(`Management-link reset is pending. Open ${next} in your BrewPage account to confirm it.`);
  }
  if (answer.ok && data.failed == null) return settingsConfirmed(data, fields)
    ? context.text(JSON.stringify(data)) : context.text(SETTINGS_OUTCOME_UNKNOWN, true);
  const interrupted = Array.isArray(data.applied) && data.applied.length > 0 && record(data.failed).code === "invalid_token";
  return context.text([
    apiError(answer),
    ...progress.map((key) => `${key}: ${JSON.stringify(data[key])}`),
    ...(interrupted ? ["Reconnect BrewPage, read the current settings and request only the remaining changes."] : []),
  ].join("\n"), true);
}

async function disruptiveSetting(context: CompactContext, target: Target, action: NonNullable<Changes["action"]>, proof?: OwnerProof) {
  const uncertain = () => context.text(`BrewPage did not confirm ${action} for ${target.kind} ${target.namespace}/${target.id}. Check the current publication or management link before deciding whether to request this action again.`, true);
  try {
    if (!proof) {
      const answer = await context.bridge("publication_settings", { ...target, action });
      if (bridgeOutcomeUnknown(answer) || record(record(answer.data).failed).code === "SETTING_OUTCOME_UNKNOWN") return uncertain();
      return signedSettings(context, answer, [action]);
    }
    const path = context.apiPath(SEGMENT[target.kind], target.namespace, target.id, ...ACTIONS[action]);
    const answer = await context.api("POST", path, undefined, ownerHeaders(proof));
    if (answer.status >= 500) return uncertain();
    if (!answer.ok) return context.text(`${action}: ${apiError(answer)}`, true);
    const result = record(answer.data);
    if (action === "reset_manage_link") {
      if (typeof result.manageUrl !== "string") return uncertain();
      const link = context.manageTarget(result.manageUrl);
      if ("refusal" in link || link.kind !== target.kind || link.namespace !== target.namespace || link.id !== target.id) return uncertain();
    }
    const lead = action === "make_private" ? "Moved to a private address. The former public address is gone."
      : action === "rotate_link" ? "Link changed. The former address is gone." : action;
    return context.text([lead, JSON.stringify(result), ...(result.manageUrl ? ["Keep the management link private."] : [])].join("\n"));
  } catch (error) {
    if (isClientAbort(error)) throw error;
    return uncertain();
  }
}

function registerSettings(context: CompactContext) {
  context.register("publication_settings", {
    title: "Change publication settings",
    description: "Change listing, badge, title, password, storage, hosting or Page data on an owned publication. " +
      "Use a disruptive action alone. Ask before making a publication private: its public address stops working.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: settingsSchema,
    oauthScopes: ["publications:write", "page-data:write"],
  }, async ({ kind, namespace, id, manageUrl, ownerToken, ...changes }) => {
    const operation = "change publication settings";
    const steps = SETTINGS_ORDER.filter((key) => changes[key] !== undefined);
    const { action, expectedVersion } = changes;
    const refuse = (why: string, next: string) => context.refuse(operation, { why, next });
    if (action && (steps.length || expectedVersion !== undefined)) {
      return refuse("A disruptive action was combined with another change.", 'Send only one action, for example {"action":"rotate_link"}, with the target and proof.');
    }
    if (expectedVersion !== undefined && changes.deliveryMode === undefined) {
      return refuse("expectedVersion requires deliveryMode.", 'Send both, for example {"deliveryMode":"subdomain","expectedVersion":2}.');
    }
    if (!action && !steps.length) return refuse("No change was supplied.", 'Send a change such as {"listed":false} with the target and proof.');
    const address = resolveOwnerAddress(context, { kind, namespace, id, manageUrl, ownerToken }, PUBLICATION_KINDS, true);
    if ("refusal" in address) return context.refuse(operation, address.refusal);
    const { target, proof } = address;
    const page = target.kind === "html" || target.kind === "site";
    if (!page && (changes.title !== undefined || changes.state !== undefined)) {
      return refuse("title and state are available on HTML pages and sites.", "Use an HTML or site target for those fields.");
    }
    if (!page && target.kind !== "file" && changes.password !== undefined) {
      return refuse("password is available on HTML pages, sites and files.", "Use an HTML, site or file target for a password change.");
    }
    if (action === "make_private" && target.namespace !== "public") {
      return refuse("make_private moves a public publication to a private address.", 'Supply a public target with namespace "public".');
    }
    if (action === "reset_manage_link" && proof && "manageKey" in proof) {
      return refuse("A management link cannot reset itself.", "Use the publication's owner token or the owning account.");
    }
    if (action) return disruptiveSetting(context, target, action, proof);
    if (!proof) return signedSettings(context, await context.bridge("publication_settings", { ...target, ...changes }), steps);
    const applied: string[] = [];
    for (const [index, step] of steps.entries()) {
      const failed = (message: string) => context.text([
        `Applied: ${applied.join(", ") || "none"}`, `Failed: ${step} · ${message}`,
        `Skipped: ${steps.slice(index + 1).join(", ") || "none"}`,
      ].join("\n"), true);
      try {
        const answer = await unsignedSetting(context, target, proof, changes, step);
        if (!answer.ok) return failed(apiError(answer));
        if (step === "state" && steps.length === 1) {
          const mergedState = record(answer.data);
          if (typeof mergedState.declared !== "boolean") return failed("No settings receipt was received. Read the current Page data settings before retrying.");
          return { ...context.text(`state: ${JSON.stringify(mergedState)}`), structuredContent: { mergedState } };
        }
        applied.push(`${step}: ${JSON.stringify(answer.data)}`);
      } catch {
        return failed("No result was received. Read the current settings before retrying this step.");
      }
    }
    return context.text(applied.join("\n"));
  });
}

const domainSchema = {
  action: z.enum(["list", "get", "add", "attach", "check", "detach", "remove"]).default("list"),
  kind: z.enum(PAGE_KINDS).optional(),
  namespace: ownerAddress.namespace,
  id: ownerAddress.id,
  hostname: z.string().min(1).max(254).regex(/^[^\s:/?#@\\]+$/u).optional()
    .describe("Bare hostname, e.g. schedule.example.org. Required to add, attach or detach"),
  ownerToken: ownerAddress.ownerToken,
  manageUrl: ownerAddress.manageUrl,
};

function registerDomains(context: CompactContext) {
  context.register("domains", {
    title: "Manage custom domains",
    description: "List, add, attach, check, detach or remove custom domains. Attach requires a hostname and an HTML page or site target. " +
      "Set the returned DNS records at the provider, then check once and read status with get. Detach keeps the hostname registered.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: domainSchema,
    hidden: ["manageUrl"],
    oauthScopes: ["domains:read", "domains:write"],
  }, async ({ action, kind, namespace, id, hostname, ownerToken, manageUrl }) => {
    if (manageUrl !== undefined) return context.refuse(`${action} custom domain`, {
      why: "A management link does not identify the profile that holds the hostname.",
      next: "Connect the owning account or supply an ownerToken held by its profile.",
    });
    const fields = [kind, namespace, id].filter((value) => value !== undefined).length;
    const invalidTarget = fields > 0 && fields !== 3;
    const target = kind && namespace && id ? { kind, namespace, id } : undefined;
    const refuse = (next: string) => context.refuse(`${action} custom domain`, { why: "The address does not match the action.", next });
    if (invalidTarget) return refuse('Supply all of kind, namespace and id, for example {"kind":"site","namespace":"public","id":"DEMO123458"}.');
    if (action === "list" && (target || hostname)) return refuse('Use {"action":"list"} for all domains or action "get" for a specific one.');
    if ((action === "add" || action === "detach") && (!hostname || target)) {
      return refuse(`Use {"action":"${action}","hostname":"schedule.example.org"}.`);
    }
    if (action === "attach" && (!hostname || !target)) {
      return refuse('Use {"action":"attach","hostname":"schedule.example.org","kind":"site","namespace":"public","id":"DEMO123458"}.');
    }
    if ((action === "get" || action === "check" || action === "remove") && Boolean(hostname) === Boolean(target)) {
      return refuse(`Use {"action":"${action}","hostname":"schedule.example.org"} or supply the full publication target alone.`);
    }

    const result = (answer: ApiAnswer) => {
      if (!answer.ok) {
        const next = answer.status === 429 && action === "check" ? "\nRead the status with domains(action=get) after Retry-After." : "";
        return context.text(`${action} custom domain: ${apiError(answer)}${next}`, true);
      }
      if (answer.status !== 204) return context.text(JSON.stringify(answer.data));
      return context.text(action === "detach"
        ? `Detached ${hostname}; it remains registered in the profile.`
        : `Removed the custom domain${hostname ? ` ${hostname}` : " on this publication"}. The BrewPage link stays available.`);
    };
    if (ownerToken === undefined && context.authority === "account") {
      const answer = await context.bridge("domains", { action, ...target, hostname });
      const data = record(answer.data);
      const attached = record(data.attachedTo);
      const confirmedItem = typeof data.hostname === "string" && Boolean(data.hostname) && typeof data.status === "string" &&
        Boolean(data.status) && Array.isArray(data.records) && typeof data.nextStep === "string" && Boolean(data.nextStep) &&
        (action !== "attach" || (attached.type === target?.kind && attached.namespace === target?.namespace && attached.id === target?.id));
      const confirmed = action === "add" || action === "attach" ? confirmedItem : answer.status === 204;
      if (["add", "attach", "detach", "remove"].includes(action) && (bridgeOutcomeUnknown(answer) || answer.ok && !confirmed)) {
        return context.text(`BrewPage did not confirm the domain change. Read the current domain status with domains(action=get) before deciding whether to request ${action} again.`, true);
      }
      return result(answer);
    }
    const { token } = context.ownerToken(ownerToken);
    if (!token) return context.refuse(`${action} custom domain`, {
      why: "A profile credential is required.",
      next: "Connect the owning account or send its ownerToken. Hostname-level actions require an admin profile token.",
    });
    const headers = ownerHeaders({ ownerToken: token });
    const path = target ? context.apiPath("publications", target.kind, target.namespace, target.id, "domain")
      : hostname ? context.apiPath("domains", hostname) : context.apiPath("domains");
    switch (action) {
      case "add": return result(await context.api("POST", context.apiPath("domains"), { hostname }, headers));
      case "attach": return result(await context.api("PUT", path, { hostname }, headers));
      case "check": return result(await context.api("POST", `${path}/check`, undefined, headers));
      case "detach": return result(await context.api("DELETE", `${path}/attachment`, undefined, headers));
      case "remove": return result(await context.api("DELETE", path, undefined, headers));
      default: return result(await context.api("GET", path, undefined, headers));
    }
  });
}

export function registerSettingsDomains(context: CompactContext): void {
  registerSettings(context);
  registerDomains(context);
}
