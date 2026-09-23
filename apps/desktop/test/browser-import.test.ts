import { createCipheriv, createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserImportService,
  writeCookies,
} from "../src/browser-import/browser-import.js";
import {
  decryptChromiumValue,
  readChromiumCookies,
} from "../src/browser-import/chromium-cookies.js";
import {
  deriveChromiumKey,
  resolveChromiumKeys,
  type SecretCommandResult,
} from "../src/browser-import/chromium-keys.js";
import {
  BrowserImportError,
  cookieScope,
} from "../src/browser-import/cookie-database.js";
import { readFirefoxCookies } from "../src/browser-import/firefox-cookies.js";
import { discoverBrowserImportSources } from "../src/browser-import/discovery.js";
import {
  iconFileFromInfoPlist,
  readMacAppIcon,
} from "../src/browser-import/mac-app-icon.js";
import { parseBinaryCookies } from "../src/browser-import/safari-cookies.js";
import {
  chromiumSingletonLockIsHeld,
  findBrowserImportSource,
  firefoxParentLockIsHeld,
  isSourceRunning,
  listSourceProfiles,
  parseChromiumLocalStateProfiles,
  parseFirefoxProfiles,
} from "../src/browser-import/sources.js";

const fixtureBrowserStorageNames = async () =>
  new Set(["unlisted", "direct", "broken", "lookalike"]);

const AES_CBC_IV = Buffer.alloc(16, 0x20);
const WEBKIT_EPOCH_OFFSET_SECONDS = 11_644_473_600;

function encryptChromium(
  prefix: "v10" | "v11",
  key: Buffer,
  plaintext: string,
  hostKey?: string,
): Buffer {
  const cipher = createCipheriv("aes-128-cbc", key, AES_CBC_IV);
  const bound =
    hostKey === undefined
      ? Buffer.from(plaintext)
      : Buffer.concat([
          createHash("sha256").update(hostKey).digest(),
          Buffer.from(plaintext),
        ]);
  return Buffer.concat([
    Buffer.from(prefix, "latin1"),
    cipher.update(bound),
    cipher.final(),
  ]);
}

function createChromiumCookieDatabase(
  path: string,
  schemaVersion: number,
  rows: Array<{
    host: string;
    name: string;
    value?: string;
    encrypted?: Buffer;
    path?: string;
    expiresSeconds?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: number;
    topFrameSiteKey?: string;
  }>,
): void {
  const database = new DatabaseSync(path);
  database.exec(`
    create table meta (key text primary key, value text);
    create table cookies (
      host_key text, name text, value text, encrypted_value blob, path text,
      expires_utc integer, is_secure integer, is_httponly integer,
      samesite integer, top_frame_site_key text
    );
  `);
  database
    .prepare("insert into meta (key, value) values ('version', ?)")
    .run(String(schemaVersion));
  const insert = database.prepare(
    "insert into cookies values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(
      row.host,
      row.name,
      row.value ?? "",
      row.encrypted ?? Buffer.alloc(0),
      row.path ?? "/",
      row.expiresSeconds === undefined
        ? 0
        : (row.expiresSeconds + WEBKIT_EPOCH_OFFSET_SECONDS) * 1_000_000,
      row.secure ? 1 : 0,
      row.httpOnly ? 1 : 0,
      row.sameSite ?? -1,
      row.topFrameSiteKey ?? "",
    );
  }
  database.close();
}

function createFirefoxCookieDatabase(
  path: string,
  userVersion: number,
  rows: Array<{
    host: string;
    name: string;
    value: string;
    expiry: number;
    originAttributes?: string;
    sameSite?: number | null;
    rawSameSite?: number | null;
    secure?: boolean;
  }>,
): void {
  const database = new DatabaseSync(path);
  database.exec(`
    create table moz_cookies (
      host text, name text, value text, path text, expiry integer,
      isSecure integer, isHttpOnly integer, sameSite integer,
      rawSameSite integer, originAttributes text
    );
  `);
  database.exec(`pragma user_version = ${userVersion}`);
  const insert = database.prepare(
    "insert into moz_cookies values (?, ?, ?, '/', ?, ?, 0, ?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(
      row.host,
      row.name,
      row.value,
      row.expiry,
      row.secure ? 1 : 0,
      row.sameSite === undefined ? 1 : row.sameSite,
      row.rawSameSite === undefined ? null : row.rawSameSite,
      row.originAttributes ?? "",
    );
  }
  database.close();
}

function buildBinaryCookies(
  cookies: Array<{
    domain: string;
    name: string;
    path: string;
    value: string;
    flags?: number;
    expiry?: number;
  }>,
): Buffer {
  const records = cookies.map((cookie) => {
    const strings = [cookie.domain, cookie.name, cookie.path, cookie.value];
    const header = Buffer.alloc(56);
    let offset = 56;
    const offsets = strings.map((text) => {
      const current = offset;
      offset += Buffer.byteLength(text) + 1;
      return current;
    });
    header.writeUInt32LE(offset, 0);
    header.writeUInt32LE(cookie.flags ?? 0, 8);
    header.writeUInt32LE(offsets[0], 16);
    header.writeUInt32LE(offsets[1], 20);
    header.writeUInt32LE(offsets[2], 24);
    header.writeUInt32LE(offsets[3], 28);
    header.writeDoubleLE(cookie.expiry ?? 0, 40);
    return Buffer.concat([
      header,
      ...strings.map((text) => Buffer.from(`${text}\0`)),
    ]);
  });
  const pageHeader = Buffer.alloc(12 + records.length * 4);
  pageHeader.writeUInt32BE(0x00000100, 0);
  pageHeader.writeUInt32LE(records.length, 4);
  let cursor = pageHeader.length;
  records.forEach((record, index) => {
    pageHeader.writeUInt32LE(cursor, 8 + index * 4);
    cursor += record.length;
  });
  const page = Buffer.concat([pageHeader, ...records]);
  const fileHeader = Buffer.alloc(12);
  fileHeader.write("cook", 0, "latin1");
  fileHeader.writeUInt32BE(1, 4);
  fileHeader.writeUInt32BE(page.length, 8);
  return Buffer.concat([fileHeader, page, Buffer.alloc(8)]);
}

