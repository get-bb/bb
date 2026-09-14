import { execFile } from "node:child_process";
import { readdir, readFile, readlink, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import type {
  DesktopBrowserImportSourceId,
  DesktopBrowserImportSourceProfile,
} from "@bb/host-daemon-contract";
import { countRows } from "./cookie-database.js";

export type BrowserImportEngine = "chromium" | "firefox" | "safari";

export interface BrowserImportPathContext {
  platform: NodeJS.Platform;
  home: string;
}

export interface BrowserImportSourceDefinition {
  id: DesktopBrowserImportSourceId;
  name: string;
  engine: BrowserImportEngine;
  platforms: readonly NodeJS.Platform[];
  userDataDirectory: (context: BrowserImportPathContext) => string | undefined;
  keychainService?: string;
  keychainAccount?: string;
  linuxSecretApplication?: string;
  macAppNames?: readonly string[];
  processNames: readonly string[];
}

function macApplicationSupport(
  context: BrowserImportPathContext,
  ...segments: string[]
): string {
  return join(context.home, "Library", "Application Support", ...segments);
}

function chromiumSource(input: {
  id: DesktopBrowserImportSourceId;
  name: string;
  keychainService: string;
  keychainAccount: string;
  macSegments: readonly string[];
  linuxSegments?: readonly string[];
  linuxSecretApplication?: string;
  macAppNames: readonly string[];
  processNames: readonly string[];
}): BrowserImportSourceDefinition {
  return {
    id: input.id,
    name: input.name,
    engine: "chromium",
    platforms: ["darwin", ...(input.linuxSegments ? ["linux" as const] : [])],
    keychainService: input.keychainService,
    keychainAccount: input.keychainAccount,
    macAppNames: input.macAppNames,
    processNames: input.processNames,
    ...(input.linuxSecretApplication === undefined
      ? {}
      : { linuxSecretApplication: input.linuxSecretApplication }),
    userDataDirectory: (context) => {
      if (context.platform === "darwin")
        return macApplicationSupport(context, ...input.macSegments);
      if (context.platform === "linux" && input.linuxSegments)
        return join(context.home, ".config", ...input.linuxSegments);
      return undefined;
    },
  };
}

export const BROWSER_IMPORT_SOURCES: readonly BrowserImportSourceDefinition[] =
  [
    chromiumSource({
      id: "chrome",
      processNames: ["Google Chrome", "chrome"],
      macAppNames: ["Google Chrome.app"],
      name: "Google Chrome",
      keychainService: "Chrome Safe Storage",
      keychainAccount: "Chrome",
      macSegments: ["Google", "Chrome"],
      linuxSegments: ["google-chrome"],
      linuxSecretApplication: "chrome",
    }),
    chromiumSource({
      id: "chromium",
      processNames: ["Chromium", "chromium"],
      macAppNames: ["Chromium.app"],
      name: "Chromium",
      keychainService: "Chromium Safe Storage",
      keychainAccount: "Chromium",
      macSegments: ["Chromium"],
      linuxSegments: ["chromium"],
      linuxSecretApplication: "chromium",
    }),
    chromiumSource({
      id: "edge",
      processNames: ["Microsoft Edge", "msedge"],
      macAppNames: ["Microsoft Edge.app"],
      name: "Microsoft Edge",
      keychainService: "Microsoft Edge Safe Storage",
      keychainAccount: "Microsoft Edge",
      macSegments: ["Microsoft Edge"],
      linuxSegments: ["microsoft-edge"],
      linuxSecretApplication: "msedge",
    }),
    chromiumSource({
      id: "brave",
      processNames: ["Brave", "brave"],
      macAppNames: ["Brave Browser.app"],
      name: "Brave",
      keychainService: "Brave Safe Storage",
      keychainAccount: "Brave",
      macSegments: ["BraveSoftware", "Brave-Browser"],
      linuxSegments: ["BraveSoftware", "Brave-Browser"],
      linuxSecretApplication: "brave",
    }),
    chromiumSource({
      id: "vivaldi",
      processNames: ["Vivaldi", "vivaldi"],
      macAppNames: ["Vivaldi.app"],
      name: "Vivaldi",
      keychainService: "Vivaldi Safe Storage",
      keychainAccount: "Vivaldi",
      macSegments: ["Vivaldi"],
      linuxSegments: ["vivaldi"],
      linuxSecretApplication: "vivaldi",
    }),
    chromiumSource({
      id: "opera",
      processNames: ["Opera", "opera"],
      macAppNames: ["Opera.app"],
      name: "Opera",
      keychainService: "Opera Safe Storage",
      keychainAccount: "Opera",
      macSegments: ["com.operasoftware.Opera"],
      linuxSegments: ["opera"],
      linuxSecretApplication: "opera",
    }),
    chromiumSource({
      id: "arc",
      processNames: ["Arc"],
      macAppNames: ["Arc.app"],
      name: "Arc",
      keychainService: "Arc Safe Storage",
      keychainAccount: "Arc",
      macSegments: ["Arc", "User Data"],
    }),
    {
      id: "firefox",
      name: "Firefox",
      engine: "firefox",
      platforms: ["darwin", "linux"],
      macAppNames: ["Firefox.app"],
      processNames: ["Firefox", "firefox"],
      userDataDirectory: (context) =>
        context.platform === "darwin"
          ? macApplicationSupport(context, "Firefox")
          : join(context.home, ".mozilla", "firefox"),
    },
    {
      id: "safari",
      name: "Safari",
      engine: "safari",
      platforms: ["darwin"],
      macAppNames: ["Safari.app"],
      processNames: ["Safari"],
      userDataDirectory: (context) =>
        context.platform === "darwin"
          ? join(
              context.home,
              "Library",
              "Containers",
              "com.apple.Safari",
              "Data",
              "Library",
              "Cookies",
            )
          : undefined,
    },
  ];

export function findBrowserImportSource(
  id: string,
): BrowserImportSourceDefinition | undefined {
  return BROWSER_IMPORT_SOURCES.find((candidate) => candidate.id === id);
}

export function resolveProfilePath(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profileDirectory: string,
): string | undefined {
  const root = definition.userDataDirectory(context);
  if (root === undefined) return undefined;
  return isAbsolute(profileDirectory)
    ? profileDirectory
    : join(root, profileDirectory);
}

export function cookieDatabaseCandidatePaths(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profileDirectory: string,
): string[] {
  const profilePath = resolveProfilePath(definition, context, profileDirectory);
  if (profilePath === undefined) return [];
  if (definition.engine === "firefox")
    return [join(profilePath, "cookies.sqlite")];
  if (definition.engine === "safari")
    return [join(profilePath, "Cookies.binarycookies")];
  return [
    join(profilePath, "Network", "Cookies"),
    join(profilePath, "Cookies"),
  ];
}

export async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function resolveCookieDatabase(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profileDirectory: string,
): Promise<string | undefined> {
  for (const candidate of cookieDatabaseCandidatePaths(
    definition,
    context,
    profileDirectory,
  )) {
    if (await isRegularFile(candidate)) return candidate;
  }
  return undefined;
}

export function parseFirefoxProfiles(
  ini: string,
  root: string,
): DesktopBrowserImportSourceProfile[] {
  const profiles: DesktopBrowserImportSourceProfile[] = [];
  let current: { name?: string; path?: string; isRelative?: string } | null =
    null;
  const flush = () => {
    if (current?.path) {
      const candidate = current.path;
      const isRelative =
        current.isRelative === undefined || current.isRelative === "1";
      const validIsRelative =
        current.isRelative === undefined || /^[01]$/.test(current.isRelative);
      if (validIsRelative && !candidate.includes("\u0000")) {
        let directory: string | undefined;
        if (isRelative) {
          if (!isAbsolute(candidate)) {
            const resolved = resolve(root, candidate);
            const rel = relative(root, resolved);
            const escapesRoot =
              rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
            if (!escapesRoot) directory = normalize(candidate);
          }
        } else if (isAbsolute(candidate)) {
          directory = normalize(candidate);
        }
        if (directory !== undefined)
          profiles.push({
            directory,
            name: current.name?.trim() || directory,
          });
      }
    }
    current = null;
  };
  for (const rawLine of ini.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[")) {
      flush();
      current = /^\[Profile\d+\]$/i.test(line) ? {} : null;
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "name") current.name = value;
    if (key === "path") current.path = value;
    if (key === "isrelative") current.isRelative = value;
  }
  flush();
  return profiles;
}

export function isSafeProfileDirectory(directory: string): boolean {
  return (
    directory.length > 0 &&
    directory !== "." &&
    directory !== ".." &&
    !/[\\/]/.test(directory) &&
    !directory.includes("\u0000")
  );
}

export function parseChromiumLocalStateProfiles(
  contents: string,
): DesktopBrowserImportSourceProfile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const profile = (parsed as { profile?: unknown }).profile;
  if (typeof profile !== "object" || profile === null) return [];
  const infoCache = (profile as { info_cache?: unknown }).info_cache;
  if (typeof infoCache !== "object" || infoCache === null) return [];
  const profiles: DesktopBrowserImportSourceProfile[] = [];
  for (const [directory, info] of Object.entries(
    infoCache as Record<string, unknown>,
  )) {
    if (!isSafeProfileDirectory(directory)) continue;
    const name =
      typeof info === "object" &&
      info !== null &&
      typeof (info as { name?: unknown }).name === "string"
        ? (info as { name: string }).name.trim()
        : "";
    profiles.push({ directory, name: name || directory });
  }
  return profiles;
}

