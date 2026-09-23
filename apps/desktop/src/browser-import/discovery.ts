import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { DesktopBrowserImportSourceProfile } from "@bb/host-daemon-contract";
import { openReadOnlyDatabase } from "./cookie-database.js";
import { listBrowserStorageNames } from "./browser-applications.js";
import {
  BROWSER_IMPORT_SOURCES,
  cookieDatabaseCandidatePaths,
  listSourceProfiles,
  linuxConfigDirectory,
  parseChromiumLocalStateProfiles,
  parseFirefoxProfiles,
  resolveCookieDatabase,
  type BrowserImportPathContext,
  type BrowserImportSourceDefinition,
} from "./sources.js";

const MAX_DIRECTORIES = 2_000;
const MAX_SOURCES = 100;
const MAX_PROFILES = 100;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const SKIP_DIRECTORIES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "Service Worker",
  "IndexedDB",
  "Local Storage",
  "Session Storage",
  "node_modules",
  ".git",
  ".cache",
]);

type StorageFormat = "chromium" | "firefox";

async function canonical(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

async function subdirectories(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter(
        (entry) => entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name),
      )
      .map((entry) => entry.name)
      .sort()
      .slice(0, MAX_DIRECTORIES);
  } catch {
    return [];
  }
}

async function metadata(path: string): Promise<string | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_METADATA_BYTES) return undefined;
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export function detectCookieStorage(path: string): StorageFormat | undefined {
  try {
    const database = openReadOnlyDatabase(path);
    try {
      const tables = database
        .prepare(
          "select name from sqlite_master where type = 'table' and name in ('cookies', 'meta', 'moz_cookies')",
        )
        .all();
      const has = (name: string) => tables.some((row) => row.name === name);
      if (has("cookies") && has("meta")) {
        const row = database
          .prepare("select value from meta where key = 'version'")
          .get();
        const version = Number(row?.value);
        if (!Number.isSafeInteger(version) || version < 1) return undefined;
        database
          .prepare(
            `select host_key, name, value, encrypted_value, path, expires_utc, is_secure,
            is_httponly, samesite${version >= 15 ? ", top_frame_site_key" : ""} from cookies limit 0`,
          )
          .all();
        return "chromium";
      }
      if (has("moz_cookies")) {
        const version = Number(
          database.prepare("pragma user_version").get()?.user_version,
        );
        database
          .prepare(
            `select host, name, value, path, expiry, isSecure, isHttpOnly, sameSite,
            originAttributes${version >= 10 && version <= 14 ? ", rawSameSite" : ""} from moz_cookies limit 0`,
          )
          .all();
        return "firefox";
      }
      return undefined;
    } finally {
      database.close();
    }
  } catch {
    return undefined;
  }
}

async function searchRoots(
  context: BrowserImportPathContext,
): Promise<Array<{ path: string; depth: number }>> {
  if (context.platform === "darwin")
    return [
      { path: join(context.home, "Library", "Application Support"), depth: 3 },
    ];
  if (context.platform !== "linux") return [];
  const roots = [{ path: linuxConfigDirectory(context), depth: 3 }];
  for (const name of await subdirectories(context.home)) {
    if (name.startsWith(".") && ![".config", ".local", ".var"].includes(name))
      roots.push({ path: join(context.home, name), depth: 3 });
  }
  for (const name of await subdirectories(join(context.home, ".var", "app")))
    roots.push({ path: join(context.home, ".var", "app", name), depth: 5 });
  for (const name of await subdirectories(join(context.home, "snap"))) {
    roots.push({ path: join(context.home, "snap", name, "common"), depth: 5 });
    roots.push({ path: join(context.home, "snap", name, "current"), depth: 5 });
  }
  return roots;
}

function storageName(root: string): string {
  const name =
    basename(root) === "User Data" ? basename(dirname(root)) : basename(root);
  return (
    name.replace(/^\./, "").replace(/[\u0000-\u001f\u007f]/g, "") || "Browser"
  );
}

function knownMetadata(
  root: string,
  engine: StorageFormat,
  context: BrowserImportPathContext,
): BrowserImportSourceDefinition | undefined {
  const base =
    context.platform === "darwin"
      ? join(context.home, "Library", "Application Support")
      : linuxConfigDirectory(context);
  return BROWSER_IMPORT_SOURCES.find((source) => {
    if (
      source.engine !== engine ||
      !source.platforms.includes(context.platform)
    )
      return false;
    const path = source.userDataDirectory(context);
    if (!path) return false;
    const suffix = contains(base, path)
      ? relative(base, path)
      : relative(context.home, path);
    return (
      suffix.length > 0 &&
      !suffix.startsWith("..") &&
      root.endsWith(`${sep}${suffix}`)
    );
  });
}