function fakeSecretRunner(
  results: Record<string, Partial<SecretCommandResult>>,
) {
  return vi.fn(async (file: string) => {
    const result = results[file];
    if (!result)
      return {
        stdout: "",
        stderr: "",
        exitCode: null,
        spawnError: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      };
    return { stdout: "", stderr: "", exitCode: 0, ...result };
  });
}

describe("cookieScope", () => {
  it("keeps host-only cookies without a domain and bracketizes IPv6", () => {
    expect(cookieScope("example.com", "/a", true)).toEqual({
      url: "https://example.com/a",
      domain: undefined,
    });
    expect(cookieScope(".example.com", "/", false)).toEqual({
      url: "http://example.com/",
      domain: ".example.com",
    });
    expect(cookieScope("::1", "/", false).url).toBe("http://[::1]/");
  });
});

describe("Chromium decryption", () => {
  const key = deriveChromiumKey("peanuts", 1);
  it("does not treat unknown versioned encryption as plaintext", () => {
    expect(
      decryptChromiumValue(
        Buffer.from("v20opaque ciphertext"),
        { cbcV10: key },
        ".example.com",
      ),
    ).toBeNull();
  });
  it("decrypts v10 and strips the domain hash from schema 24 records", () => {
    const encrypted = encryptChromium("v10", key, "session", ".example.com");
    expect(
      decryptChromiumValue(encrypted, { cbcV10: key }, ".example.com", 24),
    ).toBe("session");
    expect(
      decryptChromiumValue(encrypted, { cbcV10: key }, ".other.com", 24),
    ).toBeNull();
  });
  it("returns null for v11 without a keyring key and treats unknown prefixes as plaintext", () => {
    const encrypted = encryptChromium("v11", key, "value");
    expect(
      decryptChromiumValue(encrypted, { cbcV10: key }, "a", 23),
    ).toBeNull();
    expect(
      decryptChromiumValue(Buffer.from("legacy"), { cbcV10: key }, "a", 23),
    ).toBe("legacy");
  });
});

