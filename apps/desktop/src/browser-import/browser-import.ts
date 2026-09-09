import type { Session } from "electron";
import type {
  DesktopBrowserImportOutcome,
  DesktopBrowserImportSelection,
  DesktopBrowserImportSource,
  DesktopBrowserImportUnavailableReason,
} from "@bb/host-daemon-contract";
import { readChromiumCookies } from "./chromium-cookies.js";
import { runSecretCommand, type SecretCommandRunner } from "./chromium-keys.js";
import {
  BrowserImportError,
  type CookieReadResult,
} from "./cookie-database.js";
import { readFirefoxCookies } from "./firefox-cookies.js";
import { readSafariCookies, safariAccessDenied } from "./safari-cookies.js";
import {
  findBrowserImportSource,
  isSourceInstalled,
  isSourceRunning,
  listSourceProfiles,
  resolveCookieDatabase,
  BROWSER_IMPORT_SOURCES,
  type BrowserImportPathContext,
  type BrowserImportSourceDefinition,
} from "./sources.js";

const MAX_SKIPPED_DOMAINS = 20;

export type CookieWriteSession = {
  cookies: Pick<Session["cookies"], "set" | "flushStore">;
};

export interface BrowserImportService {
  listSources(): Promise<DesktopBrowserImportSource[]>;
  importCookies(
    selection: DesktopBrowserImportSelection,
    session: CookieWriteSession,
  ): Promise<DesktopBrowserImportOutcome>;
}

export interface CreateBrowserImportServiceArgs {
  context: BrowserImportPathContext;
  runSecretCommand?: SecretCommandRunner;
  log?: (message: string, details?: Record<string, unknown>) => void;
}

async function unavailableReason(
  definition: BrowserImportSourceDefinition,
  context: BrowserImportPathContext,
): Promise<DesktopBrowserImportUnavailableReason | undefined> {
  if (!definition.platforms.includes(context.platform))
    return "unsupportedPlatform";
  if (!(await isSourceInstalled(definition, context))) return "notInstalled";
  if (await isSourceRunning(definition, context)) return "browserRunning";
  if (definition.engine === "safari") {
    const jar = await resolveCookieDatabase(definition, context, ".");
    if (jar !== undefined && (await safariAccessDenied(jar)))
      return "needsFullDiskAccess";
  }
  return undefined;
}

function cookieHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function writeCookies(
  session: CookieWriteSession,
  read: CookieReadResult,
  log?: CreateBrowserImportServiceArgs["log"],
): Promise<DesktopBrowserImportOutcome> {
  let imported = 0;
  let skipped = read.undecryptable;
  const skippedDomains = new Set(read.undecryptableHosts);
  for (const cookie of read.cookies) {
    try {
      await session.cookies.set({
        url: cookie.url,
        name: cookie.name,
        value: cookie.value,
        ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        ...(cookie.expirationDate === undefined
          ? {}
          : { expirationDate: cookie.expirationDate }),
      });
      imported += 1;
    } catch (error) {
      skipped += 1;
      skippedDomains.add(cookieHost(cookie.url));
      log?.("Imported cookie was rejected", {
        url: cookie.url,
        name: cookie.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (imported > 0) {
    try {
      await session.cookies.flushStore();
    } catch (error) {
      log?.("Imported cookies could not be flushed to disk", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    ok: true,
    imported,
    skipped,
    skippedDomains: [...skippedDomains].slice(0, MAX_SKIPPED_DOMAINS),
  };
}

export function createBrowserImportService(
  args: CreateBrowserImportServiceArgs,
): BrowserImportService {
  const { context } = args;
  const run = args.runSecretCommand ?? runSecretCommand;

  async function listSources(): Promise<DesktopBrowserImportSource[]> {
    const sources: DesktopBrowserImportSource[] = [];
    for (const definition of BROWSER_IMPORT_SOURCES) {
      const unavailable = await unavailableReason(definition, context);
      sources.push({
        id: definition.id,
        name: definition.name,
        profiles:
          unavailable === undefined
            ? await listSourceProfiles(definition, context)
            : [],
        ...(unavailable === undefined ? {} : { unavailable }),
      });
    }
    return sources;
  }

  async function readSelection(
    selection: DesktopBrowserImportSelection,
  ): Promise<CookieReadResult> {
    const definition = findBrowserImportSource(selection.sourceId);
    if (!definition) throw new BrowserImportError("unknownSource");
    const blocked = await unavailableReason(definition, context);
    if (blocked !== undefined) throw new BrowserImportError(blocked);
    const profiles = await listSourceProfiles(definition, context);
    const requested = profiles.find(
      (profile) => profile.directory === selection.sourceProfileDirectory,
    );
    if (requested === undefined)
      throw new BrowserImportError("unknownSourceProfile");
    const databasePath = await resolveCookieDatabase(
      definition,
      context,
      requested.directory,
    );
    if (databasePath === undefined) throw new BrowserImportError("readFailed");
    if (definition.engine === "safari") {
      return {
        cookies: await readSafariCookies(databasePath),
        undecryptable: 0,
        undecryptableHosts: [],
      };
    }
    if (definition.engine === "firefox") {
      return {
        cookies: await readFirefoxCookies(databasePath),
        undecryptable: 0,
        undecryptableHosts: [],
      };
    }
    return readChromiumCookies(
      {
        cookieDatabasePath: databasePath,
        keychainService: definition.keychainService,
        keychainAccount: definition.keychainAccount,
        linuxSecretApplication: definition.linuxSecretApplication,
        platform: context.platform,
      },
      run,
    );
  }

  return {
    listSources,
    async importCookies(selection, session) {
      let read: CookieReadResult;
      try {
        read = await readSelection(selection);
      } catch (error) {
        if (error instanceof BrowserImportError) {
          args.log?.("Browser cookie import failed", {
            sourceId: selection.sourceId,
            reason: error.reason,
            error: error.message,
          });
          return { ok: false, reason: error.reason };
        }
        args.log?.("Browser cookie import failed", {
          sourceId: selection.sourceId,
          reason: "readFailed",
          error: error instanceof Error ? error.message : String(error),
        });
        return { ok: false, reason: "readFailed" };
      }
      return writeCookies(session, read, args.log);
    },
  };
}