async function countProfileCookies(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  directory: string,
): Promise<number | undefined> {
  const database = await resolveCookieDatabase(definition, context, directory);
  if (database === undefined || definition.engine === "safari")
    return undefined;
  return countRows(
    database,
    definition.engine === "firefox"
      ? "select count(*) as count from moz_cookies where originAttributes = ''"
      : "select count(*) as count from cookies",
  );
}

async function withCookieCounts(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  profiles: DesktopBrowserImportSourceProfile[],
): Promise<DesktopBrowserImportSourceProfile[]> {
  return Promise.all(
    profiles.map(async (profile) => {
      const cookieCount = await countProfileCookies(
        definition,
        context,
        profile.directory,
      );
      return cookieCount === undefined ? profile : { ...profile, cookieCount };
    }),
  );
}

async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function listDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

async function scanForProfiles(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  root: string,
  toDirectory: (entry: string) => string,
): Promise<DesktopBrowserImportSourceProfile[]> {
  const entries = await listDirectory(root);
  const found: DesktopBrowserImportSourceProfile[] = [];
  for (const entry of entries.filter(isSafeProfileDirectory)) {
    const directory = toDirectory(entry);
    const database = await resolveCookieDatabase(
      definition,
      context,
      directory,
    );
    if (database !== undefined) found.push({ directory, name: entry });
  }
  return found;
}