describe("resolveChromiumKeys", () => {
  it("derives the macOS key from the Keychain and maps a missing item", async () => {
    const run = fakeSecretRunner({
      "/usr/bin/security": { stdout: "secret\n", exitCode: 0 },
    });
    const keys = await resolveChromiumKeys(
      {
        platform: "darwin",
        keychainService: "Chrome Safe Storage",
        keychainAccount: "Chrome",
        linuxSecretApplication: undefined,
      },
      run,
    );
    expect(keys.cbcV10).toEqual(deriveChromiumKey("secret", 1003));
    await expect(
      resolveChromiumKeys(
        {
          platform: "darwin",
          keychainService: "Chrome Safe Storage",
          keychainAccount: "Chrome",
          linuxSecretApplication: undefined,
        },
        fakeSecretRunner({
          "/usr/bin/security": {
            exitCode: 44,
            stderr: "The specified item could not be found in the keychain.",
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: "keychainItemMissing" });
  });
  it("keeps the Linux fallback key when secret-tool is missing but fails on denial", async () => {
    const keys = await resolveChromiumKeys(
      {
        platform: "linux",
        keychainService: undefined,
        keychainAccount: undefined,
        linuxSecretApplication: "chrome",
      },
      fakeSecretRunner({}),
    );
    expect(keys.cbcV10).toEqual(deriveChromiumKey("peanuts", 1));
    expect(keys.cbcV11).toBeUndefined();
    expect(keys.cbcV11Error?.reason).toBe("keychainUnavailable");
    await expect(
      resolveChromiumKeys(
        {
          platform: "linux",
          keychainService: undefined,
          keychainAccount: undefined,
          linuxSecretApplication: "chrome",
        },
        fakeSecretRunner({
          "secret-tool": { exitCode: 1, stderr: "The prompt was dismissed" },
        }),
      ),
    ).rejects.toMatchObject({ reason: "needsKeychainApproval" });
  });
});

describe("browser cookie readers", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "bb-browser-import-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("discovers a registered browser while excluding Electron and mail cookie stores", async () => {
    const applications = join(directory, ".local", "share", "applications");
    await mkdir(applications, { recursive: true });
    await writeFile(
      join(applications, "Unlisted.desktop"),
      "[Desktop Entry]\nType=Application\nName=Unlisted\nCategories=Network;WebBrowser;\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\nExec=unlisted %u\n",
    );
    for (const name of ["Unlisted", "ElectronNotes"]) {
      const root = join(directory, ".config", name);
      await mkdir(join(root, "Default"), { recursive: true });
      await writeFile(
        join(root, "Local State"),
        JSON.stringify({
          profile: { info_cache: { Default: { name: "Default" } } },
        }),
      );
      createChromiumCookieDatabase(join(root, "Default", "Cookies"), 24, []);
    }
    const mail = join(directory, ".mail", "main");
    await mkdir(mail, { recursive: true });
    await writeFile(
      join(directory, ".mail", "profiles.ini"),
      "[Profile0]\nName=Mail\nIsRelative=1\nPath=main\n",
    );
    createFirefoxCookieDatabase(join(mail, "cookies.sqlite"), 16, []);
    const service = createBrowserImportService({
      context: { platform: "linux", home: directory },
    });
    const found = (await service.listSources()).filter((source) =>
      source.id.startsWith("storage-"),
    );
    expect(found.map((source) => source.name)).toEqual(["Unlisted (Chromium)"]);
    await rm(join(applications, "Unlisted.desktop"));
    const source = found[0];
    if (!source) throw new Error("missing discovered browser");
    expect(
      await service.importCookies(
        { sourceId: source.id, sourceProfileDirectory: "Default" },
        { cookies: { set: vi.fn(), flushStore: vi.fn() } },
      ),
    ).toEqual({ ok: false, reason: "unknownSource" });
  });

  it("keeps the known-browser fallback when application registration cannot be read", async () => {
    const root = join(directory, ".config", "google-chrome", "Default");
    await mkdir(root, { recursive: true });
    createChromiumCookieDatabase(join(root, "Cookies"), 24, []);
    const service = createBrowserImportService({
      context: { platform: "linux", home: directory },
      listBrowserStorageNames: async () => {
        throw new Error("unavailable");
      },
    });
    const sources = await service.listSources();
    expect(sources.find((source) => source.id === "chrome")).toMatchObject({
      profiles: [{ directory: "Default", cookieCount: 0 }],
    });
  });

  it.each(["darwin", "linux"] as const)(
    "discovers an unlisted Chromium store on %s and imports only the selected profile",
    async (platform) => {
      const root =
        platform === "darwin"
          ? join(
              directory,
              "Library",
              "Application Support",
              "Unlisted",
              "User Data",
            )
          : join(directory, ".config", "Unlisted");
      await mkdir(join(root, "Default", "Network"), { recursive: true });
      await mkdir(join(root, "Profile 1"), { recursive: true });
      const key = deriveChromiumKey(
        "test-key",
        platform === "darwin" ? 1003 : 1,
      );
      createChromiumCookieDatabase(
        join(root, "Default", "Network", "Cookies"),
        24,
        [{ host: ".personal.test", name: "session", value: "personal" }],
      );
      createChromiumCookieDatabase(join(root, "Profile 1", "Cookies"), 24, [
        {
          host: ".work.test",
          name: "session",
          encrypted: encryptChromium(
            platform === "darwin" ? "v10" : "v11",
            key,
            "work",
            ".work.test",
          ),
        },
      ]);
      await writeFile(
        join(root, "Local State"),
        JSON.stringify({
          profile: {
            info_cache: {
              Default: { name: "Personal" },
              "Profile 1": { name: "Work" },
              "../escape": { name: "Escape" },
            },
          },
        }),
      );
      const run = fakeSecretRunner({
        "/usr/bin/security": { stdout: "test-key\n" },
        "secret-tool": { stdout: "test-key\n" },
      });
      const context = { platform, home: directory };
      const service = createBrowserImportService({
        listBrowserStorageNames: fixtureBrowserStorageNames,
        context,
        runSecretCommand: run,
      });
      const source = (await service.listSources()).find((s) =>
        s.id.startsWith("storage-"),
      );
      expect(source).toMatchObject({
        name: "Unlisted (Chromium)",
        profiles: [
          { directory: "Default", name: "Personal", cookieCount: 1 },
          { directory: "Profile 1", name: "Work", cookieCount: 1 },
        ],
      });
      if (!source) throw new Error("store not discovered");
      expect(run).not.toHaveBeenCalled();
      const set = vi.fn(async () => undefined);
      const session = {
        cookies: { set, flushStore: vi.fn(async () => undefined) },
      };
      expect(
        await service.importCookies(
          { sourceId: source.id, sourceProfileDirectory: "../escape" },
          session,
        ),
      ).toEqual({ ok: false, reason: "unknownSourceProfile" });
      expect(
        await service.importCookies(
          { sourceId: source.id, sourceProfileDirectory: "Profile 1" },
          session,
        ),
      ).toEqual({ ok: true, imported: 1, skipped: 0, skippedDomains: [] });
      expect(set).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ domain: ".work.test", value: "work" }),
      );
      expect(run).toHaveBeenCalledWith(
        ...(platform === "darwin"
          ? [
              "/usr/bin/security",
              [
                "find-generic-password",
                "-w",
                "-s",
                "Unlisted Safe Storage",
                "-a",
                "Unlisted",
              ],
            ]
          : ["secret-tool", ["lookup", "application", "Unlisted"]]),
      );
      const refreshed = await createBrowserImportService({
        listBrowserStorageNames: fixtureBrowserStorageNames,
        context,
      }).listSources();
      expect(refreshed.some((s) => s.id === source.id)).toBe(true);
      await rm(root, { recursive: true });
      expect(
        await service.importCookies(
          { sourceId: source.id, sourceProfileDirectory: "Profile 1" },
          session,
        ),
      ).toEqual({ ok: false, reason: "unknownSource" });
    },
  );

  it.each([
    [".unlisted"],
    [".var", "app", "org.example.Browser", ".unlisted"],
    ["snap", "unlisted", "common", ".unlisted"],
  ])(
    "discovers Firefox-format profiles in %j without a browser entry",
    async (...segments) => {
      const root = join(directory, ...segments);
      await mkdir(join(root, "main"), { recursive: true });
      await writeFile(
        join(root, "profiles.ini"),
        "[Profile0]\nName=Main\nIsRelative=1\nPath=main\n",
      );
      createFirefoxCookieDatabase(join(root, "main", "cookies.sqlite"), 16, [
        { host: ".unlisted.test", name: "session", value: "found", expiry: 0 },
        {
          host: ".container.test",
          name: "session",
          value: "excluded",
          expiry: 0,
          originAttributes: "^userContextId=1",
        },
      ]);
      const run = fakeSecretRunner({});
      const service = createBrowserImportService({
        listBrowserStorageNames: fixtureBrowserStorageNames,
        context: { platform: "linux", home: directory },
        runSecretCommand: run,
      });
      const discovered = (await service.listSources()).filter((s) =>
        s.id.startsWith("storage-"),
      );
      expect(discovered).toHaveLength(1);
      const source = discovered[0];
      if (!source) throw new Error("store not discovered");
      expect(source).toMatchObject({
        name: "unlisted (Firefox)",
        profiles: [{ directory: "main", name: "Main", cookieCount: 1 }],
      });
      const set = vi.fn(async () => undefined);
      expect(
        await service.importCookies(
          { sourceId: source.id, sourceProfileDirectory: "main" },
          { cookies: { set, flushStore: vi.fn(async () => undefined) } },
        ),
      ).toMatchObject({ ok: true, imported: 1 });
      expect(set).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ value: "found" }),
      );
      expect(run).not.toHaveBeenCalled();
    },
  );

  it("keeps known encryption metadata, deduplicates stores, and excludes the BB profile", async () => {
    const support = join(directory, "Library", "Application Support");
    const helium = join(support, "net.imput.helium");
    const extra = join(support, "Custom", "Unlisted");
    const bb = join(support, "bb");
    for (const root of [helium, extra, bb]) {
      await mkdir(join(root, "Default"), { recursive: true });
      createChromiumCookieDatabase(join(root, "Default", "Cookies"), 24, []);
    }
    await symlink(extra, join(support, "Alias"));
    const context = {
      platform: "darwin" as const,
      home: directory,
      excludedDirectories: [bb],
    };
    const discovered = await discoverBrowserImportSources(
      context,
      fixtureBrowserStorageNames,
    );
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe("Unlisted (Chromium)");
    const sources = await createBrowserImportService({
      listBrowserStorageNames: fixtureBrowserStorageNames,
      context,
    }).listSources();
    expect(sources.filter((s) => s.name === "Helium")).toHaveLength(1);
    expect(sources.find((s) => s.id === "helium")?.unavailable).toBeUndefined();
  });

  it("uses known Linux encryption metadata for a Flatpak store", async () => {
    const root = join(
      directory,
      ".var",
      "app",
      "com.brave.Browser",
      "config",
      "BraveSoftware",
      "Brave-Browser",
    );
    await mkdir(join(root, "Default"), { recursive: true });
    createChromiumCookieDatabase(join(root, "Default", "Cookies"), 24, []);
    const sources = await discoverBrowserImportSources(
      {
        platform: "linux",
        home: directory,
      },
      fixtureBrowserStorageNames,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: "Brave (Chromium)",
      linuxSecretApplication: "brave",
    });
  });

  it("ignores corrupt databases and lookalike tables while finding direct and XDG stores", async () => {
    const configHome = join(directory, "custom-config");
    for (const name of ["Broken", "Lookalike", "Direct"])
      await mkdir(join(configHome, name), { recursive: true });
    await writeFile(join(configHome, "Broken", "Cookies"), "not sqlite");
    const path = join(configHome, "Lookalike", "Cookies");
    const db = new DatabaseSync(path);
    db.exec(
      "create table cookies (name text); create table meta (key text, value text); insert into meta values ('version', '24')",
    );
    db.close();
    createChromiumCookieDatabase(join(configHome, "Direct", "Cookies"), 24, [
      { host: ".direct.test", name: "session", value: "plain" },
    ]);
    const run = fakeSecretRunner({});
    const service = createBrowserImportService({
      listBrowserStorageNames: fixtureBrowserStorageNames,
      context: { platform: "linux", home: directory, configHome },
      runSecretCommand: run,
    });
    const sources = (await service.listSources()).filter((s) =>
      s.id.startsWith("storage-"),
    );
    expect(sources).toHaveLength(1);
    const source = sources[0];
    if (!source) throw new Error("missing direct store");
    expect(source).toMatchObject({
      name: "Direct (Chromium)",
      profiles: [{ directory: ".", name: "Default" }],
    });
    expect(
      await service.importCookies(
        { sourceId: source.id, sourceProfileDirectory: "." },
        {
          cookies: {
            set: vi.fn(async () => undefined),
            flushStore: vi.fn(async () => undefined),
          },
        },
      ),
    ).toMatchObject({ ok: true, imported: 1 });
    expect(run).not.toHaveBeenCalled();
  });

  it("treats a live lock conservatively when the discovered process name is unknown", async () => {
    const root = join(directory, ".config", "Unlisted");
    await mkdir(join(root, "Default"), { recursive: true });
    createChromiumCookieDatabase(join(root, "Default", "Cookies"), 24, []);
    await symlink(`${hostname()}-42`, join(root, "SingletonLock"));
    const context = { platform: "linux" as const, home: directory };
    const source = (
      await discoverBrowserImportSources(context, fixtureBrowserStorageNames)
    )[0];
    if (!source) throw new Error("missing source");
    expect(
      await isSourceRunning(source, context, async () => "/opt/custom-binary"),
    ).toBe(true);
    expect(await isSourceRunning(source, context, async () => null)).toBe(
      false,
    );
  });

  it("retains a known browser with cookies stored directly in its data directory", async () => {
    const root = join(directory, ".config", "opera");
    await mkdir(root, { recursive: true });
    createChromiumCookieDatabase(join(root, "Cookies"), 24, []);
    const service = createBrowserImportService({
      listBrowserStorageNames: fixtureBrowserStorageNames,
      context: { platform: "linux", home: directory },
    });
    const sources = await service.listSources();
    expect(sources.find((source) => source.id === "opera")).toMatchObject({
      profiles: [{ directory: ".", cookieCount: 0 }],
    });
    expect(
      sources.filter((source) => source.id.startsWith("storage-")),
    ).toHaveLength(0);
  });

  it("reads a Chromium database, skipping partitioned and keyring-only rows", async () => {
    const key = deriveChromiumKey("peanuts", 1);
    const path = join(directory, "Cookies");
    createChromiumCookieDatabase(path, 24, [
      {
        host: ".example.com",
        name: "sid",
        encrypted: encryptChromium("v10", key, "abc", ".example.com"),
        expiresSeconds: 1_900_000_000,
        secure: true,
        httpOnly: true,
        sameSite: 1,
      },
      { host: "plain.test", name: "plain", value: "clear", sameSite: 2 },
      {
        host: ".partitioned.test",
        name: "p",
        value: "x",
        topFrameSiteKey: "https://top.test",
      },
      {
        host: ".keyring.test",
        name: "k",
        encrypted: encryptChromium("v11", key, "nope", ".keyring.test"),
      },
    ]);
    const result = await readChromiumCookies(
      {
        cookieDatabasePath: path,
        keychainService: undefined,
        keychainAccount: undefined,
        linuxSecretApplication: "chrome",
        platform: "linux",
      },
      fakeSecretRunner({}),
    );
    expect(result.cookies).toEqual([
      {
        url: "https://example.com/",
        name: "sid",
        value: "abc",
        domain: ".example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: 1_900_000_000,
        sameSite: "lax",
      },
      {
        url: "http://plain.test/",
        name: "plain",
        value: "clear",
        domain: undefined,
        path: "/",
        secure: false,
        httpOnly: false,
        expirationDate: undefined,
        sameSite: "strict",
      },
    ]);
    expect(result.undecryptable).toBe(2);
    expect(result.undecryptableHosts.sort()).toEqual([
      "keyring.test",
      "partitioned.test",
    ]);
  });

  it("surfaces the keyring failure when every readable row needed it", async () => {
    const key = deriveChromiumKey("peanuts", 1);
    const path = join(directory, "Cookies");
    createChromiumCookieDatabase(path, 23, [
      {
        host: ".keyring.test",
        name: "k",
        encrypted: encryptChromium("v11", key, "v"),
      },
    ]);
    await expect(
      readChromiumCookies(
        {
          cookieDatabasePath: path,
          keychainService: undefined,
          keychainAccount: undefined,
          linuxSecretApplication: "chrome",
          platform: "linux",
        },
        fakeSecretRunner({}),
      ),
    ).rejects.toMatchObject({ reason: "keychainUnavailable" });
  });

  it("reads Firefox cookies from the default container with schema-aware expiry", async () => {
    const path = join(directory, "cookies.sqlite");
    createFirefoxCookieDatabase(path, 16, [
      {
        host: ".mozilla.org",
        name: "a",
        value: "1",
        expiry: 1_900_000_000_000,
        sameSite: 0,
        secure: true,
      },
      {
        host: "container.test",
        name: "b",
        value: "2",
        expiry: 1,
        originAttributes: "^userContextId=2",
      },
    ]);
    const cookies = await readFirefoxCookies(path);
    expect(cookies).toEqual([
      {
        url: "https://mozilla.org/",
        name: "a",
        value: "1",
        domain: ".mozilla.org",
        path: "/",
        secure: true,
        httpOnly: false,
        expirationDate: 1_900_000_000,
        sameSite: "no_restriction",
      },
    ]);
    const legacy = join(directory, "legacy.sqlite");
    createFirefoxCookieDatabase(legacy, 12, [
      {
        host: "x.test",
        name: "c",
        value: "3",
        expiry: 5,
        sameSite: 1,
        rawSameSite: 0,
      },
    ]);
    const legacyCookies = await readFirefoxCookies(legacy);
    expect(legacyCookies[0]).toMatchObject({
      expirationDate: 5,
      sameSite: "unspecified",
    });
  });

  it("fails with readFailed when the Firefox database is not SQLite", async () => {
    const path = join(directory, "cookies.sqlite");
    await writeFile(path, "not a database");
    await expect(readFirefoxCookies(path)).rejects.toMatchObject({
      reason: "readFailed",
    });
  });

  it("parses Safari binary cookies and rejects malformed jars", () => {
    const buffer = buildBinaryCookies([
      {
        domain: ".apple.com",
        name: "s",
        path: "/",
        value: "v",
        flags: 0x5,
        expiry: 1_000,
      },
      { domain: "host.test", name: "h", path: "", value: "" },
    ]);
    expect(parseBinaryCookies(buffer)).toEqual([
      {
        url: "https://apple.com/",
        domain: ".apple.com",
        name: "s",
        value: "v",
        path: "/",
        secure: true,
        httpOnly: true,
        expirationDate: 978_308_200,
        sameSite: "lax",
      },
      {
        url: "http://host.test/",
        domain: undefined,
        name: "h",
        value: "",
        path: "/",
        secure: false,
        httpOnly: false,
        expirationDate: undefined,
        sameSite: "lax",
      },
    ]);
    const truncated = buffer.subarray(0, buffer.length - 20);
    expect(() => parseBinaryCookies(truncated)).toThrow(BrowserImportError);
    expect(() => parseBinaryCookies(Buffer.from("nope"))).toThrow(
      BrowserImportError,
    );
  });

  it("lists Chromium profiles from Local State and rejects traversal entries", async () => {
    const chrome = findBrowserImportSource("chrome");
    if (!chrome) throw new Error("chrome source missing");
    const context = { platform: "linux" as const, home: directory };
    const root = join(directory, ".config", "google-chrome");
    await mkdir(join(root, "Default", "Network"), { recursive: true });
    await mkdir(join(root, "Profile 1"), { recursive: true });
    createChromiumCookieDatabase(
      join(root, "Default", "Network", "Cookies"),
      24,
      [
        { host: "a.test", name: "x", value: "1" },
        { host: "b.test", name: "y", value: "2" },
      ],
    );
    createChromiumCookieDatabase(join(root, "Profile 1", "Cookies"), 24, []);
    await writeFile(
      join(root, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: "Person 1" },
            "Profile 1": { name: "Work" },
            "../escape": { name: "bad" },
          },
        },
      }),
    );
    expect(await listSourceProfiles(chrome, context)).toEqual([
      { directory: "Default", name: "Person 1", cookieCount: 2 },
      { directory: "Profile 1", name: "Work", cookieCount: 0 },
    ]);
    expect(
      parseChromiumLocalStateProfiles(
        JSON.stringify({ profile: { info_cache: { "a/b": {}, ".": {} } } }),
      ),
    ).toEqual([]);
    expect(await isSourceRunning(chrome, context)).toBe(false);
    await symlink(`${hostname()}-999999`, join(root, "SingletonLock"));
    expect(await isSourceRunning(chrome, context, async () => null)).toBe(
      false,
    );
    expect(
      await isSourceRunning(chrome, context, async () => "/usr/bin/vim"),
    ).toBe(false);
    expect(
      await isSourceRunning(
        chrome,
        context,
        async () => "/opt/google/chrome/chrome --type=browser",
      ),
    ).toBe(true);
  });

  const macChromiumCases = [
    {
      id: "helium",
      name: "Helium",
      path: ["net.imput.helium"],
      keychainService: "Helium Storage Key",
    },
    {
      id: "dia",
      name: "Dia",
      path: ["Dia", "User Data"],
      keychainService: "Dia Safe Storage",
    },
  ] as const;

  it.each(macChromiumCases)(
    "imports only the selected $name profile using its macOS Keychain identity",
    async ({ id, name, path, keychainService }) => {
      const root = join(directory, "Library", "Application Support", ...path);
      await mkdir(join(root, "Default"), { recursive: true });
      await mkdir(join(root, "Profile 1"), { recursive: true });
      const key = deriveChromiumKey("test-secret", 1003);
      createChromiumCookieDatabase(join(root, "Profile 1", "Cookies"), 24, [
        {
          host: ".work.test",
          name: "session",
          encrypted: encryptChromium("v10", key, "work-session", ".work.test"),
        },
      ]);
      createChromiumCookieDatabase(join(root, "Default", "Cookies"), 24, [
        { host: "personal.test", name: "session", value: "personal-session" },
      ]);
      await writeFile(
        join(root, "Local State"),
        JSON.stringify({
          profile: {
            info_cache: {
              Default: { name: "Personal" },
              "Profile 1": { name: "Work" },
            },
          },
        }),
      );
      const run = fakeSecretRunner({
        "/usr/bin/security": { stdout: "test-secret\n", exitCode: 0 },
      });
      const service = createBrowserImportService({
        listBrowserStorageNames: fixtureBrowserStorageNames,
        context: { platform: "darwin", home: directory },
        runSecretCommand: run,
      });
      expect(
        (await service.listSources()).find((source) => source.id === id),
      ).toMatchObject({
        profiles: [
          { directory: "Default", name: "Personal", cookieCount: 1 },
          { directory: "Profile 1", name: "Work", cookieCount: 1 },
        ],
      });
      const set = vi.fn(async () => undefined);
      const flushStore = vi.fn(async () => undefined);
      expect(
        await service.importCookies(
          { sourceId: id, sourceProfileDirectory: "Profile 1" },
          { cookies: { set, flushStore } },
        ),
      ).toEqual({ ok: true, imported: 1, skipped: 0, skippedDomains: [] });
      expect(run).toHaveBeenCalledWith("/usr/bin/security", [
        "find-generic-password",
        "-w",
        "-s",
        keychainService,
        "-a",
        name,
      ]);
      expect(set).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          domain: ".work.test",
          name: "session",
          value: "work-session",
        }),
      );
    },
  );

  it.each(["darwin", "linux"] as const)(
    "lists native Zen profiles on %s without Firefox Snap profiles",
    async (platform) => {
      const root =
        platform === "darwin"
          ? join(directory, "Library", "Application Support", "zen")
          : join(directory, ".zen");
      const profile = platform === "darwin" ? "Profiles/work" : "work";
      const profilePath = join(root, profile);
      await mkdir(profilePath, { recursive: true });
      await writeFile(
        join(root, "profiles.ini"),
        `[Profile0]\nName=Work\nIsRelative=1\nPath=${profile}\n`,
      );
      createFirefoxCookieDatabase(join(profilePath, "cookies.sqlite"), 14, []);
      const snapRoot = join(
        directory,
        "snap",
        "firefox",
        "common",
        ".mozilla",
        "firefox",
      );
      await mkdir(join(snapRoot, "other"), { recursive: true });
      await writeFile(
        join(snapRoot, "profiles.ini"),
        "[Profile0]\nName=Firefox\nIsRelative=1\nPath=other\n",
      );
      createFirefoxCookieDatabase(
        join(snapRoot, "other", "cookies.sqlite"),
        14,
        [],
      );
      const context = { platform, home: directory };
      const service = createBrowserImportService({
        listBrowserStorageNames: fixtureBrowserStorageNames,
        context,
      });
      expect(
        (await service.listSources()).find((source) => source.id === "zen"),
      ).toMatchObject({
        profiles: [{ directory: profile, name: "Work", cookieCount: 0 }],
      });
    },
  );

  it("judges Chromium lock targets by host, pid liveness, and owner", async () => {
    const names = ["Google Chrome", "chrome"];
    const dead = async () => null;
    const unknown = async () => "";
    const chrome = async () =>
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    expect(
      await chromiumSingletonLockIsHeld("other-12", "me", names, chrome),
    ).toBe(true);
    expect(
      await chromiumSingletonLockIsHeld(
        "mac.lan-4149",
        "sawyers-macbook-pro.local",
        names,
        dead,
      ),
    ).toBe(false);
    expect(
      await chromiumSingletonLockIsHeld(
        "mac.lan-4149",
        "sawyers-macbook-pro.local",
        names,
        unknown,
      ),
    ).toBe(false);
    expect(
      await chromiumSingletonLockIsHeld("garbage", "me", names, chrome),
    ).toBe(true);
    expect(await chromiumSingletonLockIsHeld("me-12", "me", names, dead)).toBe(
      false,
    );
    expect(
      await chromiumSingletonLockIsHeld("me-12", "me", names, unknown),
    ).toBe(true);
    expect(
      await chromiumSingletonLockIsHeld(
        "Sawyers-MacBook-Pro-12",
        "sawyers-macbook-pro.local",
        names,
        chrome,
      ),
    ).toBe(true);
    expect(
      await chromiumSingletonLockIsHeld(
        "me-12",
        "me",
        names,
        async () => "/usr/bin/vim",
      ),
    ).toBe(false);
  });

  it("parses Firefox profiles.ini and keeps them inside the root", () => {
    const profiles = parseFirefoxProfiles(
      [
        "[Install1]",
        "Default=Profiles/abc.default",
        "[Profile0]",
        "Name=default",
        "IsRelative=1",
        "Path=Profiles/abc.default",
        "[Profile1]",
        "Name=escape",
        "IsRelative=1",
        "Path=../../etc",
        "[Profile2]",
        "Name=absolute",
        "IsRelative=0",
        "Path=/custom/profile",
      ].join("\n"),
      "/home/u/.mozilla/firefox",
    );
    expect(profiles).toEqual([
      { directory: "Profiles/abc.default", name: "default" },
      { directory: "/custom/profile", name: "absolute" },
    ]);
  });

  it("imports through the service into a session and reports rejected writes", async () => {
    const context = { platform: "linux" as const, home: directory };
    const root = join(directory, ".mozilla", "firefox", "Profiles", "p1");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(directory, ".mozilla", "firefox", "profiles.ini"),
      "[Profile0]\nName=main\nIsRelative=1\nPath=Profiles/p1\n",
    );
    createFirefoxCookieDatabase(join(root, "cookies.sqlite"), 16, [
      { host: ".ok.test", name: "a", value: "1", expiry: 0, sameSite: null },
      { host: "reject.test", name: "b", value: "2", expiry: 0, sameSite: null },
    ]);
    const service = createBrowserImportService({
      listBrowserStorageNames: fixtureBrowserStorageNames,
      context,
    });
    const sources = await service.listSources();
    expect(sources.find((source) => source.id === "firefox")).toEqual({
      id: "firefox",
      name: "Firefox",
      profiles: [{ directory: "Profiles/p1", name: "main", cookieCount: 2 }],
    });
    expect(sources.find((source) => source.id === "safari")?.unavailable).toBe(
      "unsupportedPlatform",
    );
    expect(sources.find((source) => source.id === "chrome")?.unavailable).toBe(
      "notInstalled",
    );
    const set = vi.fn(async (details: { url: string }) => {
      if (details.url.includes("reject")) throw new Error("rejected");
    });
    const flushStore = vi.fn(async () => undefined);
    const session = { cookies: { set, flushStore } };
    await expect(
      service.importCookies(
        { sourceId: "firefox", sourceProfileDirectory: "Profiles/other" },
        session,
      ),
    ).resolves.toEqual({ ok: false, reason: "unknownSourceProfile" });
    await expect(
      service.importCookies(
        { sourceId: "chrome", sourceProfileDirectory: "Default" },
        session,
      ),
    ).resolves.toEqual({ ok: false, reason: "notInstalled" });
    const outcome = await service.importCookies(
      { sourceId: "firefox", sourceProfileDirectory: "Profiles/p1" },
      session,
    );
    expect(outcome).toEqual({
      ok: true,
      imported: 1,
      skipped: 1,
      skippedDomains: ["reject.test"],
    });
    expect(set).toHaveBeenCalledWith({
      url: "http://ok.test/",
      name: "a",
      value: "1",
      domain: ".ok.test",
      path: "/",
      secure: false,
      httpOnly: false,
      sameSite: "unspecified",
    });
    expect(set).toHaveBeenCalledWith(
      expect.not.objectContaining({ domain: expect.anything() }),
    );
    expect(flushStore).toHaveBeenCalledTimes(1);
  });

  it("skips expired cookies so they cannot overwrite live sessions", async () => {
    const set = vi.fn(async () => undefined);
    const outcome = await writeCookies(
      { cookies: { set, flushStore: vi.fn(async () => undefined) } },
      {
        cookies: [
          {
            url: "https://a.test/",
            name: "old",
            value: "1",
            domain: undefined,
            path: "/",
            secure: true,
            httpOnly: false,
            expirationDate: 1_000,
            sameSite: "lax",
          },
          {
            url: "https://a.test/",
            name: "fresh",
            value: "2",
            domain: undefined,
            path: "/",
            secure: true,
            httpOnly: false,
            expirationDate: 3_000,
            sameSite: "lax",
          },
        ],
        undecryptable: 0,
        undecryptableHosts: [],
      },
      undefined,
      2_000_000,
    );
    expect(outcome).toEqual({
      ok: true,
      imported: 1,
      skipped: 1,
      skippedDomains: [],
    });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fresh" }),
    );
  });

  it("detects a running Firefox through the parentlock owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-ff-lock-"));
    try {
      const lock = join(directory, ".parentlock");
      await writeFile(lock, "");
      const names = ["Firefox", "firefox"];
      expect(
        await firefoxParentLockIsHeld(
          lock,
          names,
          async () => "/Applications/Firefox.app/Contents/MacOS/firefox",
          async () => [42],
        ),
      ).toBe(true);
      expect(
        await firefoxParentLockIsHeld(
          lock,
          names,
          async () => "/usr/bin/vim",
          async () => [42],
        ),
      ).toBe(false);
      expect(
        await firefoxParentLockIsHeld(
          lock,
          names,
          async () => "firefox",
          async () => [],
        ),
      ).toBe(false);
      expect(
        await firefoxParentLockIsHeld(
          join(directory, "missing"),
          names,
          async () => "firefox",
          async () => [42],
        ),
      ).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not flush when nothing was written", async () => {
    const flushStore = vi.fn(async () => undefined);
    const outcome = await writeCookies(
      { cookies: { set: vi.fn(async () => undefined), flushStore } },
      { cookies: [], undecryptable: 3, undecryptableHosts: ["a", "b"] },
    );
    expect(outcome).toEqual({
      ok: true,
      imported: 0,
      skipped: 3,
      skippedDomains: ["a", "b"],
    });
    expect(flushStore).not.toHaveBeenCalled();
  });
});

