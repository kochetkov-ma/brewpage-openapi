import { z } from "zod";
import { bridgeOutcomeUnknown, isClientAbort, type ApiAnswer, type BridgeInputs, type CompactContext, type OwnerProof, type PublicationKind, type Refusal, type Target } from "./context.js";
// Functions only: secret.js imports this module too, so no value of it may run at load time here.
import { secretItemAnswer, selectSecret } from "./secret.js";

const PUBLICATION_KINDS = ["html", "site", "file", "json", "kv"] as const;
const PAGE_KINDS = ["html", "site"] as const;
const SEGMENT = { html: "html", site: "sites", file: "files", json: "json", kv: "kv" };
const ACTIONS = {
  make_private: ["private"],
  make_public: ["public"],
  rotate_link: ["rotate"],
  reset_manage_link: ["manage-key"],
  revoke_reader_access: ["access", "revoke"],
} as const;
export const SETTINGS_OUTCOME_UNKNOWN = "BrewPage did not confirm the settings change. Read the current publication settings before deciding which changes to request again.";
/** Kinds a link name exists on; it also needs namespace public. */
export const LINK_NAME_KINDS: readonly PublicationKind[] = ["html", "site", "file"];
const ACCOUNT_TOKENS_PAGE = "https://account.brewpage.app/tokens";
export const LINK_NAME_FORWARDS = "Give the user the exact new link; the previous address forwards to it.";

/** Profile step of `link-name-needs-account` / 403 `LINK_NAME_NEEDS_ACCOUNT`; `then` = the call after it. */
export function linkNameNeedsProfile(fromEnv: boolean, then: string): string {
  return `give the user the owner token (it is theirs${fromEnv ? "; it is the BREWPAGE_OWNER_TOKEN value in this server's settings" : ""}) ` +
    `and ask them to sign in at ${ACCOUNT_TOKENS_PAGE} (free), press "Add existing token" and paste it; then ${then}. ` +
    "With an admin profile token, the account tool's bind_token action adds it instead.";
}

/** Next step after a refused link-name change; empty when the server message is enough. */
export function linkNameHint(code: unknown, retryAfter: unknown, proof: "ownerToken" | "manageKey" | "account", fromEnv = false): string[] {
  const seconds = Number(retryAfter);
  switch (code) {
    case "LINK_NAME_NEEDS_ACCOUNT": return proof === "manageKey"
      ? ["Link names need a free BrewPage profile: the user opens https://account.brewpage.app/claim while signed in and enters this management link, then repeat this change."]
      : [`Link names need a free BrewPage profile: ${linkNameNeedsProfile(fromEnv, "repeat this change")}`];
    case "LINK_NAME_PAUSED": return [`Do not retry link names${Number.isFinite(seconds) && seconds > 0
      ? ` before ${new Date(Date.now() + seconds * 1000).toISOString()}` : " now"}; never retry in a loop. Tell the user the message above.`];
    case "LINK_NAME_UNAVAILABLE": return ["That name cannot be used: ask the user for another name."];
    default: return [];
  }
}

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
  linkName: z.string().nullable().optional().describe("Readable name for the public link of a page, site or file: 6-20 of a-z, 0-9 and hyphens, " +
    "with a letter; null removes it. Needs a profile token, or an owner token added to a free BrewPage profile"),
  state: z.record(z.string(), z.unknown()).nullable().optional().describe("{} enables Page data, named rules merge, null disables and keeps entries"),
  tags: z.array(z.string()).optional().describe("Your private tags, replacing the set; [] clears. Up to 10, 1-32 characters, no commas, " +
    "saved lowercase. Needs a profile publication"),
};
const settingsSchema = {
  ...ownerAddress,
  id: ownerAddress.id.describe("ID from the publication receipt, or a secret's 10-character ref"),
  manageUrl: ownerAddress.manageUrl.describe("Private management link of a publication or secret; use in place of the address and owner token"),
  kind: z.enum([...PUBLICATION_KINDS, "secret"]).optional().describe("Publication kind, or secret: then only title, note and tags"),
  note: z.string().max(500).optional().describe("Secrets only. Your own note; \"\" clears it"),
  action: z.enum(["make_private", "make_public", "rotate_link", "reset_manage_link", "revoke_reader_access"]).optional()
    .describe("Use alone. make_private and make_public move it to a new address; make_private and rotate_link end the old address " +
      "and any link name for good; make_private detaches a custom domain"),
  ...ordinaryFields,
};
type Changes = Pick<Extract<BridgeInputs["publication_settings"], { namespace: string }>, keyof typeof ordinaryFields | "action">;
const SECRET_SETTINGS = ["title", "note", "tags"];
const ROUTES = {
  listed: ["visibility", "listed"],
  badgeHidden: ["badge", "hidden"],
  title: ["title", "title"],
  password: ["password", "password"],
  linkName: ["link-name", "linkName"],
} as const;
// Bridge apply order (app McpPublicationSettingsController.steps): a signed receipt lists `applied` in it.
const SETTINGS_ORDER = ["listed", "badgeHidden", "title", "tags", "password", "extend", "deliveryMode", "state", "linkName"] as const;
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
    case "linkName": return typeof data.link === "string" && Boolean(data.link) && "linkName" in data;
    case "tags": return Array.isArray(data.tags) && data.tags.every((tag) => typeof tag === "string");
    case "state": return typeof data.declared === "boolean";
    case "make_private":
    case "make_public":
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
  if (name === "tags") {
    return context.api("POST", context.apiPath("publications", target.kind, target.namespace, target.id, "tags"), { tags: changes.tags }, headers);
  }
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
    ? context.text([JSON.stringify(data), ...(fields.includes("linkName") ? [LINK_NAME_FORWARDS] : [])].join("\n"))
    : context.text(SETTINGS_OUTCOME_UNKNOWN, true);
  const failed = record(data.failed);
  const interrupted = Array.isArray(data.applied) && data.applied.length > 0 && failed.code === "invalid_token";
  return context.text([
    apiError(answer),
    ...progress.map((key) => `${key}: ${JSON.stringify(data[key])}`),
    ...(interrupted ? ["Reconnect BrewPage, read the current settings and request only the remaining changes."] : []),
    ...(failed.field === "linkName" ? linkNameHint(failed.code, failed.retryAfterSeconds ?? answer.headers.get("Retry-After"), "account") : []),
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
    const lead = action === "make_private" ? "Moved to a private address. The former public address and any link name are gone for good."
      : action === "make_public" ? "Moved to a public address with a random link. The former private address leads here for 30 days. linkName can name it next."
      : action === "rotate_link" ? "Link changed. The former address and any link name are gone for good." : action;
    const handoff = action === "reset_manage_link" ? "Give the user the new manageUrl privately." : "Give the user the new link and, privately, the manageUrl.";
    return context.text([lead, JSON.stringify(result), ...(result.manageUrl ? [handoff] : [])].join("\n"));
  } catch (error) {
    if (isClientAbort(error)) throw error;
    return uncertain();
  }
}