async function listSafariProfiles(
  root: string,
): Promise<DesktopBrowserImportSourceProfile[]> {
  const profiles: DesktopBrowserImportSourceProfile[] = [
    { directory: ".", name: "Safari" },
  ];
  const stores = join(root, "..", "WebKit", "WebsiteDataStore");
  const entries = await listDirectory(stores);
  for (const entry of entries
    .filter((entry) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        entry,
      ),
    )
    .sort()) {
    const directory = normalize(join(stores, entry, "Cookies"));
    if (await isRegularFile(join(directory, "Cookies.binarycookies")))
      profiles.push({ directory, name: `Profile ${entry.slice(0, 8)}` });
  }
  return profiles;
}

async function listSourceProfilesInDirectory(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  root: string,
): Promise<DesktopBrowserImportSourceProfile[]> {
  if (definition.engine === "safari") return listSafariProfiles(root);
  if (definition.engine === "firefox") {
    const ini = await readTextFile(join(root, "profiles.ini"));
    const declared = ini === undefined ? [] : parseFirefoxProfiles(ini, root);
    const scoped = { ...definition, userDataDirectory: () => root };
    const withDatabase: DesktopBrowserImportSourceProfile[] = [];
    for (const profile of declared) {
      const database = await resolveCookieDatabase(
        scoped,
        context,
        profile.directory,
      );
      if (database !== undefined) withDatabase.push(profile);
    }
    if (withDatabase.length > 0)
      return withCookieCounts(scoped, context, withDatabase);
    const fallbackDirectory =
      context.platform === "linux" ? root : join(root, "Profiles");
    return withCookieCounts(
      scoped,
      context,
      await scanForProfiles(scoped, context, fallbackDirectory, (entry) =>
        context.platform === "linux" ? entry : join("Profiles", entry),
      ),
    );
  }
  const localState = await readTextFile(join(root, "Local State"));
  const declared =
    localState === undefined ? [] : parseChromiumLocalStateProfiles(localState);
  if (declared.length > 0)
    return withCookieCounts(definition, context, declared);
  return withCookieCounts(
    definition,
    context,
    await scanForProfiles(definition, context, root, (entry) => entry),
  );
}

export async function listSourceProfiles(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Promise<DesktopBrowserImportSourceProfile[]> {
  const root = definition.userDataDirectory(context);
  if (root === undefined) return [];
  if (definition.engine !== "firefox" || context.platform !== "linux")
    return listSourceProfilesInDirectory(definition, context, root);
  const roots = [
    root,
    join(context.home, "snap", "firefox", "common", ".mozilla", "firefox"),
  ];
  const profiles = new Map<string, DesktopBrowserImportSourceProfile>();
  for (const directory of roots) {
    const found = await listSourceProfilesInDirectory(
      definition,
      context,
      directory,
    );
    for (const profile of found) {
      const absolute = resolve(directory, profile.directory);
      if (!profiles.has(absolute))
        profiles.set(
          absolute,
          directory === root ? profile : { ...profile, directory: absolute },
        );
    }
  }
  return [...profiles.values()];
}

export type ProcessProbe = (pid: number) => Promise<string | null>;

export const probeProcess: ProcessProbe = async (pid) => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    )
      return null;
  }
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "command=", "-p", String(pid)],
      { encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          resolve(stdout.trim().length > 0 ? stdout.trim() : "");
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
};