describe("macOS app icons", () => {
  it("picks the icon file from Info.plist and rejects path escapes", () => {
    expect(iconFileFromInfoPlist('{"CFBundleIconFile":"app"}')).toBe(
      "app.icns",
    );
    expect(iconFileFromInfoPlist('{"CFBundleIconFile":"app.icns"}')).toBe(
      "app.icns",
    );
    expect(iconFileFromInfoPlist('{"CFBundleIconName":"AppIcon"}')).toBe(
      "AppIcon.icns",
    );
    expect(
      iconFileFromInfoPlist('{"CFBundleIconFile":"../x"}'),
    ).toBeUndefined();
    expect(iconFileFromInfoPlist("nope")).toBeUndefined();
  });

  it("converts the bundle icon with sips and returns a PNG data URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bb-icon-"));
    try {
      const appPath = join(directory, "Arc.app");
      await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
      await writeFile(
        join(appPath, "Contents", "Resources", "Arc.icns"),
        "icns",
      );
      const run = vi.fn(async (file: string, args: string[]) => {
        if (file === "plutil")
          return { ok: true, stdout: '{"CFBundleIconFile":"Arc"}' };
        const out = args[args.indexOf("--out") + 1];
        await writeFile(out, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return { ok: true, stdout: "" };
      });
      const icon = await readMacAppIcon(appPath, 64, run);
      expect(icon).toBe("data:image/png;base64,iVBORw==");
      expect(run).toHaveBeenLastCalledWith(
        "sips",
        expect.arrayContaining([
          "--resampleHeightWidth",
          "64",
          "64",
          join(appPath, "Contents", "Resources", "Arc.icns"),
        ]),
      );
      expect(
        await readMacAppIcon(appPath, 64, async () => ({
          ok: false,
          stdout: "",
        })),
      ).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
