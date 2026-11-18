import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { z } from "zod";

export const CLIENT_ID = "brewpage-mcp-cli";
export const DEFAULT_SCOPE = "publications:write";
const SERVICE = "app.brewpage.mcp.oauth";
const KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{1,4096}$/;
const MAX_BYTES = 65_536;
const SAFE_ENV = { PATH: "/usr/bin:/bin" };
const selectionShape = z.strictObject({ version: z.literal(1), binding: z.uuid() });
const credentialShape = selectionShape.extend({
  resource: z.string(),
  issuer: z.string(),
  clientId: z.literal(CLIENT_ID),
  scope: z.string().min(1),
  accessToken: z.string().regex(KEY_PATTERN),
  refreshToken: z.string().regex(KEY_PATTERN),
  expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  blocked: z.literal(true).optional(),
});
export type Credential = z.infer<typeof credentialShape>;
export interface Deployment { resource: string; issuer: string }
export interface Selection { binding: string; source: "vault" | "file" }
export interface Vault { get(key: string): Promise<string | undefined>; set(key: string, encoded: string): Promise<void>; remove(key: string): Promise<void> }

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function localUser(): number {
  if (process.getuid === undefined) throw new Error("Protected OAuth credentials require a POSIX owner check.");
  return process.getuid();
}

async function directory(path: string, create = false): Promise<void> {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== localUser() || (info.mode & 0o022) !== 0) {
    throw new Error("The OAuth credential directory must be writable only by its owner.");
  }
}

async function protectedRead(path: string): Promise<string | undefined> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new Error("The selected OAuth file could not be opened safely.");
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== localUser() || (info.mode & 0o7777) !== 0o600 || info.size > MAX_BYTES) {
      throw new Error("The OAuth file must be an owner-only regular 0600 file.");
    }
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > MAX_BYTES) throw new Error("The OAuth file is too large.");
    return bytes.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

async function protectedWrite(path: string, data: string): Promise<void> {
  await directory(dirname(path));
  const scratch = join(dirname(path), `.brewpage-${randomUUID()}`);
  const file = await open(scratch, "wx", 0o600);
  try {
    await file.writeFile(data, "utf8");
    await file.sync();
    await file.close();
    await rename(scratch, path);
  } finally {
    await file.close().catch(() => undefined);
    await unlink(scratch).catch(() => undefined);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}

export function subprocess(command: string, args: string[], input?: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: SAFE_ENV, stdio: ["pipe", "pipe", "ignore"], signal: AbortSignal.timeout(10_000) });
    const output: Buffer[] = [];
    let length = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length <= MAX_BYTES) output.push(chunk);
      else child.kill();
    });
    child.stdin.on("error", () => undefined);
    child.once("error", () => reject(new Error("The local authorization helper is unavailable.")));
    child.once("close", (code) => resolve({ code, output: Buffer.concat(output).toString("utf8").trim() }));
    child.stdin.end(input);
  });
}

export function macKeychain(): Vault {
  function available(): void {
    if (process.platform !== "darwin") throw new Error("Browser login uses macOS Keychain. On POSIX headless hosts, select a protected credential file.");
  }
  return {
    async get(key) {
      available();
      const result = await subprocess("/usr/bin/security", ["find-generic-password", "-s", SERVICE, "-a", key, "-w"]);
      return result.code === 0 ? result.output : undefined;
    },
    async set(key, encoded) {
      available();
      const result = await subprocess("/usr/bin/security", ["-i"], `add-generic-password -U -s ${SERVICE} -a ${key} -w ${encoded}\n`);
      if (result.code !== 0 || await this.get(key) !== encoded) throw new Error("Could not save the grant in macOS Keychain.");
    },
    async remove(key) {
      available();
      await subprocess("/usr/bin/security", ["delete-generic-password", "-s", SERVICE, "-a", key]);
    },
  };
}

async function withKernelLock<T>(lock: string, work: () => Promise<T>): Promise<T> {
  const hold = ["/bin/sh", "-c", "printf ready; /bin/cat >/dev/null"];
  const [utility, args] = process.platform === "darwin"
    ? ["/usr/bin/lockf", ["-k", "-t", "20", lock, ...hold]]
    : ["/usr/bin/flock", ["-x", "-w", "20", lock, ...hold]];
  const child = spawn(utility, args, { env: SAFE_ENV, stdio: ["pipe", "pipe", "ignore"] });
  child.stdin.on("error", () => undefined);
  const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once("data", (bytes: Buffer) => {
        if (bytes.toString() === "ready") resolve();
        else reject(new Error("The local grant lock did not open."));
      });
      child.once("error", () => reject(new Error("The local grant lock is unavailable.")));
      child.once("exit", () => reject(new Error("The grant is in use by another process or the lock is unavailable.")));
    });
    return await work();
  } finally {
    child.stdin.end();
    await closed;
  }
}

function parse<T>(text: string, shape: z.ZodType<T>): T {
  try {
    return shape.parse(JSON.parse(text));
  } catch {
    throw new Error("The selected OAuth credentials are invalid.");
  }
}

