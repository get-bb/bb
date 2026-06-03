import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mimeTypes from "mime-types";
import type { Hono } from "hono";
import type { ZodIssue } from "zod";
import {
  resolveApplicationDataPath,
  resolveApplicationManifestPath,
  resolveApplicationPath,
  resolveApplicationPublicPath,
  resolveAppsRootPath,
} from "@bb/config/app-storage-paths";
import {
  appDataPathSchema,
  applicationIdSchema,
  deriveApplicationIdFromName,
  jsonValueSchema,
} from "@bb/domain";
import type { AppDataPath, ApplicationId, JsonValue } from "@bb/domain";
import {
  appDataListQuerySchema,
  appDataWriteRequestSchema,
  appManifestSchema,
  appMessageRequestSchema,
  createAppRequestSchema,
  typedRoutes,
  type AppCapability,
  type AppDataEntry,
  type AppDetail,
  type AppEntry,
  type AppIcon,
  type AppManifest,
  type AppSummary,
  type CreateAppRequest,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { AppDeps, LoggedWorkSessionDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { requirePublicThread } from "../services/lib/entity-lookup.js";
import { requireThreadCommandEnvironment } from "../services/threads/thread-command-environment.js";
import { sendThreadMessage } from "../services/threads/thread-send.js";
import { injectAppClientScript } from "../services/threads/app-client-script.js";
import {
  extractRoutePath,
  parseSafeRelativeRoutePath,
  type SafeRelativeRoutePath,
} from "./relative-route-path.js";

interface InvalidAppManifestErrorArgs extends ApplicationManifestReadArgs {
  issues: AppManifestValidationIssues;
  manifestPath: string;
}

interface LogInvalidAppManifestArgs {
  error: InvalidAppManifestError;
  message: string;
}

interface ApplicationManifestReadArgs {
  applicationId: ApplicationId;
  dataDir: string;
}

interface ApplicationSummaryArgs extends ApplicationManifestReadArgs {
  manifest: AppManifest;
}

interface ReadApplicationRelativeFileArgs {
  applicationId: ApplicationId;
  dataDir: string;
  dotfiles: "allow" | "deny";
  path: string;
  rootKind: "app" | "data" | "public";
}

interface ApplicationRootForKindArgs {
  applicationId: ApplicationId;
  dataDir: string;
  rootKind: "app" | "data" | "public";
}

interface ReadApplicationDataEntryArgs {
  applicationId: ApplicationId;
  dataDir: string;
  dataPath: AppDataPath;
}

interface ListApplicationDataEntriesArgs {
  applicationId: ApplicationId;
  dataDir: string;
  dataPath: AppDataPath | "";
}

interface WriteApplicationDataEntryArgs extends ReadApplicationDataEntryArgs {
  value: JsonValue;
}

interface CreateInjectedAppHtmlResponseArgs {
  appSessionToken: AppSessionToken | null;
  capabilities: AppCapability[];
  html: string;
  applicationId: ApplicationId;
  requestUrl: string;
  targetThreadId: string | null;
}

interface ServeApplicationStaticFileArgs {
  deps: AppDeps;
  rawApplicationId: string;
  rawPath: string;
}

interface ApplicationStaticFile {
  bytes: Buffer;
  path: string;
}

interface ReadApplicationStaticFileArgs {
  applicationId: ApplicationId;
  staticPath: ApplicationStaticPath;
  dataDir: string;
}

interface CreateGlobalApplicationArgs {
  applicationId: ApplicationId;
  dataDir: string;
  name: string;
}

interface CreateApplicationTempRootArgs {
  appsRootPath: string;
  applicationId: ApplicationId;
}

interface WriteInitialApplicationFilesArgs {
  applicationId: ApplicationId;
  name: string;
  tempRootPath: string;
}

interface CopyApplicationScaffoldTemplateArgs {
  templatePath: string;
  tempRootPath: string;
}

interface CopyApplicationScaffoldSourceDirectoryArgs {
  sourcePath: string;
  targetPath: string;
  templatePath: string;
}

interface ShouldCopyApplicationScaffoldTemplatePathArgs {
  sourcePath: string;
  templatePath: string;
}

interface RelativeFilesystemPathArgs {
  basePath: string;
  targetPath: string;
}

interface ResolveApplicationScaffoldTemplatePathArgs {
  moduleDir: string;
}

interface PatchApplicationScaffoldReadmeArgs {
  name: string;
  tempRootPath: string;
}

interface PublishApplicationTempRootArgs {
  applicationPath: string;
  tempRootPath: string;
}

type PublishApplicationTempRootResult = "published" | "collision";
type DeleteGlobalApplicationResult = "deleted" | "partial";

interface AppSession {
  applicationId: ApplicationId;
  projectId: string;
  threadId: string;
}

interface ResolveAppMessageTargetArgs {
  applicationId: ApplicationId;
  payload: {
    appSessionToken?: string;
    targetThreadId?: string;
  };
  sessions: AppSessionStore;
}

interface CreateAppSessionArgs {
  applicationId: ApplicationId;
  projectId: string;
  threadId: string;
}

interface AppSessionStore {
  create(args: CreateAppSessionArgs): AppSessionToken;
  get(token: string): AppSession | null;
}

type ApplicationStaticPath = SafeRelativeRoutePath;
type AppManifestValidationIssues = readonly ZodIssue[];
type AppManifestValidationLoggerDeps = Pick<AppDeps, "logger">;
type GlobalAppListDeps = Pick<AppDeps, "config" | "hub" | "logger">;
type AppSessionToken = string;
type LogoExtension = "svg" | "png" | "jpg" | "jpeg";

const DATA_DIRECTORY_NAME = "data";
const MANIFEST_FILE_NAME = "manifest.json";
const PUBLIC_DIRECTORY_NAME = "public";
const APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME = "app-scaffold-template";
const APP_SCAFFOLD_SOURCE_DIRECTORY_NAME = "source";
const APP_SCAFFOLD_README_PLACEHOLDER = "BB_APP_NAME_PLACEHOLDER";
const HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const NO_STORE_CACHE_CONTROL = "no-store";
const CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_ENTRY_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_EXTENSIONS: readonly LogoExtension[] = ["svg", "png", "jpg", "jpeg"];
const APP_SESSION_TOKEN_PREFIX = "appsess_";
const INVALID_APP_MANIFEST_MESSAGE =
  "App manifest failed validation. Inspect manifest.json or rebuild the app.";
const APP_SCAFFOLD_SOURCE_DEV_OUTPUT_DIRECTORY_NAMES = new Set([
  "node_modules",
  "playwright-report",
  "screenshots",
  "test-results",
]);
const APP_SCAFFOLD_COPY_MODE = fsConstants.COPYFILE_FICLONE;
const routesModuleDir = path.dirname(fileURLToPath(import.meta.url));

class InvalidAppManifestError extends ApiError {
  readonly applicationId: ApplicationId;
  readonly manifestPath: string;
  readonly issues: AppManifestValidationIssues;

  constructor(args: InvalidAppManifestErrorArgs) {
    super(422, "invalid_manifest", INVALID_APP_MANIFEST_MESSAGE);
    this.name = "InvalidAppManifestError";
    this.applicationId = args.applicationId;
    this.manifestPath = args.manifestPath;
    this.issues = args.issues;
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalizeJson(value: JsonValue | AppManifest): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function relativeFilesystemPath(args: RelativeFilesystemPathArgs): string {
  return path
    .relative(args.basePath, args.targetPath)
    .split(path.sep)
    .join("/");
}

export function shouldCopyApplicationScaffoldTemplatePath(
  args: ShouldCopyApplicationScaffoldTemplatePathArgs,
): boolean {
  const relativePath = relativeFilesystemPath({
    basePath: args.templatePath,
    targetPath: args.sourcePath,
  });
  if (
    relativePath === "" ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    return relativePath === "" || relativePath === ".";
  }

  const pathSegments = relativePath.split("/");
  if (pathSegments[0] !== APP_SCAFFOLD_SOURCE_DIRECTORY_NAME) {
    return true;
  }
  return !pathSegments.some((segment) =>
    APP_SCAFFOLD_SOURCE_DEV_OUTPUT_DIRECTORY_NAMES.has(segment),
  );
}

function hasApplicationScaffoldTemplate(templatePath: string): boolean {
  return (
    existsSync(path.join(templatePath, MANIFEST_FILE_NAME)) &&
    existsSync(path.join(templatePath, "README.md")) &&
    existsSync(path.join(templatePath, PUBLIC_DIRECTORY_NAME, "index.html")) &&
    existsSync(path.join(templatePath, DATA_DIRECTORY_NAME, "state.json")) &&
    existsSync(path.join(templatePath, "source", "package.json")) &&
    existsSync(path.join(templatePath, "skills", "add-todos", "SKILL.md"))
  );
}

export function resolveApplicationScaffoldTemplatePathForModuleDir(
  args: ResolveApplicationScaffoldTemplatePathArgs,
): string {
  const sourceTemplateCandidate = path.resolve(
    args.moduleDir,
    "../services/threads",
    APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME,
  );
  const bundledTemplateCandidate = path.resolve(
    args.moduleDir,
    APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME,
  );
  const candidates = [sourceTemplateCandidate, bundledTemplateCandidate];

  for (const candidate of candidates) {
    if (hasApplicationScaffoldTemplate(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Missing app scaffold template. Expected ${APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME} under one of: ${candidates.join(", ")}`,
  );
}

function resolveApplicationScaffoldTemplatePath(): string {
  return resolveApplicationScaffoldTemplatePathForModuleDir({
    moduleDir: routesModuleDir,
  });
}

function formatReadmeTitle(name: string): string {
  const title = name.replace(/\s+/gu, " ").trim();
  return title.length > 0 ? title : "bb Todo App";
}

function isFsErrorWithCode(error: Error, code: string): boolean {
  return "code" in error && error.code === code;
}

function parseApplicationId(rawApplicationId: string): ApplicationId {
  const parsed = applicationIdSchema.safeParse(rawApplicationId);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid applicationId");
  }
  return parsed.data;
}

function parseAppDataPath(rawPath: string): AppDataPath {
  const parsed = appDataPathSchema.safeParse(rawPath);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "Invalid app data path");
  }
  return parsed.data;
}

function applicationRouteSegment(applicationId: string): string {
  return `/apps/${encodeURIComponent(applicationId)}/`;
}

function applicationDataRouteSegment(applicationId: string): string {
  return `/apps/${encodeURIComponent(applicationId)}/data/`;
}

function parseAppDataRoutePath(rawPath: string): AppDataPath {
  return parseAppDataPath(
    parseSafeRelativeRoutePath({
      rawPath,
      dotfileSegmentPolicy: "allow",
      invalidPathMessage: "Invalid app data path",
    }).relativePath,
  );
}

function parseOptionalAppDataPrefix(
  rawPrefix: string | undefined,
): AppDataPath | "" {
  if (rawPrefix === undefined || rawPrefix === "") {
    return "";
  }
  return parseAppDataPath(rawPrefix);
}

function applicationRootForKind(args: ApplicationRootForKindArgs): string {
  if (args.rootKind === "app") {
    return resolveApplicationPath(args.dataDir, args.applicationId);
  }
  if (args.rootKind === "public") {
    return resolveApplicationPublicPath(args.dataDir, args.applicationId);
  }
  return resolveApplicationDataPath(args.dataDir, args.applicationId);
}

function parseApplicationStaticPath(rawPath: string): ApplicationStaticPath {
  return parseSafeRelativeRoutePath({
    rawPath,
    directoryIndexPath: "index.html",
    dotfileSegmentPolicy: "not-found",
    invalidPathMessage: "Invalid app static path",
  });
}

function summarizeAppManifestValidationIssues(
  issues: AppManifestValidationIssues,
): string {
  return issues
    .map((issue) => {
      const issuePath = issue.path.map(String).join(".");
      return `${issuePath || "<root>"}: ${issue.message}`;
    })
    .join("; ");
}

function logInvalidAppManifest(
  deps: AppManifestValidationLoggerDeps,
  args: LogInvalidAppManifestArgs,
): void {
  deps.logger.warn(
    {
      applicationId: args.error.applicationId,
      manifestPath: args.error.manifestPath,
      issueSummary: summarizeAppManifestValidationIssues(args.error.issues),
      issues: args.error.issues,
    },
    args.message,
  );
}

async function readApplicationRelativeFile(
  args: ReadApplicationRelativeFileArgs,
): Promise<Buffer> {
  const rootPath = applicationRootForKind(args);
  const filePath = path.join(rootPath, args.path);
  if (
    args.dotfiles === "deny" &&
    args.path.split("/").some((segment) => segment.startsWith("."))
  ) {
    throw new ApiError(404, "ENOENT", "App file not found");
  }
  const relativePath = path.relative(rootPath, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ApiError(400, "invalid_request", "Invalid app file path");
  }
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new ApiError(404, "ENOENT", "App file not found");
    }
    throw error;
  }
}

async function statApplicationRelativeFile(
  args: ReadApplicationRelativeFileArgs,
): Promise<Stats> {
  const rootPath = applicationRootForKind(args);
  const filePath = path.join(rootPath, args.path);
  const relativePath = path.relative(rootPath, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ApiError(400, "invalid_request", "Invalid app file path");
  }
  try {
    return await stat(filePath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new ApiError(404, "ENOENT", "App file not found");
    }
    throw error;
  }
}

async function ensureApplicationFolderExists(
  args: ApplicationManifestReadArgs,
): Promise<void> {
  try {
    const applicationStats = await stat(
      resolveApplicationPath(args.dataDir, args.applicationId),
    );
    if (!applicationStats.isDirectory()) {
      throw new InvalidAppManifestError({
        ...args,
        manifestPath: resolveApplicationManifestPath(
          args.dataDir,
          args.applicationId,
        ),
        issues: [],
      });
    }
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new ApiError(404, "app_missing", "App not found");
    }
    throw error;
  }
}

async function readApplicationManifest(
  args: ApplicationManifestReadArgs,
): Promise<AppManifest> {
  await ensureApplicationFolderExists(args);
  const manifestPath = resolveApplicationManifestPath(
    args.dataDir,
    args.applicationId,
  );
  let manifestContent: string;
  try {
    manifestContent = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new InvalidAppManifestError({
        ...args,
        manifestPath,
        issues: [],
      });
    }
    throw error;
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(manifestContent);
  } catch {
    throw new ApiError(
      422,
      "invalid_manifest",
      "App manifest is not valid JSON",
    );
  }
  const manifest = appManifestSchema.safeParse(parsedJson);
  if (!manifest.success) {
    throw new InvalidAppManifestError({
      ...args,
      manifestPath,
      issues: manifest.error.issues,
    });
  }
  if (manifest.data.id !== args.applicationId) {
    throw new ApiError(
      422,
      "invalid_manifest",
      "App manifest id must match its directory name",
    );
  }
  return manifest.data;
}

async function readApplicationManifestForRequest(
  deps: AppDeps,
  args: ApplicationManifestReadArgs,
): Promise<AppManifest> {
  try {
    return await readApplicationManifest(args);
  } catch (error) {
    if (error instanceof InvalidAppManifestError) {
      logInvalidAppManifest(deps, {
        error,
        message: "Rejected invalid global app manifest",
      });
    }
    throw error;
  }
}

function entryKindForPath(entryPath: string): AppEntry["kind"] {
  const normalized = entryPath.toLowerCase();
  if (normalized.endsWith(".html")) {
    return "html";
  }
  if (normalized.endsWith(".md")) {
    return "md";
  }
  throw new ApiError(
    422,
    "invalid_manifest",
    "App entry must end in .html or .md",
  );
}

async function resolveApplicationEntry(
  args: ApplicationManifestReadArgs & { manifest: AppManifest },
): Promise<AppEntry> {
  if (args.manifest.entry !== undefined) {
    return {
      path: args.manifest.entry,
      kind: entryKindForPath(args.manifest.entry),
    };
  }

  for (const candidate of ["index.html", "index.md"]) {
    try {
      await statApplicationRelativeFile({
        ...args,
        path: candidate,
        rootKind: "public",
        dotfiles: "deny",
      });
      return {
        path: candidate,
        kind: entryKindForPath(candidate),
      };
    } catch (error) {
      if (error instanceof ApiError && error.body.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  throw new ApiError(
    404,
    "ENOENT",
    "App entry not found: index.html or index.md",
  );
}

async function tryResolveLogo(
  args: ApplicationManifestReadArgs,
): Promise<LogoExtension | null> {
  let entries: Dirent[];
  try {
    entries = await readdir(
      resolveApplicationPath(args.dataDir, args.applicationId),
      {
        withFileTypes: true,
      },
    );
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
  const topLevelFiles = new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
  );
  for (const extension of LOGO_EXTENSIONS) {
    if (topLevelFiles.has(`logo.${extension}`)) {
      return extension;
    }
  }
  return null;
}

async function resolveApplicationIcon(
  args: ApplicationSummaryArgs,
): Promise<AppIcon> {
  if (args.manifest.icon !== undefined) {
    return { kind: "builtin", name: args.manifest.icon };
  }
  const logo = await tryResolveLogo(args);
  if (logo) {
    return {
      kind: "logo",
      url: `/api/v1/apps/${encodeURIComponent(args.applicationId)}/icon`,
    };
  }
  return { kind: "builtin", name: "GridView" };
}

async function buildApplicationSummary(
  args: ApplicationSummaryArgs,
): Promise<AppSummary> {
  const [entry, icon] = await Promise.all([
    resolveApplicationEntry(args),
    resolveApplicationIcon(args),
  ]);
  return {
    applicationId: args.manifest.id,
    name: args.manifest.name,
    entry,
    capabilities: args.manifest.capabilities,
    icon,
  };
}

async function buildApplicationDetail(
  deps: AppDeps,
  args: ApplicationManifestReadArgs,
): Promise<AppDetail> {
  const manifest = await readApplicationManifestForRequest(deps, args);
  return {
    ...(await buildApplicationSummary({
      ...args,
      manifest,
    })),
    appsRootPath: resolveAppsRootPath(args.dataDir),
    appRootPath: resolveApplicationPath(args.dataDir, args.applicationId),
    appDataPath: resolveApplicationDataPath(args.dataDir, args.applicationId),
  };
}

function isIgnoredApplicationStorageEntry(entryName: string): boolean {
  return entryName.startsWith(".tmp-") || entryName.startsWith(".delete-");
}

async function listGlobalApplications(
  deps: GlobalAppListDeps,
): Promise<AppSummary[]> {
  const appsRootPath = resolveAppsRootPath(deps.config.dataDir);
  let entries: Dirent[];
  try {
    entries = await readdir(appsRootPath, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const applicationIds = entries
    .filter(
      (entry) =>
        entry.isDirectory() && !isIgnoredApplicationStorageEntry(entry.name),
    )
    .map((entry) => applicationIdSchema.safeParse(entry.name))
    .filter((entry) => entry.success)
    .map((entry) => entry.data)
    .sort((left, right) => left.localeCompare(right));

  const summaries: AppSummary[] = [];
  for (const applicationId of applicationIds) {
    try {
      const manifest = await readApplicationManifest({
        dataDir: deps.config.dataDir,
        applicationId,
      });
      summaries.push(
        await buildApplicationSummary({
          dataDir: deps.config.dataDir,
          applicationId,
          manifest,
        }),
      );
    } catch (error) {
      if (error instanceof InvalidAppManifestError) {
        logInvalidAppManifest(deps, {
          error,
          message: "Skipping invalid global app manifest",
        });
        continue;
      }
      if (error instanceof ApiError && error.body.code === "invalid_manifest") {
        deps.logger.warn(
          {
            applicationId,
            appRootPath: resolveApplicationPath(
              deps.config.dataDir,
              applicationId,
            ),
            message: error.body.message,
          },
          "Skipping invalid global app manifest",
        );
        continue;
      }
      throw error;
    }
  }
  return summaries;
}

export async function notifyGlobalAppsChanged(
  deps: GlobalAppListDeps,
): Promise<void> {
  deps.hub.notifySystem(["apps-changed"]);
}

function createHtmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-type": HTML_CONTENT_TYPE,
      "x-content-type-options": CONTENT_TYPE_OPTIONS,
    },
  });
}

function buildAppWebSocketUrl(
  deps: LoggedWorkSessionDeps,
  requestUrl: string,
): string {
  if (deps.config.isDevelopment) {
    return `ws://localhost:${deps.config.serverPort}/ws`;
  }
  const url = new URL(requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createInjectedAppHtmlResponse(
  deps: LoggedWorkSessionDeps,
  args: CreateInjectedAppHtmlResponseArgs,
): Response {
  return createHtmlResponse(
    injectAppClientScript(args.html, {
      appId: args.applicationId,
      applicationId: args.applicationId,
      appSessionToken: args.appSessionToken,
      capabilities: args.capabilities,
      targetThreadId: args.targetThreadId,
      dataUrl: `/api/v1/apps/${encodeURIComponent(args.applicationId)}/data`,
      messageUrl: `/api/v1/apps/${encodeURIComponent(
        args.applicationId,
      )}/message`,
      wsUrl: buildAppWebSocketUrl(deps, args.requestUrl),
    }),
  );
}

function createAppSessionStore(): AppSessionStore {
  const sessions = new Map<AppSessionToken, AppSession>();
  return {
    create(args) {
      const token = `${APP_SESSION_TOKEN_PREFIX}${randomUUID().replaceAll(
        "-",
        "",
      )}`;
      sessions.set(token, args);
      return token;
    },
    get(token) {
      return sessions.get(token) ?? null;
    },
  };
}

function maybeCreateAppSession(
  deps: AppDeps,
  sessions: AppSessionStore,
  applicationId: ApplicationId,
  rawTargetThreadId: string | undefined,
): AppSessionToken | null {
  if (rawTargetThreadId === undefined || rawTargetThreadId.trim() === "") {
    return null;
  }
  const thread = requirePublicThread(deps.db, rawTargetThreadId);
  return sessions.create({
    applicationId,
    projectId: thread.projectId,
    threadId: thread.id,
  });
}

async function serveApplicationEntry(
  deps: AppDeps,
  sessions: AppSessionStore,
  rawApplicationId: string,
  requestUrl: string,
  rawTargetThreadId: string | undefined,
): Promise<Response> {
  const applicationId = parseApplicationId(rawApplicationId);
  const manifest = await readApplicationManifestForRequest(deps, {
    dataDir: deps.config.dataDir,
    applicationId,
  });
  const entry = await resolveApplicationEntry({
    dataDir: deps.config.dataDir,
    applicationId,
    manifest,
  });
  if (entry.kind !== "html") {
    throw new ApiError(404, "invalid_request", "App entry is not HTML");
  }
  const metadata = await statApplicationRelativeFile({
    dataDir: deps.config.dataDir,
    applicationId,
    rootKind: "public",
    path: entry.path,
    dotfiles: "deny",
  });
  if (metadata.size > HTML_ENTRY_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "App HTML entry exceeds the 5 MB limit",
      false,
    );
  }
  const result = await readApplicationRelativeFile({
    dataDir: deps.config.dataDir,
    applicationId,
    rootKind: "public",
    path: entry.path,
    dotfiles: "deny",
  });
  const token = maybeCreateAppSession(
    deps,
    sessions,
    applicationId,
    rawTargetThreadId,
  );
  return createInjectedAppHtmlResponse(deps, {
    applicationId,
    requestUrl,
    targetThreadId: rawTargetThreadId ?? null,
    appSessionToken: token,
    html: result.toString("utf8"),
    capabilities: manifest.capabilities,
  });
}

function isPrivateApplicationStaticPath(
  staticPath: ApplicationStaticPath,
): boolean {
  const [topLevelSegment] = staticPath.relativePath.split("/");
  return (
    topLevelSegment === MANIFEST_FILE_NAME ||
    topLevelSegment === DATA_DIRECTORY_NAME
  );
}

async function readApplicationStaticFile(
  args: ReadApplicationStaticFileArgs,
): Promise<ApplicationStaticFile> {
  if (isPrivateApplicationStaticPath(args.staticPath)) {
    throw new ApiError(404, "ENOENT", "App file not found");
  }

  return {
    path: args.staticPath.relativePath,
    bytes: await readApplicationRelativeFile({
      dataDir: args.dataDir,
      applicationId: args.applicationId,
      rootKind: "public",
      path: args.staticPath.relativePath,
      dotfiles: "deny",
    }),
  };
}

async function serveApplicationStaticFile(
  args: ServeApplicationStaticFileArgs,
): Promise<Response> {
  const applicationId = parseApplicationId(args.rawApplicationId);
  const staticPath = parseApplicationStaticPath(args.rawPath);
  await readApplicationManifestForRequest(args.deps, {
    dataDir: args.deps.config.dataDir,
    applicationId,
  });
  const result = await readApplicationStaticFile({
    dataDir: args.deps.config.dataDir,
    applicationId,
    staticPath,
  });
  const contentType =
    mimeTypes.lookup(result.path) || "application/octet-stream";
  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-type": contentType,
      "x-content-type-options": CONTENT_TYPE_OPTIONS,
    },
  });
}

async function serveApplicationIcon(
  deps: AppDeps,
  rawApplicationId: string,
): Promise<Response> {
  const applicationId = parseApplicationId(rawApplicationId);
  const manifest = await readApplicationManifestForRequest(deps, {
    dataDir: deps.config.dataDir,
    applicationId,
  });
  if (manifest.icon !== undefined) {
    throw new ApiError(404, "ENOENT", "App uses a built-in icon");
  }
  const logo = await tryResolveLogo({
    dataDir: deps.config.dataDir,
    applicationId,
  });
  if (!logo) {
    throw new ApiError(404, "ENOENT", "App logo not found");
  }
  const logoPath = `logo.${logo}`;
  const metadata = await statApplicationRelativeFile({
    dataDir: deps.config.dataDir,
    applicationId,
    rootKind: "app",
    path: logoPath,
    dotfiles: "deny",
  });
  if (metadata.size > LOGO_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "App logo exceeds the 1 MB limit",
      false,
    );
  }
  const result = await readApplicationRelativeFile({
    dataDir: deps.config.dataDir,
    applicationId,
    rootKind: "app",
    path: logoPath,
    dotfiles: "deny",
  });
  const contentType = mimeTypes.lookup(logoPath) || "application/octet-stream";
  return new Response(new Uint8Array(result), {
    status: 200,
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-type": contentType,
      "x-content-type-options": CONTENT_TYPE_OPTIONS,
    },
  });
}

async function readApplicationDataEntry(
  args: ReadApplicationDataEntryArgs,
): Promise<AppDataEntry> {
  const filePath = path.join(
    resolveApplicationDataPath(args.dataDir, args.applicationId),
    ...args.dataPath.split("/"),
  );
  let bytes: Buffer;
  let metadata: Stats;
  try {
    [bytes, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new ApiError(404, "ENOENT", `App data not found: ${args.dataPath}`);
    }
    throw error;
  }
  let value: JsonValue;
  try {
    value = jsonValueSchema.parse(JSON.parse(bytes.toString("utf8")));
  } catch {
    throw new ApiError(
      422,
      "invalid_json",
      `App data path ${args.dataPath} does not contain valid JSON`,
    );
  }
  return {
    path: args.dataPath,
    value,
    version: sha256(bytes),
    sizeBytes: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
  };
}

async function listAppDataFilePaths(
  appDataRoot: string,
  currentDirectory: string,
): Promise<AppDataPath[]> {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const paths: AppDataPath[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listAppDataFilePaths(appDataRoot, entryPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const relativePath = path
      .relative(appDataRoot, entryPath)
      .split(path.sep)
      .join("/");
    const parsed = appDataPathSchema.safeParse(relativePath);
    if (parsed.success) {
      paths.push(parsed.data);
    }
  }
  return paths.sort((left, right) => left.localeCompare(right));
}

async function listApplicationDataEntries(
  args: ListApplicationDataEntriesArgs,
): Promise<AppDataEntry[]> {
  if (args.dataPath !== "") {
    try {
      return [
        await readApplicationDataEntry({
          applicationId: args.applicationId,
          dataPath: args.dataPath,
          dataDir: args.dataDir,
        }),
      ];
    } catch (error) {
      if (!(error instanceof ApiError && error.body.code === "ENOENT")) {
        throw error;
      }
    }
  }

  const appDataRoot = resolveApplicationDataPath(
    args.dataDir,
    args.applicationId,
  );
  const listRoot = args.dataPath
    ? path.join(appDataRoot, args.dataPath)
    : appDataRoot;
  let dataPaths: AppDataPath[];
  try {
    dataPaths = await listAppDataFilePaths(appDataRoot, listRoot);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  return Promise.all(
    dataPaths.map((dataPath) =>
      readApplicationDataEntry({
        applicationId: args.applicationId,
        dataDir: args.dataDir,
        dataPath,
      }),
    ),
  );
}

async function writeApplicationDataEntry(
  args: WriteApplicationDataEntryArgs,
): Promise<AppDataEntry> {
  const content = canonicalizeJson(args.value);
  const appDataRoot = resolveApplicationDataPath(
    args.dataDir,
    args.applicationId,
  );
  const filePath = path.join(appDataRoot, ...args.dataPath.split("/"));
  const relativePath = path.relative(appDataRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ApiError(400, "invalid_request", "Invalid app data path");
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return readApplicationDataEntry(args);
}

async function deleteApplicationDataEntry(
  args: ReadApplicationDataEntryArgs,
): Promise<void> {
  const appDataRoot = resolveApplicationDataPath(
    args.dataDir,
    args.applicationId,
  );
  const filePath = path.join(appDataRoot, ...args.dataPath.split("/"));
  const relativePath = path.relative(appDataRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new ApiError(400, "invalid_request", "Invalid app data path");
  }
  try {
    await rm(filePath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new ApiError(404, "ENOENT", `App data not found: ${args.dataPath}`);
    }
    throw error;
  }
}

function createTempNonce(): string {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}

function deriveCreateApplicationId(payload: CreateAppRequest): ApplicationId {
  if (payload.applicationId !== undefined) {
    return payload.applicationId;
  }
  if (payload.name !== undefined) {
    try {
      return deriveApplicationIdFromName(payload.name);
    } catch {
      throw new ApiError(
        400,
        "invalid_request",
        "App name cannot be converted to a valid applicationId",
      );
    }
  }
  throw new ApiError(400, "invalid_request", "Provide applicationId or name");
}

function resolveCreateApplicationName(
  payload: CreateAppRequest,
  applicationId: ApplicationId,
): string {
  return payload.name === undefined || payload.name.trim().length === 0
    ? applicationId
    : payload.name;
}

async function createApplicationTempRoot(
  args: CreateApplicationTempRootArgs,
): Promise<string> {
  const tempRootPath = path.join(
    args.appsRootPath,
    `.tmp-${args.applicationId}-${createTempNonce()}`,
  );
  await mkdir(tempRootPath, { recursive: false });
  return tempRootPath;
}

async function patchApplicationScaffoldReadme(
  args: PatchApplicationScaffoldReadmeArgs,
): Promise<void> {
  const readmePath = path.join(args.tempRootPath, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(
    readmePath,
    readme.replaceAll(
      APP_SCAFFOLD_README_PLACEHOLDER,
      formatReadmeTitle(args.name),
    ),
    "utf8",
  );
}

async function copyApplicationScaffoldSourceDirectory(
  args: CopyApplicationScaffoldSourceDirectoryArgs,
): Promise<void> {
  await mkdir(args.targetPath, { recursive: true });
  const entries = await readdir(args.sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(args.sourcePath, entry.name);
    if (
      !shouldCopyApplicationScaffoldTemplatePath({
        sourcePath,
        templatePath: args.templatePath,
      })
    ) {
      continue;
    }
    await cp(sourcePath, path.join(args.targetPath, entry.name), {
      recursive: true,
      force: false,
      mode: APP_SCAFFOLD_COPY_MODE,
    });
  }
}

async function copyApplicationScaffoldTemplate(
  args: CopyApplicationScaffoldTemplateArgs,
): Promise<void> {
  const entries = await readdir(args.templatePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(args.templatePath, entry.name);
    const targetPath = path.join(args.tempRootPath, entry.name);
    if (
      entry.isDirectory() &&
      entry.name === APP_SCAFFOLD_SOURCE_DIRECTORY_NAME
    ) {
      await copyApplicationScaffoldSourceDirectory({
        sourcePath,
        targetPath,
        templatePath: args.templatePath,
      });
      continue;
    }
    await cp(sourcePath, targetPath, {
      recursive: true,
      force: false,
      mode: APP_SCAFFOLD_COPY_MODE,
    });
  }
}

async function writeInitialApplicationFiles(
  args: WriteInitialApplicationFilesArgs,
): Promise<void> {
  const manifest: AppManifest = {
    manifestVersion: 1,
    id: args.applicationId,
    name: args.name,
    entry: "index.html",
    capabilities: ["data", "message"],
  };
  const templatePath = resolveApplicationScaffoldTemplatePath();
  await copyApplicationScaffoldTemplate({
    templatePath,
    tempRootPath: args.tempRootPath,
  });
  await writeFile(
    path.join(args.tempRootPath, MANIFEST_FILE_NAME),
    canonicalizeJson(manifest),
    "utf8",
  );
  await patchApplicationScaffoldReadme({
    tempRootPath: args.tempRootPath,
    name: args.name,
  });
  appManifestSchema.parse(
    JSON.parse(
      await readFile(path.join(args.tempRootPath, MANIFEST_FILE_NAME), "utf8"),
    ),
  );
}

async function publishApplicationTempRoot(
  args: PublishApplicationTempRootArgs,
): Promise<PublishApplicationTempRootResult> {
  try {
    await stat(args.applicationPath);
    return "collision";
  } catch (error) {
    if (!(error instanceof Error) || !isFsErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }
  try {
    await rename(args.tempRootPath, args.applicationPath);
    return "published";
  } catch (error) {
    if (
      error instanceof Error &&
      (isFsErrorWithCode(error, "EEXIST") ||
        isFsErrorWithCode(error, "ENOTEMPTY"))
    ) {
      return "collision";
    }
    throw error;
  }
}

async function createGlobalApplication(
  args: CreateGlobalApplicationArgs,
): Promise<ApplicationId> {
  const appsRootPath = resolveAppsRootPath(args.dataDir);
  await mkdir(appsRootPath, { recursive: true });

  const applicationPath = resolveApplicationPath(
    args.dataDir,
    args.applicationId,
  );
  let tempRootPath: string | null = null;
  try {
    tempRootPath = await createApplicationTempRoot({
      appsRootPath,
      applicationId: args.applicationId,
    });
    await writeInitialApplicationFiles({
      tempRootPath,
      applicationId: args.applicationId,
      name: args.name,
    });
    const result = await publishApplicationTempRoot({
      applicationPath,
      tempRootPath,
    });
    if (result === "collision") {
      await rm(tempRootPath, { recursive: true, force: true });
      tempRootPath = null;
      throw new ApiError(
        409,
        "app_exists",
        `an app with id "${args.applicationId}" already exists`,
      );
    }
    return args.applicationId;
  } catch (error) {
    if (tempRootPath !== null) {
      await rm(tempRootPath, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      500,
      "scaffold_failed",
      error instanceof Error ? error.message : "Failed to scaffold app",
    );
  }
}

async function deleteGlobalApplication(
  dataDir: string,
  applicationId: ApplicationId,
): Promise<DeleteGlobalApplicationResult> {
  const applicationPath = resolveApplicationPath(dataDir, applicationId);
  try {
    await stat(applicationPath);
  } catch (error) {
    if (error instanceof Error && isFsErrorWithCode(error, "ENOENT")) {
      throw new ApiError(404, "app_missing", "App not found");
    }
    throw error;
  }
  const tombstonePath = path.join(
    resolveAppsRootPath(dataDir),
    `.delete-${applicationId}-${createTempNonce()}`,
  );
  try {
    await rename(applicationPath, tombstonePath);
  } catch (error) {
    throw new ApiError(
      500,
      "delete_failed",
      error instanceof Error ? error.message : "Failed to delete app",
    );
  }
  try {
    await rm(tombstonePath, { recursive: true, force: true });
    return "deleted";
  } catch {
    return "partial";
  }
}

function formatAppMessagePayload(payload: JsonValue): string {
  return typeof payload === "string"
    ? payload
    : JSON.stringify(payload, null, 2);
}

function resolveAppMessageTarget(
  deps: AppDeps,
  args: ResolveAppMessageTargetArgs,
): AppSession {
  const token =
    args.payload.appSessionToken === undefined
      ? null
      : args.sessions.get(args.payload.appSessionToken);
  if (args.payload.appSessionToken !== undefined && token === null) {
    throw new ApiError(403, "forbidden", "Invalid app session token");
  }
  if (token !== null && token.applicationId !== args.applicationId) {
    throw new ApiError(
      403,
      "forbidden",
      "App session token does not match app",
    );
  }
  if (args.payload.targetThreadId !== undefined) {
    const thread = requirePublicThread(deps.db, args.payload.targetThreadId);
    if (token !== null && token.threadId !== thread.id) {
      throw new ApiError(403, "forbidden", "App message target mismatch");
    }
    return {
      applicationId: args.applicationId,
      threadId: thread.id,
      projectId: thread.projectId,
    };
  }
  if (token !== null) {
    return token;
  }
  throw new ApiError(
    400,
    "message_target_required",
    "App message requires an app session token or targetThreadId",
  );
}

export function registerGlobalAppRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, put, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const appSessions = createAppSessionStore();

  get("/apps", async (context) =>
    context.json(await listGlobalApplications(deps)),
  );

  post("/apps", createAppRequestSchema, async (context, payload) => {
    const applicationId = deriveCreateApplicationId(payload);
    const createdApplicationId = await createGlobalApplication({
      applicationId,
      dataDir: deps.config.dataDir,
      name: resolveCreateApplicationName(payload, applicationId),
    });
    const detail = await buildApplicationDetail(deps, {
      dataDir: deps.config.dataDir,
      applicationId: createdApplicationId,
    });
    await notifyGlobalAppsChanged(deps);
    return context.json(detail, 201);
  });

  get("/apps/:applicationId", async (context) => {
    const applicationId = parseApplicationId(
      context.req.param("applicationId"),
    );
    return context.json(
      await buildApplicationDetail(deps, {
        dataDir: deps.config.dataDir,
        applicationId,
      }),
    );
  });

  del("/apps/:applicationId", async (context) => {
    const applicationId = parseApplicationId(
      context.req.param("applicationId"),
    );
    const result = await deleteGlobalApplication(
      deps.config.dataDir,
      applicationId,
    );
    await notifyGlobalAppsChanged(deps);
    if (result === "partial") {
      throw new ApiError(
        500,
        "delete_partial",
        "App was removed from normal lists, but tombstone cleanup failed",
      );
    }
    return context.json({ ok: true });
  });

  get(
    "/apps/:applicationId/data",
    appDataListQuerySchema,
    async (context, query) => {
      const applicationId = parseApplicationId(
        context.req.param("applicationId"),
      );
      await readApplicationManifestForRequest(deps, {
        dataDir: deps.config.dataDir,
        applicationId,
      });
      const dataPath = parseOptionalAppDataPrefix(query.prefix);
      return context.json({
        entries: await listApplicationDataEntries({
          dataDir: deps.config.dataDir,
          applicationId,
          dataPath,
        }),
      });
    },
  );

  post(
    "/apps/:applicationId/message",
    appMessageRequestSchema,
    async (context, payload) => {
      const applicationId = parseApplicationId(
        context.req.param("applicationId"),
      );
      await readApplicationManifestForRequest(deps, {
        dataDir: deps.config.dataDir,
        applicationId,
      });
      const target = resolveAppMessageTarget(deps, {
        applicationId,
        payload,
        sessions: appSessions,
      });
      const thread = requirePublicThread(deps.db, target.threadId);
      const environment = await requireThreadCommandEnvironment(deps, {
        thread,
      });
      await sendThreadMessage(deps, {
        environment,
        thread,
        trigger: "user",
        payload: {
          input: [
            {
              type: "text",
              text: formatAppMessagePayload(payload.payload),
            },
          ],
          mode: "auto",
        },
      });
      return context.json({ ok: true }, 202);
    },
  );

  app.get("/apps/:applicationId/", async (context) =>
    serveApplicationEntry(
      deps,
      appSessions,
      context.req.param("applicationId"),
      context.req.url,
      context.req.query("targetThreadId"),
    ),
  );

  app.get("/apps/:applicationId/icon", async (context) =>
    serveApplicationIcon(deps, context.req.param("applicationId")),
  );

  get("/apps/:applicationId/data/*", async (context) => {
    const applicationId = parseApplicationId(
      context.req.param("applicationId"),
    );
    await readApplicationManifestForRequest(deps, {
      dataDir: deps.config.dataDir,
      applicationId,
    });
    const dataPath = parseAppDataRoutePath(
      extractRoutePath({
        requestUrl: context.req.url,
        routeSegment: applicationDataRouteSegment(applicationId),
      }),
    );
    const entry = await readApplicationDataEntry({
      dataDir: deps.config.dataDir,
      applicationId,
      dataPath,
    });
    const response = context.json(entry);
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    response.headers.set("etag", `"${entry.version}"`);
    return response;
  });

  put(
    "/apps/:applicationId/data/*",
    appDataWriteRequestSchema,
    async (context, payload) => {
      const applicationId = parseApplicationId(
        context.req.param("applicationId"),
      );
      await readApplicationManifestForRequest(deps, {
        dataDir: deps.config.dataDir,
        applicationId,
      });
      const dataPath = parseAppDataRoutePath(
        extractRoutePath({
          requestUrl: context.req.url,
          routeSegment: applicationDataRouteSegment(applicationId),
        }),
      );
      const entry = await writeApplicationDataEntry({
        dataDir: deps.config.dataDir,
        applicationId,
        dataPath,
        value: payload.value,
      });
      const response = context.json(entry);
      response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
      response.headers.set("etag", `"${entry.version}"`);
      return response;
    },
  );

  del("/apps/:applicationId/data/*", async (context) => {
    const applicationId = parseApplicationId(
      context.req.param("applicationId"),
    );
    await readApplicationManifestForRequest(deps, {
      dataDir: deps.config.dataDir,
      applicationId,
    });
    const dataPath = parseAppDataRoutePath(
      extractRoutePath({
        requestUrl: context.req.url,
        routeSegment: applicationDataRouteSegment(applicationId),
      }),
    );
    await deleteApplicationDataEntry({
      dataDir: deps.config.dataDir,
      applicationId,
      dataPath,
    });
    const response = context.json({ ok: true });
    response.headers.set("cache-control", NO_STORE_CACHE_CONTROL);
    return response;
  });

  app.get("/apps/:applicationId/*", async (context) => {
    const applicationId = context.req.param("applicationId");
    return serveApplicationStaticFile({
      deps,
      rawApplicationId: applicationId,
      rawPath: extractRoutePath({
        requestUrl: context.req.url,
        routeSegment: applicationRouteSegment(applicationId),
      }),
    });
  });
}