async function detectProfiles(
  root: string,
  format: StorageFormat,
  context: BrowserImportPathContext,
  claimed: Set<string>,
  excluded: readonly string[],
): Promise<DesktopBrowserImportSourceProfile[]> {
  const text = await metadata(
    join(root, format === "chromium" ? "Local State" : "profiles.ini"),
  );
  const declared =
    text === undefined
      ? []
      : format === "chromium"
        ? parseChromiumLocalStateProfiles(text)
        : parseFirefoxProfiles(text, root);
  const candidates = new Map(
    declared.map((profile) => [profile.directory, profile]),
  );
  candidates.set(".", { directory: ".", name: "Default" });
  for (const directory of await subdirectories(root)) {
    if (
      (text !== undefined ||
        (format === "chromium" && /^(Default|Profile \d+)$/.test(directory))) &&
      !candidates.has(directory)
    )
      candidates.set(directory, { directory, name: directory });
  }
  if (format === "firefox") {
    for (const name of await subdirectories(join(root, "Profiles"))) {
      const directory = join("Profiles", name);
      if (!candidates.has(directory))
        candidates.set(directory, { directory, name });
    }
  }
  const definition = {
    engine: format,
    userDataDirectory: () => root,
  };
  const found: DesktopBrowserImportSourceProfile[] = [];
  for (const profile of [...candidates.values()].slice(0, MAX_DIRECTORIES)) {
    if (profile.directory.length > 4096) continue;
    for (const path of cookieDatabaseCandidatePaths(
      definition,
      context,
      profile.directory,
    )) {
      try {
        if (!(await lstat(path)).isFile()) continue;
      } catch {
        continue;
      }
      const actual = await canonical(path);
      if (claimed.has(actual) || excluded.some((p) => contains(p, actual)))
        continue;
      if (detectCookieStorage(path) !== format) continue;
      claimed.add(actual);
      found.push({ ...profile, name: profile.name.slice(0, 256) });
      break;
    }
    if (found.length >= MAX_PROFILES) break;
  }
  return found;
}

export async function discoverBrowserImportSources(
  context: BrowserImportPathContext,
  listStorageNames = listBrowserStorageNames,
): Promise<BrowserImportSourceDefinition[]> {
  if (context.platform !== "darwin" && context.platform !== "linux") return [];
  const storageNames = await listStorageNames(context).catch(
    () => new Set<string>(),
  );
  const excluded = await Promise.all(
    (context.excludedDirectories ?? []).map(canonical),
  );
  const knownRoots = new Set<string>();
  const claimed = new Set<string>();
  for (const source of BROWSER_IMPORT_SOURCES) {
    if (!source.platforms.includes(context.platform)) continue;
    const root = source.userDataDirectory(context);
    if (root !== undefined) knownRoots.add(await canonical(root));
    for (const profile of await listSourceProfiles(source, context)) {
      const path = await resolveCookieDatabase(
        source,
        context,
        profile.directory,
      );
      if (path) claimed.add(await canonical(path));
    }
  }
  const queue = (await searchRoots(context)).slice(0, MAX_DIRECTORIES);
  const seen = new Set<string>();
  const sources: BrowserImportSourceDefinition[] = [];
  for (
    let index = 0;
    index < queue.length && index < MAX_DIRECTORIES;
    index += 1
  ) {
    const item = queue[index];
    if (!item) break;
    const root = await canonical(item.path);
    if (
      seen.has(root) ||
      knownRoots.has(root) ||
      excluded.some((p) => contains(p, root))
    )
      continue;
    seen.add(root);
    const directoryName = storageName(root);
    let detected = false;
    for (const engine of ["chromium", "firefox"] as const) {
      const known = knownMetadata(root, engine, context);
      if (!known && !storageNames.has(directoryName.toLowerCase())) continue;
      const profiles = await detectProfiles(
        root,
        engine,
        context,
        claimed,
        excluded,
      );
      if (profiles.length === 0) continue;
      detected = true;
      const name = known?.name ?? directoryName;
      sources.push({
        id: `storage-${createHash("sha256").update(`${engine}\0${root}`).digest("hex")}`,
        name: `${name.slice(0, 48)} (${engine === "chromium" ? "Chromium" : "Firefox"})`,
        engine,
        platforms: [context.platform],
        userDataDirectory: () => root,
        processNames: [],
        discoveredProfiles: profiles,
        ...(known?.macAppNames ? { macAppNames: known.macAppNames } : {}),
        ...(engine === "chromium"
          ? {
              keychainService: known?.keychainService ?? `${name} Safe Storage`,
              keychainAccount: known?.keychainAccount ?? name,
              linuxSecretApplication: known?.linuxSecretApplication ?? name,
            }
          : {}),
      });
      if (sources.length >= MAX_SOURCES) return sources;
    }
    if (detected || item.depth <= 0) continue;
    for (const name of await subdirectories(root)) {
      if (queue.length >= MAX_DIRECTORIES) break;
      queue.push({ path: join(root, name), depth: item.depth - 1 });
    }
  }
  return sources;
}