function normalizeHost(host: string): string {
  return host.toLowerCase().split(".")[0] ?? "";
}

function parseLockPid(pidText: string): number | undefined {
  if (!/^\d+$/.test(pidText)) return undefined;
  const pid = Number(pidText);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function matchesBrowser(
  command: string,
  processNames: readonly string[],
): boolean {
  const haystack = command.toLowerCase();
  return processNames.some((name) => haystack.includes(name.toLowerCase()));
}

export async function lockOwnerIsBrowser(
  pid: number,
  processNames: readonly string[],
  probe: ProcessProbe,
): Promise<boolean> {
  const command = await probe(pid);
  if (command === null) return false;
  if (command === "") return true;
  return matchesBrowser(command, processNames);
}

export async function chromiumSingletonLockIsHeld(
  target: string,
  currentHost: string,
  processNames: readonly string[],
  probe: ProcessProbe,
): Promise<boolean> {
  const separator = target.lastIndexOf("-");
  if (separator <= 0) return true;
  const host = target.slice(0, separator);
  const pid = parseLockPid(target.slice(separator + 1));
  if (pid === undefined) return true;
  const owner = await probe(pid);
  if (owner === null) return false;
  if (normalizeHost(host) !== normalizeHost(currentHost))
    return owner !== "" && matchesBrowser(owner, processNames);
  return owner === "" || matchesBrowser(owner, processNames);
}

export async function firefoxSymlinkLockIsHeld(
  target: string,
  processNames: readonly string[],
  probe: ProcessProbe,
): Promise<boolean> {
  const separator = target.lastIndexOf(":");
  if (separator < 0) return true;
  const pid = parseLockPid(target.slice(separator + 1).replace(/^\+/, ""));
  if (pid === undefined) return true;
  return lockOwnerIsBrowser(pid, processNames, probe);
}

async function readLinkTarget(path: string): Promise<string | undefined> {
  try {
    return await readlink(path);
  } catch {
    return undefined;
  }
}

export type OpenFileProbe = (path: string) => Promise<number[]>;

export const probeOpenFile: OpenFileProbe = (path) =>
  new Promise((resolve) => {
    execFile(
      "lsof",
      ["-t", "-w", "--", path],
      { encoding: "utf8" },
      (_error, stdout) => {
        resolve(
          stdout
            .split(/\s+/)
            .map((text) => Number(text))
            .filter((pid) => Number.isSafeInteger(pid) && pid > 0),
        );
      },
    );
  });

export async function firefoxParentLockIsHeld(
  lockPath: string,
  processNames: readonly string[],
  probe: ProcessProbe,
  openFiles: OpenFileProbe,
): Promise<boolean> {
  try {
    if (!(await stat(lockPath)).isFile()) return false;
  } catch {
    return false;
  }
  for (const pid of await openFiles(lockPath)) {
    if (await lockOwnerIsBrowser(pid, processNames, probe)) return true;
  }
  return false;
}

export async function isSourceRunning(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
  probe: ProcessProbe = probeProcess,
  openFiles: OpenFileProbe = probeOpenFile,
): Promise<boolean> {
  const root = definition.userDataDirectory(context);
  if (root === undefined) return false;
  if (definition.engine === "safari") return false;
  if (definition.engine === "chromium") {
    const target = await readLinkTarget(join(root, "SingletonLock"));
    if (target === undefined) return false;
    return chromiumSingletonLockIsHeld(
      target,
      hostname(),
      definition.processNames,
      probe,
    );
  }
  const profiles = await listSourceProfiles(definition, context);
  for (const profile of profiles) {
    const directory = resolveProfilePath(
      definition,
      context,
      profile.directory,
    );
    if (directory === undefined) continue;
    const target = await readLinkTarget(join(directory, "lock"));
    if (
      target !== undefined &&
      (await firefoxSymlinkLockIsHeld(target, definition.processNames, probe))
    )
      return true;
    if (
      await firefoxParentLockIsHeld(
        join(directory, ".parentlock"),
        definition.processNames,
        probe,
        openFiles,
      )
    )
      return true;
  }
  return false;
}

export async function isSourceInstalled(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Promise<boolean> {
  const profiles = await listSourceProfiles(definition, context);
  for (const profile of profiles) {
    if (
      (await resolveCookieDatabase(definition, context, profile.directory)) !==
      undefined
    )
      return true;
  }
  return false;
}

export async function resolveInstalledAppPath(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Promise<string | undefined> {
  if (context.platform !== "darwin") return undefined;
  for (const name of definition.macAppNames ?? []) {
    for (const root of [
      "/Applications",
      join(context.home, "Applications"),
      "/System/Applications",
      "/System/Cryptexes/App/System/Applications",
    ]) {
      const candidate = join(root, name);
      try {
        if ((await stat(candidate)).isDirectory()) return candidate;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}