function registerSettings(context: CompactContext) {
  context.register("publication_settings", {
    title: "Change publication settings",
    description: "Change listing, badge, title, tags, password, storage, hosting, link name or Page data on an owned publication. " +
      "Use a disruptive action alone. Ask before make_private or make_public: the current address stops working " +
      "(after make_public it leads to the new one for 30 days). A secret ({\"kind\":\"secret\",\"id\":<ref>} or its manage link) takes title, note and tags only.",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: settingsSchema,
    oauthScopes: ["publications:write", "page-data:write"],
  }, async ({ kind, namespace, id, manageUrl, ownerToken, note, ...changes }) => {
    const secret = selectSecret(context, { kind, namespace, id, manageUrl, ownerToken });
    if (secret && "refusal" in secret) return context.refuse("change secret", secret.refusal);
    if (secret) {
      const { title, tags } = changes;
      const other = Object.entries(changes).find(([field, value]) => value !== undefined && !SECRET_SETTINGS.includes(field));
      if (other) return context.refuse("change secret", { why: `\`${other[0]}\` is unavailable for a secret.`, next: "Send title, note or tags with the secret target." });
      if (title === undefined && note === undefined && tags === undefined) {
        return context.refuse("change secret", { why: "No change was supplied.", next: 'Send title, note or tags, for example {"kind":"secret","id":"<ref>","note":""}.' });
      }
      if (title !== undefined && title.trim() === "") return context.refuse("change secret", { why: "A secret's title can't be cleared.", next: "Send a new one-line title." });
      const answer = context.authority === "account" && !secret.headers["X-Manage-Key"]
        ? await context.bridge("publication_settings", { kind: "secret", id: secret.ref, title, note, tags })
        : await context.api("PATCH", context.apiPath("secrets", "owner", secret.ref), { title, note, tags }, secret.headers);
      return secretItemAnswer(context, "change secret", answer);
    }
    if (note !== undefined || kind === "secret") return context.refuse("change publication settings", { why: "`note` is only for a secret.", next: "Use title or tags on a publication." });
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
    if (action === "make_public" && target.namespace === "public") {
      return refuse("make_public moves a private publication to a public address.", "Supply a private target, outside namespace public.");
    }
    if (changes.linkName !== undefined && (!LINK_NAME_KINDS.includes(target.kind) || target.namespace !== "public")) {
      return refuse("linkName is available on public pages, sites and files.", "Use a public html, site or file target, or make it public first with make_public.");
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
        if (!answer.ok) {
          const hint = step === "linkName" ? linkNameHint(record(answer.data).code, answer.headers.get("Retry-After"),
            "manageKey" in proof ? "manageKey" : "ownerToken", context.ownerToken(ownerToken).fromEnv) : [];
          return failed([apiError(answer), ...hint].join("\n"));
        }
        if (step === "linkName" && !settingConfirmed("linkName", answer.data)) {
          return failed("BrewPage did not confirm the link name. Read the current settings before retrying.");
        }
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
    return context.text([...applied, ...(steps.includes("linkName") ? [LINK_NAME_FORWARDS] : [])].join("\n"));
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
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
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