export function verifiedCredential(value: unknown, deployment: Deployment, binding?: string): Credential {
  const result = credentialShape.safeParse(value);
  if (!result.success || result.data.resource !== deployment.resource || result.data.issuer !== deployment.issuer ||
      (binding !== undefined && binding !== result.data.binding)) {
    throw new Error("The selected grant belongs to another BrewPage connection.");
  }
  return result.data;
}

export class CredentialStore {
  private readonly realm: string;
  private readonly marker: string;

  constructor(readonly deployment: Deployment, readonly file?: string,
    private readonly root = join(homedir(), ".config", "brewpage-mcp"), private readonly vault = macKeychain()) {
    if (file !== undefined && !isAbsolute(file)) throw new Error("BREWPAGE_MCP_CREDENTIAL_FILE must be an absolute path.");
    if (!isAbsolute(root)) throw new Error("BREWPAGE_MCP_STATE_DIR must be an absolute path.");
    this.realm = createHash("sha256").update(JSON.stringify([deployment.issuer, deployment.resource, CLIENT_ID])).digest("hex");
    this.marker = join(root, `${this.realm}.json`);
  }

  private key(binding: string): string { return `${this.realm}.${binding}`; }

  private refreshMarker(selection: Selection): string {
    if (!this.file) return join(this.root, `${this.key(selection.binding)}.refresh`);
    const name = createHash("sha256").update(JSON.stringify([basename(this.file), this.key(selection.binding)])).digest("hex");
    return join(dirname(this.file), `.brewpage-${name}.refresh`);
  }

  async refreshPending(selection: Selection): Promise<boolean> {
    return await protectedRead(this.refreshMarker(selection)) !== undefined;
  }

  async beginRefresh(selection: Selection): Promise<void> {
    const marker = this.refreshMarker(selection);
    await directory(dirname(marker));
    const handle = await open(marker, "wx", 0o600);
    try {
      await handle.writeFile(selection.binding, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory(dirname(marker));
    if (await protectedRead(marker) !== selection.binding) throw new Error("Could not confirm the BrewPage refresh checkpoint.");
  }

  async finishRefresh(selection: Selection): Promise<void> {
    const marker = this.refreshMarker(selection);
    await unlink(marker);
    await syncDirectory(dirname(marker));
  }

  async selected(): Promise<Selection | undefined> {
    if (this.file) {
      const raw = await protectedRead(this.file);
      if (raw === undefined) throw new Error("The selected OAuth credential file is unavailable.");
      const value = verifiedCredential(parse(raw, credentialShape), this.deployment);
      return { source: "file", binding: value.binding };
    }
    const raw = await protectedRead(this.marker);
    return raw === undefined ? undefined : { source: "vault", binding: parse(raw, selectionShape).binding };
  }

  async read(selection: Selection): Promise<Credential> {
    const current = await this.selected();
    if (current?.source !== selection.source || current.binding !== selection.binding) throw new Error("The selected BrewPage grant changed. Restart the client.");
    const data = this.file ? await protectedRead(this.file) : await this.vault.get(this.key(selection.binding));
    if (data === undefined) throw new Error("The selected BrewPage grant is unavailable. Reconnect or sign out explicitly.");
    return verifiedCredential(parse(this.file ? data : Buffer.from(data, "base64url").toString("utf8"), credentialShape), this.deployment, selection.binding);
  }

  async lock<T>(work: () => Promise<T>): Promise<T> {
    await directory(this.root, true);
    return withKernelLock(join(this.root, `${this.realm}.lock`), work);
  }

  async save(selection: Selection, value: Credential): Promise<void> {
    const record = JSON.stringify(verifiedCredential(value, this.deployment, selection.binding));
    await this.read(selection);
    if (this.file) {
      await protectedWrite(this.file, record);
      await syncDirectory(dirname(this.file));
      if (await protectedRead(this.file) === record) return;
    } else {
      const key = this.key(selection.binding);
      const encoded = Buffer.from(record).toString("base64url");
      await this.vault.set(key, encoded);
      if (await this.vault.get(key) === encoded) return;
    }
    throw new Error("Could not confirm the selected BrewPage credential was saved.");
  }

  async select(value: Credential): Promise<void> {
    if (this.file) throw new Error("Remove the protected credential file setting before browser login.");
    const record = JSON.stringify(verifiedCredential(value, this.deployment));
    await this.vault.set(this.key(value.binding), Buffer.from(record).toString("base64url"));
    try {
      await protectedWrite(this.marker, JSON.stringify({ version: 1, binding: value.binding }));
    } catch (error) {
      await this.discard({ source: "vault", binding: value.binding });
      throw error;
    }
  }

  async discard(selection: Selection): Promise<void> {
    if (selection.source === "vault") await this.vault.remove(this.key(selection.binding)).catch(() => undefined);
  }

  async clear(): Promise<void> {
    if (this.file) return;
    await unlink(this.marker).catch((error: unknown) => { if (!isMissing(error)) throw error; });
  }
}
