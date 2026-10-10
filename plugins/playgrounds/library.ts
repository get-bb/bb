import { createHash, randomBytes, randomUUID } from "node:crypto";
import { posix, win32 } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  answerFromPackage,
  checkActionArgs,
  ASSETS_RENDERER_VERSION,
  makeScreenshot,
  manifestSchema,
  MAX_SCREENSHOTS,
  packageFromAnswer,
  parsePackage,
  serializePackage,
  type AppPackage,
  type Manifest,
  type PackageAssets,
  versionLabel,
} from "./app-package.js";
import { htmlAnswerSchema, parseDocument, type Answer } from "./model.js";
import { diffText } from "./diff.js";
import {
  LICENSES,
  catalogIdSchema,
  compareVersions,
  screenshotPath,
  nextMinor,
  packagePath,
  type CatalogIndex,
  type CatalogListing,
} from "./catalog-format.js";
import type { createLive, Surface } from "./live.js";
import type { AssetStore } from "./assets.js";

type Db = ReturnType<BbPluginApi["storage"]["database"]>;
type Live = ReturnType<typeof createLive>;

export const LIBRARY_MIGRATIONS = [
  "CREATE TABLE library_apps (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, selected_version_id TEXT NOT NULL, revision INTEGER NOT NULL, origin_kind TEXT NOT NULL, origin_ref TEXT, publish_catalog_id TEXT, published_version TEXT, published_digest TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, trashed_at INTEGER)",
  "CREATE UNIQUE INDEX library_apps_catalog ON library_apps(origin_ref) WHERE origin_kind = 'catalog'",
  "CREATE UNIQUE INDEX library_apps_publish ON library_apps(publish_catalog_id) WHERE publish_catalog_id IS NOT NULL",
  "CREATE TABLE library_versions (id TEXT PRIMARY KEY, app_id TEXT NOT NULL, label TEXT NOT NULL, package TEXT NOT NULL, digest TEXT NOT NULL, bytes INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE (app_id, label))",
  "CREATE TABLE library_runs (answer_id TEXT NOT NULL, thread_id TEXT NOT NULL, app_id TEXT NOT NULL, version_id TEXT NOT NULL, origin TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'run', inherited INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, PRIMARY KEY (answer_id, thread_id))",
  "CREATE INDEX library_runs_resume ON library_runs(app_id, thread_id, created_at)",
  "CREATE INDEX library_runs_thread ON library_runs(thread_id)",
  "CREATE TABLE library_operations (request_id TEXT PRIMARY KEY, op TEXT NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, thread_id TEXT, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX library_operations_thread ON library_operations(thread_id)",
  "CREATE INDEX library_operations_expiry ON library_operations(expires_at)",
  "CREATE TABLE library_drafts (app_id TEXT PRIMARY KEY, base_version_id TEXT NOT NULL, package TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE TABLE library_releases (id TEXT PRIMARY KEY, app_id TEXT NOT NULL, version_id TEXT NOT NULL, catalog_id TEXT NOT NULL, version_label TEXT NOT NULL, digest TEXT NOT NULL, changelog TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, catalog_revision TEXT, pr_url TEXT, note TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  "CREATE INDEX library_releases_app ON library_releases(app_id, created_at)",
  "CREATE UNIQUE INDEX library_releases_version ON library_releases(catalog_id, version_label)",
];

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const PRUNE_BATCH = 200;
const RECONCILE_BATCH = 50;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const VERSION_META_MIGRATIONS = [
  "ALTER TABLE library_versions ADD COLUMN meta TEXT",
  "UPDATE library_versions SET meta = json_object('contentKind', json_extract(package, '$.content.kind'), 'agentActions', json_extract(package, '$.actions.mode'), 'author', json(COALESCE(json_extract(package, '$.author'), json_extract(package, '$.origin.author'))), 'license', COALESCE(json_extract(package, '$.license'), json_extract(package, '$.origin.license')))",
];

export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  const ms = BigInt(now);
  for (let i = 0; i < 6; i++)
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requestTime(requestId: string, now: number): number {
  const id = requestId.toLowerCase();
  if (!UUID_V7.test(id)) throw new Error("Request IDs must be UUIDv7 values.");
  const at = Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16);
  if (at < now - RETENTION_MS)
    throw new Error(
      "This request ID has expired (older than 30 days). Nothing was run; use a new request ID only for a genuinely new request.",
    );
  if (at > now + FUTURE_SKEW_MS)
    throw new Error(
      "This request ID is dated in the future. Generate it from the current time.",
    );
  return at;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

export class LibraryError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "conflict"
      | "unavailable"
      | "verification_pending"
      | "invalid"
      | "request_reused",
    message: string,
  ) {
    super(message);
  }
}

type AppRow = {
  id: string;
  name: string;
  description: string;
  selected_version_id: string;
  revision: number;
  origin_kind: "local" | "import" | "remix" | "catalog";
  origin_ref: string | null;
  publish_catalog_id: string | null;
  published_version: string | null;
  published_digest: string | null;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
};
type VersionMeta = {
  contentKind: "html" | "document";
  agentActions: Manifest["mode"];
  author: { name: string; url?: string } | null;
  license: string | null;
};
type VersionRow = {
  id: string;
  app_id: string;
  label: string;
  package: string;
  digest: string;
  bytes: number;
  created_at: number;
};
type RunRow = {
  answer_id: string;
  thread_id: string;
  app_id: string;
  version_id: string;
  origin: string;
  kind: "run" | "preview";
  inherited: number;
  created_at: number;
};
export type RunOrigin = {
  appName: string;
  versionLabel: string;
  digest: string;
  title: string;
  manifest?: Manifest;
};
type OperationRow = {
  request_id: string;
  op: string;
  digest: string;
  status: "pending" | "done" | "unknown" | "tombstone";
  result: string | null;
  thread_id: string | null;
};

export type ThreadCheck = "live" | "deleted" | "unknown";

export type OpenResult = {
  requestId: string;
  runId: string;
  appId: string;
  versionId: string;
  versionLabel: string;
  selectedVersionId: string;
  selectedVersionLabel: string;
  threadId: string;
  resumed: boolean;
  directive: string;
  readiness: "not-mounted" | "mounted";
};

export type InvokeResult = {
  requestId: string;
  runId: string;
  threadId: string;
  action: string;
  clientId: string;
  surface: Surface;
  status: "succeeded" | "failed" | "unknown";
  value?: unknown;
  error?: string;
  replayed: boolean;
  untrusted: true;
  notice?: string;
};

const SURFACE_LABEL: Record<Surface, string> = {
  card: "Playground card",
  panel: "App panel",
};

export type CatalogView = {
  configured(): boolean;
  revision(): string | null;
  contributing(): string | null;
  listing(catalogId: string): CatalogListing | null;
};

type DraftRow = {
  app_id: string;
  base_version_id: string;
  package: string;
  revision: number;
  updated_at: number;
};
type ReleaseRow = {
  id: string;
  app_id: string;
  version_id: string;
  catalog_id: string;
  version_label: string;
  digest: string;
  changelog: string;
  kind: "initial" | "update";
  status: "prepared" | "submitted" | "published" | "failed" | "superseded";
  catalog_revision: string | null;
  pr_url: string | null;
  note: string | null;
  created_at: number;
  updated_at: number;
};
export type DraftEdit = {
  packageText?: string;
  html?: string;
  title?: string;
  summary?: string;
  width?: number | null;
  documentJson?: string;
  actionsJson?: string;
  fromAnswer?: { answerId: string; threadId: string };
  addScreenshot?: { data: string; alt: string };
  removeScreenshot?: string;
};

const screenshotMeta = (pkg: AppPackage) =>
  (pkg.screenshots ?? []).map((shot) => ({
    name: shot.name,
    type: shot.type,
    sha256: shot.sha256,
    width: shot.width,
    height: shot.height,
    bytes: shot.bytes,
    alt: shot.alt,
  }));
const withoutScreenshotData = (pkg: AppPackage): AppPackage => {
  const view: AppPackage = { ...pkg };
  delete view.screenshots;
  return view;
};

const MAX_DIFF_CHARS = 200_000;
const capDiff = (diff: string) =>
  diff.length <= MAX_DIFF_CHARS
    ? diff
    : `${diff.slice(0, MAX_DIFF_CHARS)}\n… diff truncated; download the package to review everything.`;

function sourceText(pkg: AppPackage) {
  return [
    `title: ${pkg.title}`,
    `summary: ${pkg.summary}`,
    `author: ${pkg.author ? `${pkg.author.name}${pkg.author.url ? ` <${pkg.author.url}>` : ""}` : ""}`,
    `license: ${pkg.license ?? ""}`,
    ...(pkg.content.kind === "html" && pkg.content.playground.width
      ? [`width: ${pkg.content.playground.width}`]
      : []),
    ...(pkg.assets
      ? [
          "assets:",
          ...Object.entries(pkg.assets.imports).map(
            ([specifier, name]) => `  import ${specifier} -> ${name}`,
          ),
          ...Object.entries(pkg.assets.files).map(
            ([name, file]) =>
              `  ${name}: ${file.bytes} bytes, sha256 ${file.sha256}, ${file.source.package} (${file.source.license})`,
          ),
        ]
      : []),
    ...(pkg.screenshots?.length
      ? [
          "screenshots:",
          ...pkg.screenshots.map(
            (shot) =>
              `  ${shot.name}: ${shot.width}x${shot.height} ${shot.type}, ${shot.bytes} bytes, sha256 ${shot.sha256}, alt "${shot.alt}"`,
          ),
        ]
      : []),
    "actions:",
    ...JSON.stringify(pkg.actions, null, 2).split("\n"),
    "source:",
    ...(pkg.content.kind === "html"
      ? pkg.content.playground.html.split("\n")
      : JSON.stringify(pkg.content.document, null, 2).split("\n")),
  ].join("\n");
}

const COMPACT_DIFF_CHARS = 20_000;
export function compactDraft<
  T extends {
    package: AppPackage;
    diff: string;
  },
>(view: T | null) {
  if (!view) return null;
  const { package: pkg, diff, ...rest } = view;
  return {
    ...rest,
    title: pkg.title,
    contentKind: pkg.content.kind,
    bytes: Buffer.byteLength(JSON.stringify(pkg), "utf8"),
    diff:
      diff.length <= COMPACT_DIFF_CHARS
        ? diff
        : `${diff.slice(0, COMPACT_DIFF_CHARS)}\n… diff truncated; use \`apps draft show --package\` for the full draft.`,
  };
}

export type LibraryStore = {
  resolve(threadId: string, id: string): Promise<string>;
  get(threadId: string, id: string): Answer;
};

export function createLibrary({
  bb,
  db,
  store,
  live,
  catalog,
  assets,
  now = Date.now,
}: {
  bb: BbPluginApi;
  db: Db;
  store: LibraryStore;
  live: Live;
  catalog: CatalogView;
  assets: AssetStore;
  now?: () => number;
}) {
  const appRow = (id: string) =>
    db.prepare("SELECT * FROM library_apps WHERE id = ?").get(id) as
      | AppRow
      | undefined;
  const versionRow = (id: string) =>
    db.prepare("SELECT * FROM library_versions WHERE id = ?").get(id) as
      | VersionRow
      | undefined;
  const versionsOf = (appId: string) =>
    db
      .prepare(
        "SELECT id, label, digest, bytes, created_at FROM library_versions WHERE app_id = ? ORDER BY created_at, rowid",
      )
      .all(appId) as Omit<VersionRow, "app_id" | "package">[];
  const versionMeta = (id: string) => {
    const row = db
      .prepare("SELECT id, label, meta FROM library_versions WHERE id = ?")
      .get(id) as { id: string; label: string; meta: string };
    return {
      id: row.id,
      label: row.label,
      ...(JSON.parse(row.meta) as VersionMeta),
    };
  };
  const requireApp = (id: string) => {
    const app = appRow(id);
    if (!app) throw new LibraryError("not_found", `No app ${id} in My apps.`);
    return app;
  };
  const requireVersion = (app: AppRow, versionId?: string) => {
    const version = versionRow(versionId ?? app.selected_version_id);
    if (!version || version.app_id !== app.id)
      throw new LibraryError(
        "not_found",
        `App ${app.id} has no version ${versionId}.`,
      );
    return version;
  };
  const packageOf = (version: VersionRow) => parsePackage(version.package).pkg;

  const prune = () => {
    db.prepare(
      "DELETE FROM library_operations WHERE request_id IN (SELECT request_id FROM library_operations WHERE expires_at < ? AND status <> 'pending' LIMIT ?)",
    ).run(now(), PRUNE_BATCH);
  };
  const operation = (requestId: string) =>
    db
      .prepare("SELECT * FROM library_operations WHERE request_id = ?")
      .get(requestId) as OperationRow | undefined;
  const recordOperation = (
    requestId: string,
    at: number,
    op: string,
    digest: string,
    status: OperationRow["status"],
    result: unknown,
    threadId: string | null,
  ) => {
    db.prepare(
      "INSERT INTO library_operations (request_id, op, digest, status, result, thread_id, expires_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO UPDATE SET status = excluded.status, result = excluded.result, updated_at = excluded.updated_at",
    ).run(
      requestId,
      op,
      digest,
      status,
      result === undefined ? null : JSON.stringify(result),
      threadId,
      at + RETENTION_MS,
      now(),
    );
    prune();
  };
  const begin = (op: string, requestId: string | undefined, args: unknown) => {
    const id = (requestId ?? uuidv7(now())).toLowerCase();
    const at = requestTime(id, now());
    const digest = sha256(JSON.stringify({ op, args }));
    const existing = operation(id);
    if (existing && (existing.op !== op || existing.digest !== digest))
      throw new LibraryError(
        "request_reused",
        "This request ID was already used for a different request.",
      );
    return { id, at, digest, existing };
  };
  const claim = (id: string, op: string, digest: string) => {
    const raced = operation(id);
    if (raced && (raced.op !== op || raced.digest !== digest))
      throw new LibraryError(
        "request_reused",
        "This request ID was already used for a different request.",
      );
    return raced;
  };
  const idempotent = <T>(
    op: string,
    requestId: string | undefined,
    args: unknown,
    run: () => T,
  ): T & { requestId: string } => {
    const { id, at, digest, existing } = begin(op, requestId, args);
    if (existing?.status === "done" && existing.result)
      return JSON.parse(existing.result) as T & { requestId: string };
    return db.transaction(() => {
      const result = { ...run(), requestId: id };
      recordOperation(id, at, op, digest, "done", result, null);
      return result;
    })();
  };

  const checkThread = async (threadId: string): Promise<ThreadCheck> => {
    try {
      const thread = (await bb.sdk.threads.get({ threadId })) as {
        deletedAt?: number | null;
      };
      return thread.deletedAt ? "deleted" : "live";
    } catch (error) {
      const candidate = error as { status?: unknown; code?: unknown } | null;
      if (
        candidate &&
        (candidate.status === 404 || candidate.code === "thread_not_found")
      )
        return "deleted";
      return "unknown";
    }
  };

  const insertApp = (
    pkg: AppPackage,
    text: string,
    meta: {
      name: string;
      description: string;
      originKind: AppRow["origin_kind"];
      originRef: string | null;
    },
  ) => {
    const at = now();
    const appId = randomUUID();
    const versionId = randomUUID();
    db.prepare(
      "INSERT INTO library_apps (id, name, description, selected_version_id, revision, origin_kind, origin_ref, created_at, updated_at, trashed_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)",
    ).run(
      appId,
      meta.name,
      meta.description,
      versionId,
      meta.originKind,
      meta.originRef,
      at,
      at,
    );
    insertVersion(appId, versionId, pkg, text, at);
    return { appId, versionId, versionLabel: pkg.version };
  };
  const insertVersion = (
    appId: string,
    versionId: string,
    pkg: AppPackage,
    text: string,
    at: number,
  ) => {
    const label = pkg.version;
    const meta: VersionMeta = {
      contentKind: pkg.content.kind,
      agentActions: pkg.actions.mode,
      author: pkg.author ?? pkg.origin?.author ?? null,
      license: pkg.license ?? pkg.origin?.license ?? null,
    };
    const taken = db
      .prepare("SELECT 1 FROM library_versions WHERE app_id = ? AND label = ?")
      .get(appId, label);
    if (taken)
      throw new LibraryError(
        "conflict",
        `Version ${label} already exists for this app; choose another label.`,
      );
    db.prepare(
      "INSERT INTO library_versions (id, app_id, label, package, meta, digest, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      versionId,
      appId,
      label,
      text,
      JSON.stringify(meta),
      sha256(text),
      Buffer.byteLength(text, "utf8"),
      at,
    );
  };
  const nextLabel = (appId: string) => {
    const labels = new Set(versionsOf(appId).map((v) => v.label));
    let n = labels.size + 1;
    while (labels.has(String(n))) n += 1;
    return String(n);
  };
  const bumpRevision = (app: AppRow, expected: number) => {
    const changed = db
      .prepare(
        "UPDATE library_apps SET revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
      )
      .run(now(), app.id, expected).changes;
    if (!changed)
      throw new LibraryError(
        "conflict",
        `This app changed since you loaded it (now revision ${appRow(app.id)?.revision ?? "?"}). Reload it, or remix your version instead.`,
      );
  };

  const summary = (app: AppRow) => {
    const version = versionMeta(app.selected_version_id);
    return {
      id: app.id,
      name: app.name,
      description: app.description,
      revision: app.revision,
      origin: { kind: app.origin_kind, ref: app.origin_ref },
      selectedVersion: { id: version.id, label: version.label },
      contentKind: version.contentKind,
      agentActions: version.agentActions,
      author: version.author,
      license: version.license,
      createdAt: app.created_at,
      updatedAt: app.updated_at,
      trashedAt: app.trashed_at,
    };
  };
  const versionDetail = (version: VersionRow) => {
    const pkg = packageOf(version);
    return {
      id: version.id,
      label: version.label,
      title: pkg.title,
      summary: pkg.summary,
      digest: version.digest,
      bytes: version.bytes,
      createdAt: version.created_at,
      contentKind: pkg.content.kind,
      actions: pkg.actions,
      author: pkg.author ?? null,
      license: pkg.license ?? null,
      origin: pkg.origin ?? null,
      requires: pkg.requires,
      screenshots: screenshotMeta(pkg),
    };
  };

  const draftRow = (appId: string) =>
    db.prepare("SELECT * FROM library_drafts WHERE app_id = ?").get(appId) as
      | DraftRow
      | undefined;
  const draftView = (app: AppRow, draft: DraftRow) => {
    const pkg = parsePackage(draft.package).pkg;
    const base = versionRow(draft.base_version_id);
    const basePkg = base ? packageOf(base) : null;
    return {
      appId: app.id,
      revision: draft.revision,
      updatedAt: draft.updated_at,
      baseVersionId: draft.base_version_id,
      baseVersionLabel: base?.label ?? null,
      package: withoutScreenshotData(pkg),
      screenshots: screenshotMeta(pkg),
      diff: basePkg
        ? capDiff(
            diffText(
              sourceText({ ...basePkg, version: "draft" }),
              sourceText({
                ...pkg,
                ...(basePkg.author && !pkg.author
                  ? { author: basePkg.author }
                  : {}),
                ...(basePkg.license && !pkg.license
                  ? { license: basePkg.license }
                  : {}),
              }),
            ),
          )
        : "",
      catalogId: app.publish_catalog_id,
      publishedVersion: app.published_version,
    };
  };
  const applyEdit = (
    current: AppPackage,
    edit: DraftEdit,
    fromAnswer: Answer | null,
    fromAssets: PackageAssets | null,
  ): AppPackage => {
    if (edit.packageText !== undefined) {
      const { pkg } = parsePackage(edit.packageText);
      const next: AppPackage = {
        ...pkg,
        ...(!pkg.screenshots && current.screenshots
          ? { screenshots: current.screenshots }
          : {}),
      };
      delete next.origin;
      return current.origin ? { ...next, origin: current.origin } : next;
    }
    let next: AppPackage = { ...current };
    if (fromAnswer)
      next =
        fromAnswer.kind === "html"
          ? {
              ...next,
              content: { kind: "html", playground: fromAnswer.widget },
              actions:
                current.content.kind === "html"
                  ? current.actions
                  : { mode: "undocumented" },
              ...(fromAssets
                ? {
                    assets: fromAssets,
                    requires: {
                      renderer: Math.max(
                        next.requires.renderer,
                        ASSETS_RENDERER_VERSION,
                      ),
                    },
                  }
                : {}),
            }
          : {
              ...next,
              content: { kind: "document", document: fromAnswer.document },
              actions: packageFromAnswer(fromAnswer, {
                title: "",
                summary: "",
                version: "1",
              }).actions,
            };
    if (edit.html !== undefined || edit.width !== undefined) {
      if (next.content.kind !== "html")
        throw new LibraryError(
          "invalid",
          "This app is a native document; edit its document JSON instead.",
        );
      const playground = { ...next.content.playground };
      if (edit.html !== undefined) playground.html = edit.html;
      if (edit.width === null) delete playground.width;
      else if (edit.width !== undefined) playground.width = edit.width;
      next = {
        ...next,
        content: {
          kind: "html",
          playground: htmlAnswerSchema.parse(playground),
        },
      };
    }
    if (edit.documentJson !== undefined) {
      if (next.content.kind !== "document")
        throw new LibraryError(
          "invalid",
          "This app is HTML; edit its HTML instead.",
        );
      const document = parseDocument(edit.documentJson);
      next = {
        ...next,
        content: { kind: "document", document },
        actions: packageFromAnswer(
          { id: "", threadId: "", kind: "document", document },
          { title: "", summary: "", version: "1" },
        ).actions,
      };
    }
    if (edit.actionsJson !== undefined) {
      if (next.content.kind === "document")
        throw new LibraryError(
          "invalid",
          "Native documents derive their actions from their controls.",
        );
      let raw: unknown;
      try {
        raw = JSON.parse(edit.actionsJson);
      } catch {
        throw new LibraryError("invalid", "Actions must be JSON.");
      }
      next = { ...next, actions: manifestSchema.parse(raw) };
    }
    if (edit.title !== undefined) {
      next = { ...next, title: edit.title.trim() };
      if (next.content.kind === "html")
        next = {
          ...next,
          content: {
            kind: "html",
            playground: {
              ...next.content.playground,
              title: edit.title.trim(),
            },
          },
        };
    }
    if (edit.summary !== undefined)
      next = { ...next, summary: edit.summary.trim() };
    if (edit.removeScreenshot !== undefined) {
      const kept = (next.screenshots ?? []).filter(
        (s) => s.name !== edit.removeScreenshot,
      );
      if (kept.length === (next.screenshots ?? []).length)
        throw new LibraryError(
          "not_found",
          `No screenshot ${edit.removeScreenshot}.`,
        );
      next = { ...next, screenshots: kept };
    }
    if (edit.addScreenshot !== undefined) {
      const current = next.screenshots ?? [];
      if (current.length >= MAX_SCREENSHOTS)
        throw new LibraryError(
          "invalid",
          `Remove a screenshot first; the limit is ${MAX_SCREENSHOTS}.`,
        );
      const bytes = Buffer.from(edit.addScreenshot.data, "base64");
      next = {
        ...next,
        screenshots: [
          ...current,
          makeScreenshot(
            bytes,
            edit.addScreenshot.alt,
            current.map((s) => s.name),
          ),
        ],
      };
    }
    if (next.screenshots && next.screenshots.length === 0) {
      const rest: AppPackage = { ...next };
      delete rest.screenshots;
      next = rest;
    }
    return next;
  };
  const proposeVersion = (
    appId: string,
    catalogId: string,
    listing: CatalogListing | null,
  ) => {
    const app = appRow(appId);
    const known = [
      ...(app?.published_version ? [app.published_version] : []),
      ...(
        db
          .prepare(
            "SELECT version_label FROM library_releases WHERE app_id = ? OR catalog_id = ?",
          )
          .all(appId, catalogId) as { version_label: string }[]
      ).map((r) => r.version_label),
      ...(listing?.versions.map((v) => v.version) ?? []),
    ];
    const taken = new Set([
      ...known,
      ...(
        db
          .prepare("SELECT label FROM library_versions WHERE app_id = ?")
          .all(appId) as { label: string }[]
      ).map((r) => r.label),
    ]);
    let next = nextMinor(
      known.reduce<string | null>(
        (max, v) => (max === null || compareVersions(v, max) > 0 ? v : max),
        null,
      ),
    );
    while (taken.has(next)) next = nextMinor(next);
    return next;
  };
  const requireRelease = (id: string) => {
    const row = db
      .prepare("SELECT * FROM library_releases WHERE id = ?")
      .get(id) as ReleaseRow | undefined;
    if (!row) throw new LibraryError("not_found", `No release ${id}.`);
    return row;
  };
  const latestRelease = (appId: string) =>
    db
      .prepare(
        "SELECT * FROM library_releases WHERE app_id = ? AND status <> 'failed' ORDER BY created_at DESC, rowid DESC LIMIT 1",
      )
      .get(appId) as ReleaseRow | undefined;
  const setRelease = (
    id: string,
    status: ReleaseRow["status"],
    prUrl: string | null,
    note: string | null,
  ) =>
    db
      .prepare(
        "UPDATE library_releases SET status = ?, pr_url = ?, note = ?, updated_at = ? WHERE id = ?",
      )
      .run(status, prUrl, note, now(), id);
  const releaseSummary = (release: ReleaseRow) => ({
    id: release.id,
    appId: release.app_id,
    catalogId: release.catalog_id,
    version: release.version_label,
    digest: release.digest,
    changelog: release.changelog,
    kind: release.kind,
    status: release.status,
    prUrl: release.pr_url,
    note: release.note,
    createdAt: release.created_at,
    updatedAt: release.updated_at,
  });
  const releaseView = (release: ReleaseRow) => {
    const app = appRow(release.app_id);
    const version = versionRow(release.version_id);
    const pkg = version ? packageOf(version) : null;
    const listing = catalog.listing(release.catalog_id);
    const path = packagePath(release.catalog_id, release.version_label);
    const publishedLabel =
      listing?.versions.filter((v) => !v.delisted).at(-1)?.version ??
      app?.published_version ??
      null;
    const published =
      publishedLabel && app
        ? (db
            .prepare(
              "SELECT * FROM library_versions WHERE app_id = ? AND label = ?",
            )
            .get(app.id, publishedLabel) as VersionRow | undefined)
        : undefined;
    const catalogMoved =
      catalog.configured() &&
      catalog.revision() !== null &&
      release.catalog_revision !== catalog.revision();
    const blockers = [
      ...(catalogMoved
        ? [
            "The catalog changed since this release was prepared. Refresh the release and review its catalog entry again.",
          ]
        : []),
      ...(!catalog.configured()
        ? [
            "No Community catalog is configured, so this release cannot be submitted yet. The files can still be downloaded.",
          ]
        : []),
      ...(release.status === "published" ||
      release.status === "superseded" ||
      release.status === "failed"
        ? [`This release is ${release.status}.`]
        : []),
      ...(!pkg ? ["This release's version was deleted with its app."] : []),
    ];
    const entry: CatalogListing | null = pkg
      ? {
          id: release.catalog_id,
          title: pkg.title,
          summary: pkg.summary,
          author: pkg.author!,
          license: pkg.license as CatalogListing["license"],
          agentActions: pkg.actions.mode === "manual" ? "manual" : "documented",
          ...(listing?.preview ? { preview: listing.preview } : {}),
          ...(pkg.screenshots?.length
            ? {
                screenshots: pkg.screenshots.map((shot) => ({
                  path: screenshotPath(
                    release.catalog_id,
                    release.version_label,
                    shot.name,
                  ),
                  digest: shot.sha256,
                  bytes: shot.bytes,
                  alt: shot.alt,
                })),
              }
            : {}),
          versions: [
            ...(listing?.versions.filter(
              (v) => v.version !== release.version_label,
            ) ?? []),
            {
              version: release.version_label,
              path,
              digest: release.digest,
              bytes: version!.bytes,
              notes: release.changelog,
            },
          ],
        }
      : null;
    const contributing = catalog.contributing();
    return {
      ...releaseSummary(release),
      appName: app?.name ?? null,
      catalogRevision: release.catalog_revision,
      catalogMoved,
      ready: blockers.length === 0,
      blockers,
      files: pkg
        ? [
            { path, sha256: release.digest, bytes: version!.bytes },
            ...(pkg.screenshots ?? []).map((shot) => ({
              path: screenshotPath(
                release.catalog_id,
                release.version_label,
                shot.name,
              ),
              sha256: shot.sha256,
              bytes: shot.bytes,
            })),
          ]
        : [],
      catalogEntry: entry,
      contributing,
      diffBase: published ? published.label : null,
      diff: pkg
        ? capDiff(
            diffText(
              published
                ? sourceText({ ...packageOf(published), version: "draft" })
                : "",
              sourceText({ ...pkg, version: "draft" }),
            ),
          )
        : "",
      agentRequest: pkg
        ? [
            `Submit Playgrounds release ${release.id}: ${pkg.title} ${release.version_label} (${release.kind === "update" ? `update to ${release.catalog_id}` : `new listing ${release.catalog_id}`}) to the Community catalog${contributing ? ` following ${contributing}` : ""}.`,
            `I authorize opening or updating one pull request for exactly this release using your existing GitHub access. The catalog's maintainers decide whether it is accepted for this listing.`,
            `1. Run \`bb playgrounds apps release show ${release.id} --json\`. Stop and tell me if \`ready\` is false.`,
            `2. ${release.pr_url ? `This release already has pull request ${release.pr_url}. Update that pull request; do not open another.` : "Search the catalog repository for an open pull request mentioning this release ID before opening a new one."} Never force-push.`,
            `3. In your checkout of the catalog repository, run \`bb playgrounds apps release write ${release.id} --dir <checkout> --host <this machine's host ID>\`. It writes the package and screenshots byte-for-byte at their catalog paths and \`catalog-entry.json\`; check each file's SHA-256 against \`files\`. Upsert \`catalogEntry\` into index.json's apps list, delete catalog-entry.json, and mention the release ID in the pull request body.`,
            `4. Run \`bb playgrounds apps release submitted ${release.id} --pr <pull request URL>\` and send me the link.`,
          ].join("\n")
        : null,
    };
  };
  const runRow = (runId: string, threadId: string) =>
    db
      .prepare(
        "SELECT * FROM library_runs WHERE answer_id = ? AND thread_id = ?",
      )
      .get(runId, threadId) as RunRow | undefined;
  const readiness = (threadId: string, runId: string) =>
    live.openClients(threadId, runId).length ? "mounted" : "not-mounted";
  const openResult = (
    requestId: string,
    run: RunRow,
    resumed: boolean,
  ): OpenResult => {
    const app = appRow(run.app_id);
    const selected = app ? versionRow(app.selected_version_id) : undefined;
    const origin = JSON.parse(run.origin) as RunOrigin;
    return {
      requestId,
      runId: run.answer_id,
      appId: run.app_id,
      versionId: run.version_id,
      versionLabel: origin.versionLabel,
      selectedVersionId: selected?.id ?? run.version_id,
      selectedVersionLabel: selected?.label ?? origin.versionLabel,
      threadId: run.thread_id,
      resumed,
      directive: `::playground{id="${run.answer_id}"}`,
      readiness: readiness(run.thread_id, run.answer_id),
    };
  };
  const deleteRun = db.transaction((runId: string, threadId: string) => {
    db.prepare(
      "DELETE FROM library_runs WHERE answer_id = ? AND thread_id = ?",
    ).run(runId, threadId);
    db.prepare("DELETE FROM answers WHERE id = ? AND thread_id = ?").run(
      runId,
      threadId,
    );
    db.prepare("DELETE FROM answer_state WHERE id = ? AND thread_id = ?").run(
      runId,
      threadId,
    );
    db.prepare(
      "DELETE FROM answer_events WHERE answer_id = ? AND thread_id = ?",
    ).run(runId, threadId);
    assets.remove(threadId, runId);
  });
  const tombstone = (
    requestId: string,
    at: number,
    op: string,
    digest: string,
    threadId: string,
  ) => recordOperation(requestId, at, op, digest, "tombstone", null, threadId);
  const unavailable = () =>
    new LibraryError(
      "unavailable",
      "That thread was deleted, so the app cannot open there.",
    );
  const pendingVerification = () =>
    new LibraryError(
      "verification_pending",
      "Could not confirm the thread right now. Nothing was removed; try again with the same request ID.",
    );

  const insertRun = (
    app: AppRow,
    pkg: AppPackage,
    threadId: string,
    kind: RunRow["kind"],
    version: { versionId: string; versionLabel: string; digest: string },
  ) => {
    const answer = answerFromPackage(pkg);
    const runId = randomUUID();
    const origin: RunOrigin = {
      appName: app.name,
      versionLabel: version.versionLabel,
      digest: version.digest,
      title: pkg.title,
      manifest: pkg.actions,
    };
    db.prepare(
      "INSERT INTO answers (id, thread_id, document, kind) VALUES (?, ?, ?, ?)",
    ).run(runId, threadId, answer.content, answer.kind);
    db.prepare(
      "INSERT INTO library_runs (answer_id, thread_id, app_id, version_id, origin, kind, inherited, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
    ).run(
      runId,
      threadId,
      app.id,
      version.versionId,
      JSON.stringify(origin),
      kind,
      now(),
    );
    if (pkg.assets) assets.save(runId, threadId, pkg.assets);
    return runId;
  };
  const manifestFor = (runId: string, threadId: string) => {
    const run =
      runRow(runId, threadId) ??
      (db
        .prepare("SELECT * FROM library_runs WHERE answer_id = ? LIMIT 1")
        .get(runId) as RunRow | undefined);
    if (!run) return null;
    const origin = JSON.parse(run.origin) as RunOrigin;
    return {
      run,
      origin,
      manifest: origin.manifest ?? runManifest(runId, threadId),
    };
  };
  const runManifest = (runId: string, threadId: string): Manifest => {
    const answer = store.get(threadId, runId);
    return packageFromAnswer(answer, {
      title: "app",
      summary: "",
      version: "1",
    }).actions;
  };

  return {
    checkThread,
    list({ query, trashed = false }: { query?: string; trashed?: boolean }) {
      const pattern = `%${(query ?? "").trim().replaceAll(/[%_\\]/g, (c) => `\\${c}`)}%`;
      return (
        db
          .prepare(
            `SELECT * FROM library_apps WHERE (trashed_at IS NOT NULL) = ? AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 200`,
          )
          .all(trashed ? 1 : 0, pattern, pattern) as AppRow[]
      ).map(summary);
    },
    describe({ appId, versionId }: { appId: string; versionId?: string }) {
      const app = requireApp(appId);
      const version = requireVersion(app, versionId);
      return {
        ...summary(app),
        version: versionDetail(version),
        versions: versionsOf(app.id).map((v) => ({
          id: v.id,
          label: v.label,
          digest: v.digest,
          bytes: v.bytes,
          createdAt: v.created_at,
        })),
      };
    },
    source({ appId, versionId }: { appId: string; versionId?: string }) {
      const app = requireApp(appId);
      return packageOf(requireVersion(app, versionId)).content;
    },
    async save(input: {
      answerId: string;
      threadId: string;
      name?: string;
      description?: string;
      requestId?: string;
    }) {
      const owner = await store.resolve(input.threadId, input.answerId);
      const answer = store.get(owner, input.answerId);
      const title =
        answer.kind === "html" ? answer.widget.title : answer.document.title;
      const name = (input.name ?? title).trim() || title;
      const description = (input.description ?? "").trim();
      return idempotent(
        "save",
        input.requestId,
        {
          answerId: input.answerId,
          threadId: input.threadId,
          name,
          description,
        },
        () => {
          const pkg = packageFromAnswer(
            answer,
            { title: name, summary: description, version: "1" },
            assets.load(input.answerId, owner),
          );
          return insertApp(pkg, serializePackage(pkg), {
            name,
            description,
            originKind: "local",
            originRef: null,
          });
        },
      );
    },
    importPackage(input: { text: string; name?: string; requestId?: string }) {
      const { pkg } = parsePackage(input.text);
      return idempotent(
        "import",
        input.requestId,
        { digest: sha256(input.text), name: input.name ?? null },
        () =>
          insertApp(pkg, input.text, {
            name: (input.name ?? pkg.title).trim() || pkg.title,
            description: pkg.summary,
            originKind: "import",
            originRef: pkg.origin
              ? JSON.stringify({
                  kind: pkg.origin.kind,
                  appId: pkg.origin.appId,
                })
              : null,
          }),
      );
    },
    exportVersion({ appId, versionId }: { appId: string; versionId?: string }) {
      const app = requireApp(appId);
      const version = requireVersion(app, versionId);
      return {
        filename: `${app.name.replaceAll(/[^\w.-]+/g, "-").slice(0, 60) || "app"}-v${version.label}.json`,
        text: version.package,
        digest: version.digest,
        bytes: version.bytes,
      };
    },
    async createVersion(input: {
      appId: string;
      expectedRevision: number;
      label?: string;
      packageText?: string;
      answerId?: string;
      threadId?: string;
      requestId?: string;
    }) {
      if (requireApp(input.appId).origin_kind === "catalog")
        throw new LibraryError(
          "invalid",
          "Apps added from Community take new versions only from Community. Remix it to make your own versions.",
        );
      let source: { pkg: AppPackage; text: string | null };
      if (input.packageText !== undefined)
        source = {
          pkg: parsePackage(input.packageText).pkg,
          text: input.packageText,
        };
      else if (input.answerId && input.threadId) {
        const owner = await store.resolve(input.threadId, input.answerId);
        const app = requireApp(input.appId);
        const current = packageOf(requireVersion(app));
        const answer = store.get(owner, input.answerId);
        source = {
          pkg: {
            ...packageFromAnswer(
              answer,
              { title: current.title, summary: current.summary, version: "1" },
              assets.load(input.answerId, owner) ?? current.assets,
            ),
            ...(current.author ? { author: current.author } : {}),
            ...(current.license ? { license: current.license } : {}),
            ...(current.origin ? { origin: current.origin } : {}),
            ...(current.screenshots
              ? { screenshots: current.screenshots }
              : {}),
            ...(answer.kind === "html" &&
            current.actions.mode !== "undocumented"
              ? { actions: current.actions }
              : {}),
          },
          text: null,
        };
      } else
        throw new LibraryError(
          "invalid",
          "Pass a package, or a playground ID and its thread.",
        );
      return idempotent(
        "version",
        input.requestId,
        {
          appId: input.appId,
          expectedRevision: input.expectedRevision,
          label: input.label ?? null,
          digest:
            input.packageText === undefined ? null : sha256(input.packageText),
          answerId: input.answerId ?? null,
        },
        () => {
          const app = requireApp(input.appId);
          const label =
            input.label ??
            (input.packageText !== undefined &&
            !db
              .prepare(
                "SELECT 1 FROM library_versions WHERE app_id = ? AND label = ?",
              )
              .get(app.id, source.pkg.version)
              ? source.pkg.version
              : nextLabel(app.id));
          const labelled: AppPackage = { ...source.pkg, version: label };
          const text =
            source.text !== null && source.pkg.version === label
              ? source.text
              : serializePackage(labelled);
          bumpRevision(app, input.expectedRevision);
          const versionId = randomUUID();
          insertVersion(app.id, versionId, labelled, text, now());
          db.prepare(
            "UPDATE library_apps SET selected_version_id = ? WHERE id = ?",
          ).run(versionId, app.id);
          return {
            appId: app.id,
            versionId,
            versionLabel: label,
            revision: input.expectedRevision + 1,
          };
        },
      );
    },
    update(input: {
      appId: string;
      expectedRevision: number;
      name?: string;
      description?: string;
      selectedVersionId?: string;
    }) {
      return db.transaction(() => {
        const app = requireApp(input.appId);
        if (input.selectedVersionId)
          requireVersion(app, input.selectedVersionId);
        bumpRevision(app, input.expectedRevision);
        db.prepare(
          "UPDATE library_apps SET name = ?, description = ?, selected_version_id = ? WHERE id = ?",
        ).run(
          input.name?.trim() || app.name,
          input.description?.trim() ?? app.description,
          input.selectedVersionId ?? app.selected_version_id,
          app.id,
        );
        return summary(requireApp(app.id));
      })();
    },
    remix(input: {
      appId: string;
      versionId?: string;
      name?: string;
      requestId?: string;
    }) {
      return idempotent(
        "remix",
        input.requestId,
        {
          appId: input.appId,
          versionId: input.versionId ?? null,
          name: input.name ?? null,
        },
        () => {
          const app = requireApp(input.appId);
          const version = requireVersion(app, input.versionId);
          const pkg = packageOf(version);
          const name = (input.name ?? `${app.name} remix`).trim();
          const { author, license, ...rest } = pkg;
          const remix: AppPackage = {
            ...rest,
            title: name,
            version: "1",
            origin: {
              kind: "remix",
              appId:
                app.origin_kind === "catalog" && app.origin_ref
                  ? app.origin_ref
                  : app.id,
              version: version.label,
              digest: version.digest,
              title: pkg.title,
              ...((author ?? pkg.origin?.author)
                ? { author: author ?? pkg.origin?.author }
                : {}),
              ...((license ?? pkg.origin?.license)
                ? { license: license ?? pkg.origin?.license }
                : {}),
            },
          };
          return insertApp(remix, serializePackage(remix), {
            name,
            description: app.description,
            originKind: "remix",
            originRef: JSON.stringify({ appId: app.id, versionId: version.id }),
          });
        },
      );
    },
    trash({ appId }: { appId: string }) {
      requireApp(appId);
      db.prepare(
        "UPDATE library_apps SET trashed_at = COALESCE(trashed_at, ?), updated_at = ? WHERE id = ?",
      ).run(now(), now(), appId);
      return summary(requireApp(appId));
    },
    restore({ appId }: { appId: string }) {
      requireApp(appId);
      db.prepare(
        "UPDATE library_apps SET trashed_at = NULL, updated_at = ? WHERE id = ?",
      ).run(now(), appId);
      return summary(requireApp(appId));
    },
    purge({ appId, confirm }: { appId: string; confirm: boolean }) {
      const app = requireApp(appId);
      if (app.trashed_at === null)
        throw new LibraryError(
          "invalid",
          "Move the app to Trash before deleting it permanently.",
        );
      if (!confirm)
        throw new LibraryError(
          "invalid",
          "Confirm permanent deletion to purge this app.",
        );
      return db.transaction(() => {
        const versions = db
          .prepare("DELETE FROM library_versions WHERE app_id = ?")
          .run(appId).changes;
        db.prepare("DELETE FROM library_drafts WHERE app_id = ?").run(appId);
        db.prepare(
          "UPDATE library_releases SET status = 'failed', note = 'The app was deleted.', updated_at = ? WHERE app_id = ? AND status IN ('prepared', 'submitted')",
        ).run(now(), appId);
        db.prepare("DELETE FROM library_apps WHERE id = ?").run(appId);
        return { appId, purgedVersions: versions };
      })();
    },
    async open(input: {
      appId: string;
      threadId: string;
      fresh: boolean;
      requestId?: string;
    }): Promise<OpenResult> {
      const { id, at, digest, existing } = begin("open", input.requestId, {
        appId: input.appId,
        threadId: input.threadId,
        fresh: input.fresh,
      });
      if (existing) {
        if (existing.status === "tombstone" || !existing.result)
          throw unavailable();
        const recorded = JSON.parse(existing.result) as OpenResult;
        const check = await checkThread(input.threadId);
        const run = runRow(recorded.runId, input.threadId);
        if (check === "deleted" || (check === "live" && !run)) {
          if (run) deleteRun(run.answer_id, run.thread_id);
          tombstone(id, at, "open", digest, input.threadId);
          throw unavailable();
        }
        if (check === "unknown") throw pendingVerification();
        return openResult(id, run!, recorded.resumed);
      }
      const app = requireApp(input.appId);
      if (app.trashed_at !== null)
        throw new LibraryError(
          "invalid",
          `${app.name} is in Trash. Restore it before opening it.`,
        );
      const before = await checkThread(input.threadId);
      if (before === "deleted") throw unavailable();
      if (before === "unknown") throw pendingVerification();
      const { run, resumed } = db.transaction(() => {
        const raced = claim(id, "open", digest);
        if (raced) {
          const recorded = raced.result
            ? (JSON.parse(raced.result) as OpenResult)
            : null;
          const replayed = recorded
            ? runRow(recorded.runId, input.threadId)
            : undefined;
          if (raced.status === "tombstone" || !recorded || !replayed)
            throw unavailable();
          return { run: replayed, resumed: recorded.resumed };
        }
        const current = requireApp(input.appId);
        const latest = input.fresh
          ? undefined
          : (db
              .prepare(
                "SELECT * FROM library_runs WHERE app_id = ? AND thread_id = ? AND inherited = 0 AND kind = 'run' ORDER BY created_at DESC, rowid DESC LIMIT 1",
              )
              .get(current.id, input.threadId) as RunRow | undefined);
        if (latest) {
          const result = openResult(id, latest, true);
          recordOperation(
            id,
            at,
            "open",
            digest,
            "done",
            result,
            input.threadId,
          );
          return { run: latest, resumed: true };
        }
        const version = requireVersion(current);
        const runId = insertRun(
          current,
          packageOf(version),
          input.threadId,
          "run",
          {
            versionId: version.id,
            versionLabel: version.label,
            digest: version.digest,
          },
        );
        const created = runRow(runId, input.threadId)!;
        recordOperation(
          id,
          at,
          "open",
          digest,
          "done",
          openResult(id, created, false),
          input.threadId,
        );
        return { run: created, resumed: false };
      })();
      const after = await checkThread(input.threadId);
      if (after === "deleted") {
        if (!resumed) deleteRun(run.answer_id, run.thread_id);
        tombstone(id, at, "open", digest, input.threadId);
        throw unavailable();
      }
      if (after === "unknown") throw pendingVerification();
      return openResult(id, run, resumed);
    },
    async runInfo({ runId, threadId }: { runId: string; threadId: string }) {
      const owner = await store.resolve(threadId, runId);
      const found = manifestFor(runId, owner);
      if (!found) return null;
      const app = appRow(found.run.app_id);
      const selected = app ? versionRow(app.selected_version_id) : undefined;
      const origin = JSON.parse(found.run.origin) as RunOrigin;
      return {
        runId,
        threadId: owner,
        appId: found.run.app_id,
        appName: app?.name ?? origin.appName,
        appAvailable: !!app && app.trashed_at === null,
        versionId: found.run.version_id,
        versionLabel: origin.versionLabel,
        selectedVersionId: selected?.id ?? null,
        selectedVersionLabel: selected?.label ?? null,
        inherited: found.run.thread_id !== owner || found.run.inherited === 1,
        preview: found.run.kind === "preview",
        agentActions: found.manifest.mode,
      };
    },
    async clients({ runId, threadId }: { runId: string; threadId: string }) {
      const owner = await store.resolve(threadId, runId);
      return {
        runId,
        threadId: owner,
        clients: live.openClients(owner, runId).map((c) => ({
          clientId: c.clientId,
          surface: SURFACE_LABEL[c.surface],
          lastActiveAt: new Date(c.lastActive).toISOString(),
          actions: c.actions,
        })),
      };
    },
    async invoke(input: {
      runId: string;
      threadId: string;
      action: string;
      args: unknown[];
      clientId?: string;
      requestId: string;
    }): Promise<InvokeResult> {
      const { id, at, digest, existing } = begin("invoke", input.requestId, {
        runId: input.runId,
        threadId: input.threadId,
        action: input.action,
        args: input.args,
        clientId: input.clientId ?? null,
      });
      const replay = (row: OperationRow): InvokeResult => {
        if (row.status === "tombstone" || !row.result) throw unavailable();
        const recorded = JSON.parse(row.result) as InvokeResult;
        return row.status === "pending"
          ? {
              ...recorded,
              status: "unknown",
              replayed: true,
              notice:
                "This request is still in flight or its outcome is unknown. It was not sent again. Inspect the app's state before deciding to send a new request.",
            }
          : { ...recorded, replayed: true };
      };
      if (existing) return replay(existing);
      const owner = await store.resolve(input.threadId, input.runId);
      const found = manifestFor(input.runId, owner);
      if (!found)
        throw new LibraryError(
          "invalid",
          "This playground is not a library app run. Use `bb playgrounds do` for ordinary playgrounds.",
        );
      const { manifest } = found;
      if (manifest.mode === "manual")
        throw new LibraryError(
          "invalid",
          "This app is manual-only; it has no agent actions.",
        );
      if (manifest.mode === "documented") {
        const action = manifest.actions.find((a) => a.name === input.action);
        if (!action)
          throw new LibraryError(
            "invalid",
            `Unknown action "${input.action}". Documented: ${manifest.actions.map((a) => a.name).join(", ")}.`,
          );
        const error = checkActionArgs(action, input.args);
        if (error)
          throw new LibraryError("invalid", `${error} Nothing was sent.`);
      }
      if (JSON.stringify(input.args).length > 20_000)
        throw new LibraryError(
          "invalid",
          "Arguments are limited to 20,000 characters of JSON.",
        );
      const open = live.openClients(owner, input.runId);
      const target = input.clientId
        ? open.find((c) => c.clientId === input.clientId)
        : open.find((c) => c.actions.includes(input.action));
      if (!target)
        throw new LibraryError(
          "unavailable",
          input.clientId
            ? `Client ${input.clientId} is no longer showing this app. Nothing was sent; list current clients with \`apps clients\`.`
            : open.length
              ? `No open copy advertises "${input.action}". Nothing was sent.`
              : "This app is not open anywhere. Open its thread or app panel in bb, then try again. Nothing was sent.",
        );
      if (!target.actions.includes(input.action))
        throw new LibraryError(
          "invalid",
          `Client ${target.clientId} does not advertise "${input.action}". Nothing was sent.`,
        );
      const base: InvokeResult = {
        requestId: id,
        runId: input.runId,
        threadId: owner,
        action: input.action,
        clientId: target.clientId,
        surface: target.surface,
        status: "unknown",
        replayed: false,
        untrusted: true,
      };
      const raced = claim(id, "invoke", digest);
      if (raced) return replay(raced);
      recordOperation(id, at, "invoke", digest, "pending", base, owner);
      const { acknowledged, outcome } = await live.dispatch(
        owner,
        input.runId,
        target.clientId,
        input.action,
        input.args,
      );
      const audible =
        outcome.value && typeof outcome.value === "object"
          ? (outcome.value as { audible?: unknown }).audible
          : undefined;
      const result: InvokeResult = acknowledged
        ? {
            ...base,
            status: outcome.ok ? "succeeded" : "failed",
            ...(outcome.ok
              ? { value: outcome.value ?? null }
              : { error: outcome.error ?? "The action failed." }),
            ...(audible === false
              ? {
                  notice:
                    "Audio activation required: the person must click inside the app before sound can play.",
                }
              : {}),
          }
        : {
            ...base,
            notice:
              "No acknowledgment arrived in time. The action may already have run. It will not be sent again automatically; inspect the app's state first.",
          };
      if (operation(id)?.status === "pending")
        recordOperation(
          id,
          at,
          "invoke",
          digest,
          acknowledged ? "done" : "unknown",
          result,
          owner,
        );
      return result;
    },
    draftGet({ appId }: { appId: string }) {
      const app = requireApp(appId);
      const draft = draftRow(app.id);
      if (!draft) return null;
      return draftView(app, draft);
    },
    draftOpen({ appId, versionId }: { appId: string; versionId?: string }) {
      return db.transaction(() => {
        const app = requireApp(appId);
        if (app.origin_kind === "catalog")
          throw new LibraryError(
            "invalid",
            "Apps added from Community are someone else's release. Remix it to develop your own copy.",
          );
        const existing = draftRow(app.id);
        if (existing) return draftView(app, existing);
        const version = requireVersion(app, versionId);
        const pkg = packageOf(version);
        db.prepare(
          "INSERT INTO library_drafts (app_id, base_version_id, package, revision, updated_at) VALUES (?, ?, ?, 1, ?)",
        ).run(
          app.id,
          version.id,
          serializePackage({ ...pkg, version: "draft" }),
          now(),
        );
        return draftView(app, draftRow(app.id)!);
      })();
    },
    async draftWrite(input: {
      appId: string;
      expectedRevision: number;
      edit: DraftEdit;
    }) {
      const fromOwner = input.edit.fromAnswer
        ? await store.resolve(
            input.edit.fromAnswer.threadId,
            input.edit.fromAnswer.answerId,
          )
        : null;
      const fromAnswer =
        input.edit.fromAnswer && fromOwner
          ? store.get(fromOwner, input.edit.fromAnswer.answerId)
          : null;
      const fromAssets =
        input.edit.fromAnswer && fromOwner
          ? assets.load(input.edit.fromAnswer.answerId, fromOwner)
          : null;
      return db.transaction(() => {
        const app = requireApp(input.appId);
        const draft = draftRow(app.id);
        if (!draft)
          throw new LibraryError(
            "invalid",
            "Start developing this app before editing its draft.",
          );
        if (draft.revision !== input.expectedRevision)
          throw new LibraryError(
            "conflict",
            `The draft changed since you loaded it (now revision ${draft.revision}). Reload it and reapply your edit.`,
          );
        const current = parsePackage(draft.package).pkg;
        const next = applyEdit(current, input.edit, fromAnswer, fromAssets);
        const text = serializePackage({ ...next, version: "draft" });
        parsePackage(text);
        db.prepare(
          "UPDATE library_drafts SET package = ?, revision = revision + 1, updated_at = ? WHERE app_id = ? AND revision = ?",
        ).run(text, now(), app.id, input.expectedRevision);
        return draftView(app, draftRow(app.id)!);
      })();
    },
    draftDiscard({
      appId,
      expectedRevision,
    }: {
      appId: string;
      expectedRevision: number;
    }) {
      const app = requireApp(appId);
      const changed = db
        .prepare("DELETE FROM library_drafts WHERE app_id = ? AND revision = ?")
        .run(app.id, expectedRevision).changes;
      if (!changed)
        throw new LibraryError(
          "conflict",
          "The draft changed since you loaded it. Reload it first.",
        );
      return { appId: app.id, discarded: true };
    },
    async draftPreview(input: {
      appId: string;
      threadId: string;
      requestId?: string;
    }): Promise<OpenResult & { preview: true; draftRevision: number }> {
      const draftAtStart = draftRow(input.appId);
      const { id, at, digest, existing } = begin("preview", input.requestId, {
        appId: input.appId,
        threadId: input.threadId,
        revision: draftAtStart?.revision ?? null,
      });
      if (existing) {
        if (existing.status === "tombstone" || !existing.result)
          throw unavailable();
        const recorded = JSON.parse(existing.result) as OpenResult & {
          preview: true;
          draftRevision: number;
        };
        const check = await checkThread(input.threadId);
        const run = runRow(recorded.runId, input.threadId);
        if (check === "deleted" || (check === "live" && !run)) {
          if (run) deleteRun(run.answer_id, run.thread_id);
          tombstone(id, at, "preview", digest, input.threadId);
          throw unavailable();
        }
        if (check === "unknown") throw pendingVerification();
        return {
          ...openResult(id, run!, false),
          preview: true,
          draftRevision: recorded.draftRevision,
        };
      }
      const before = await checkThread(input.threadId);
      if (before === "deleted") throw unavailable();
      if (before === "unknown") throw pendingVerification();
      const run = db.transaction(() => {
        const raced = claim(id, "preview", digest);
        if (raced) {
          const recorded = raced.result
            ? (JSON.parse(raced.result) as {
                runId: string;
                draftRevision: number;
              })
            : null;
          const replayed = recorded
            ? runRow(recorded.runId, input.threadId)
            : undefined;
          if (raced.status === "tombstone" || !recorded || !replayed)
            throw unavailable();
          return { created: replayed, revision: recorded.draftRevision };
        }
        const app = requireApp(input.appId);
        const draft = draftRow(app.id);
        if (!draft)
          throw new LibraryError(
            "invalid",
            "This app has no draft to preview.",
          );
        if (draftAtStart && draft.revision !== draftAtStart.revision)
          throw new LibraryError(
            "conflict",
            "The draft changed while preparing the preview. Try again.",
          );
        const pkg = parsePackage(draft.package).pkg;
        const runId = insertRun(app, pkg, input.threadId, "preview", {
          versionId: draft.base_version_id,
          versionLabel: `draft r${draft.revision}`,
          digest: sha256(draft.package),
        });
        const created = runRow(runId, input.threadId)!;
        recordOperation(
          id,
          at,
          "preview",
          digest,
          "done",
          {
            ...openResult(id, created, false),
            preview: true,
            draftRevision: draft.revision,
          },
          input.threadId,
        );
        return { created, revision: draft.revision };
      })();
      const after = await checkThread(input.threadId);
      if (after === "deleted") {
        deleteRun(run.created.answer_id, run.created.thread_id);
        tombstone(id, at, "preview", digest, input.threadId);
        throw unavailable();
      }
      if (after === "unknown") throw pendingVerification();
      return {
        ...openResult(id, run.created, false),
        preview: true,
        draftRevision: run.revision,
      };
    },
    releasePrepare(input: {
      appId: string;
      expectedDraftRevision?: number;
      version?: string;
      changelog: string;
      catalogId?: string;
      author?: { name: string; url?: string };
      license?: string;
      reviewed: boolean;
      requestId?: string;
    }) {
      if (!input.reviewed)
        throw new LibraryError(
          "invalid",
          "Review the source and metadata for personal content and redistribution rights, then confirm.",
        );
      const changelog = input.changelog.trim();
      if (!changelog || changelog.length > 1000)
        throw new LibraryError(
          "invalid",
          "Describe what changed in 1 to 1,000 characters.",
        );
      return idempotent(
        "release",
        input.requestId,
        {
          appId: input.appId,
          draft: input.expectedDraftRevision ?? null,
          version: input.version ?? null,
          changelog,
          catalogId: input.catalogId ?? null,
          author: input.author ?? null,
          license: input.license ?? null,
        },
        () => {
          const app = requireApp(input.appId);
          if (app.origin_kind === "catalog")
            throw new LibraryError(
              "invalid",
              "This app was added from Community. Remix it to release your own listing.",
            );
          const draft = draftRow(app.id);
          if (
            draft &&
            input.expectedDraftRevision !== undefined &&
            draft.revision !== input.expectedDraftRevision
          )
            throw new LibraryError(
              "conflict",
              `The draft changed since you reviewed it (now revision ${draft.revision}). Review the new diff before preparing.`,
            );
          const source = draft
            ? parsePackage(draft.package).pkg
            : packageOf(requireVersion(app));
          let catalogId = app.publish_catalog_id;
          if (catalogId && input.catalogId && input.catalogId !== catalogId)
            throw new LibraryError(
              "invalid",
              `This app is already associated with ${catalogId}.`,
            );
          if (!catalogId) {
            if (!input.catalogId)
              throw new LibraryError(
                "invalid",
                "Choose a Community ID like your-name/app-name for the first submission.",
              );
            catalogId = catalogIdSchema.parse(input.catalogId);
            if (
              db
                .prepare(
                  "SELECT 1 FROM library_apps WHERE publish_catalog_id = ? AND id <> ?",
                )
                .get(catalogId, app.id) ||
              catalog.listing(catalogId)
            )
              throw new LibraryError(
                "conflict",
                `${catalogId} is already taken. Only the library that submitted a listing can prepare its updates; choose another ID or remix.`,
              );
          }
          const listing = catalog.listing(catalogId);
          const previous = latestRelease(app.id);
          const previousVersion = previous
            ? versionRow(previous.version_id)
            : undefined;
          const previousPkg = previousVersion
            ? packageOf(previousVersion)
            : null;
          const author =
            input.author ?? source.author ?? previousPkg?.author ?? null;
          const license =
            input.license ?? source.license ?? previousPkg?.license ?? null;
          if (!author)
            throw new LibraryError(
              "invalid",
              "Add the author name to show publicly.",
            );
          if (!license || !(LICENSES as readonly string[]).includes(license))
            throw new LibraryError(
              "invalid",
              `Choose a redistribution license: ${LICENSES.join(", ")}.`,
            );
          if (source.actions.mode === "undocumented")
            throw new LibraryError(
              "invalid",
              "Community apps document their agent actions or declare themselves manual-only. Edit the draft's actions first.",
            );
          if (!source.screenshots?.length)
            throw new LibraryError(
              "invalid",
              "Community submissions need at least one screenshot of the app. Add one to the draft first.",
            );
          const version = versionLabel.parse(
            input.version ?? proposeVersion(app.id, catalogId, listing),
          );
          if (
            db
              .prepare(
                "SELECT 1 FROM library_versions WHERE app_id = ? AND label = ?",
              )
              .get(app.id, version) ||
            db
              .prepare(
                "SELECT 1 FROM library_releases WHERE catalog_id = ? AND version_label = ?",
              )
              .get(catalogId, version) ||
            listing?.versions.some((v) => v.version === version)
          )
            throw new LibraryError(
              "conflict",
              `Version ${version} already exists. Choose a newer version.`,
            );
          const pkg: AppPackage = { ...source, version, author, license };
          const text = serializePackage(pkg);
          const versionId = randomUUID();
          const at = now();
          insertVersion(app.id, versionId, pkg, text, at);
          db.prepare(
            "UPDATE library_apps SET selected_version_id = ?, publish_catalog_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
          ).run(versionId, catalogId, at, app.id);
          if (draft)
            db.prepare(
              "UPDATE library_drafts SET base_version_id = ? WHERE app_id = ?",
            ).run(versionId, app.id);
          const pending = db
            .prepare(
              "SELECT * FROM library_releases WHERE app_id = ? AND status IN ('prepared', 'submitted') ORDER BY created_at DESC, rowid DESC",
            )
            .all(app.id) as ReleaseRow[];
          const prUrl = pending.find((r) => r.pr_url)?.pr_url ?? null;
          db.prepare(
            "UPDATE library_releases SET status = 'superseded', updated_at = ? WHERE app_id = ? AND status IN ('prepared', 'submitted')",
          ).run(at, app.id);
          const releaseId = randomUUID();
          db.prepare(
            "INSERT INTO library_releases (id, app_id, version_id, catalog_id, version_label, digest, changelog, kind, status, catalog_revision, pr_url, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, NULL, ?, ?)",
          ).run(
            releaseId,
            app.id,
            versionId,
            catalogId,
            version,
            sha256(text),
            changelog,
            listing ? "update" : "initial",
            catalog.revision(),
            prUrl,
            at,
            at,
          );
          return { releaseId };
        },
      );
    },
    releaseRecover(input: { appId: string; catalogId: string; prUrl: string }) {
      return db.transaction(() => {
        const app = requireApp(input.appId);
        if (app.origin_kind === "catalog")
          throw new LibraryError(
            "invalid",
            "Apps added from Community cannot take over their listing. Use the library that submitted it.",
          );
        if (app.publish_catalog_id)
          throw new LibraryError(
            "invalid",
            `This app is already associated with ${app.publish_catalog_id}.`,
          );
        const catalogId = catalogIdSchema.parse(input.catalogId);
        const listing = catalog.listing(catalogId);
        if (!listing)
          throw new LibraryError(
            "not_found",
            `${catalogId} is not in the refreshed Community catalog.`,
          );
        if (
          db
            .prepare("SELECT 1 FROM library_apps WHERE publish_catalog_id = ?")
            .get(catalogId)
        )
          throw new LibraryError(
            "conflict",
            `Another app in this library is already associated with ${catalogId}.`,
          );
        let url: URL;
        try {
          url = new URL(input.prUrl);
        } catch {
          throw new LibraryError(
            "invalid",
            "Pass the https URL of the pull request that submitted a listed version.",
          );
        }
        if (url.protocol !== "https:" || input.prUrl.length > 300)
          throw new LibraryError(
            "invalid",
            "Pass the https URL of the pull request that submitted a listed version.",
          );
        const listed = new Map(
          listing.versions.map((v) => [v.digest, v.version]),
        );
        const held = (
          db
            .prepare(
              "SELECT id, label, digest FROM library_versions WHERE app_id = ? ORDER BY created_at DESC, rowid DESC",
            )
            .all(app.id) as { id: string; label: string; digest: string }[]
        ).find((v) => listed.has(v.digest));
        if (!held)
          throw new LibraryError(
            "invalid",
            `None of this app's versions has exactly the bytes of a version listed for ${catalogId}, so it cannot be reconciled with that listing.`,
          );
        const version = listed.get(held.digest)!;
        const at = now();
        db.prepare(
          "UPDATE library_apps SET publish_catalog_id = ?, published_version = ?, published_digest = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
        ).run(catalogId, version, held.digest, at, app.id);
        const releaseId = randomUUID();
        db.prepare(
          "INSERT OR IGNORE INTO library_releases (id, app_id, version_id, catalog_id, version_label, digest, changelog, kind, status, catalog_revision, pr_url, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'initial', 'published', ?, ?, ?, ?, ?)",
        ).run(
          releaseId,
          app.id,
          held.id,
          catalogId,
          version,
          held.digest,
          listing.versions.find((v) => v.version === version)?.notes ?? "",
          catalog.revision(),
          url.href,
          "Association recovered from the catalog. Catalog maintainers still decide whether this library's pull requests may update the listing.",
          at,
          at,
        );
        return { appId: app.id, catalogId, publishedVersion: version };
      })();
    },
    async releaseWrite(input: {
      releaseId: string;
      hostId: string;
      dir: string;
    }) {
      const release = requireRelease(input.releaseId);
      const version = versionRow(release.version_id);
      if (!version)
        throw new LibraryError(
          "not_found",
          "This release's version was deleted with its app.",
        );
      if (!posix.isAbsolute(input.dir) && !win32.isAbsolute(input.dir))
        throw new LibraryError(
          "invalid",
          "Pass the catalog checkout as an absolute directory.",
        );
      const view = releaseView(release);
      const pkg = packageOf(version);
      const files: {
        path: string;
        content: string;
        contentEncoding: "utf8" | "base64";
      }[] = [
        {
          path: packagePath(release.catalog_id, release.version_label),
          content: version.package,
          contentEncoding: "utf8",
        },
        ...(pkg.screenshots ?? []).map((shot) => ({
          path: screenshotPath(
            release.catalog_id,
            release.version_label,
            shot.name,
          ),
          content: shot.data,
          contentEncoding: "base64" as const,
        })),
        {
          path: "catalog-entry.json",
          content: `${JSON.stringify(view.catalogEntry, null, 2)}\n`,
          contentEncoding: "utf8",
        },
      ];
      for (const file of files)
        await bb.sdk.files.write({
          hostId: input.hostId,
          path: posix.join(input.dir.replaceAll("\\", "/"), file.path),
          content: file.content,
          contentEncoding: file.contentEncoding,
          createParents: true,
        });
      return {
        releaseId: release.id,
        written: files.map((f) => f.path),
        files: view.files,
      };
    },
    screenshot(input: {
      appId: string;
      versionId?: string;
      draft?: boolean;
      name: string;
    }) {
      const app = requireApp(input.appId);
      const draft = input.draft ? draftRow(app.id) : undefined;
      if (input.draft && !draft)
        throw new LibraryError("not_found", "This app has no draft.");
      const pkg = draft
        ? parsePackage(draft.package).pkg
        : packageOf(requireVersion(app, input.versionId));
      const shot = pkg.screenshots?.find((s) => s.name === input.name);
      if (!shot)
        throw new LibraryError("not_found", `No screenshot ${input.name}.`);
      return { type: shot.type, data: Buffer.from(shot.data, "base64") };
    },
    releaseShow({ releaseId }: { releaseId: string }) {
      return releaseView(requireRelease(releaseId));
    },
    releasePackage({ releaseId }: { releaseId: string }) {
      const release = requireRelease(releaseId);
      const version = versionRow(release.version_id);
      if (!version)
        throw new LibraryError(
          "not_found",
          "This release's version was deleted with its app.",
        );
      return {
        path: packagePath(release.catalog_id, release.version_label),
        text: version.package,
        digest: version.digest,
      };
    },
    releaseList({ appId }: { appId: string }) {
      requireApp(appId);
      return (
        db
          .prepare(
            "SELECT * FROM library_releases WHERE app_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 50",
          )
          .all(appId) as ReleaseRow[]
      ).map(releaseSummary);
    },
    releaseRefresh({ releaseId }: { releaseId: string }) {
      const release = requireRelease(releaseId);
      if (release.status !== "prepared" && release.status !== "submitted")
        throw new LibraryError(
          "invalid",
          `This release is ${release.status}; prepare a new release instead.`,
        );
      const listed = catalog
        .listing(release.catalog_id)
        ?.versions.find((v) => v.version === release.version_label);
      if (listed && listed.digest !== release.digest) {
        setRelease(
          release.id,
          "failed",
          null,
          `The catalog already lists ${release.version_label} with different content. Prepare a newer version.`,
        );
      } else
        db.prepare(
          "UPDATE library_releases SET catalog_revision = ?, updated_at = ? WHERE id = ?",
        ).run(catalog.revision(), now(), release.id);
      return releaseView(requireRelease(release.id));
    },
    releaseRecordSubmission({
      releaseId,
      prUrl,
    }: {
      releaseId: string;
      prUrl: string;
    }) {
      const release = requireRelease(releaseId);
      if (release.status !== "prepared" && release.status !== "submitted")
        throw new LibraryError(
          "invalid",
          `This release is ${release.status}; it cannot be submitted.`,
        );
      let url: URL;
      try {
        url = new URL(prUrl);
      } catch {
        throw new LibraryError("invalid", "Pass the pull request's https URL.");
      }
      if (url.protocol !== "https:" || prUrl.length > 300)
        throw new LibraryError("invalid", "Pass the pull request's https URL.");
      if (release.pr_url && release.pr_url !== url.href)
        throw new LibraryError(
          "conflict",
          `This release is already associated with ${release.pr_url}. Update that pull request instead of opening another.`,
        );
      setRelease(release.id, "submitted", url.href, null);
      return releaseView(requireRelease(release.id));
    },
    releaseMarkFailed({
      releaseId,
      note,
    }: {
      releaseId: string;
      note: string;
    }) {
      const release = requireRelease(releaseId);
      if (release.status === "published")
        throw new LibraryError("invalid", "This release is already published.");
      setRelease(
        release.id,
        "failed",
        release.pr_url,
        note.trim().slice(0, 500) || "Submission declined or closed.",
      );
      return releaseView(requireRelease(release.id));
    },
    syncPublished(index: CatalogIndex) {
      const open = db
        .prepare(
          "SELECT * FROM library_releases WHERE status IN ('prepared', 'submitted', 'superseded')",
        )
        .all() as ReleaseRow[];
      for (const release of open) {
        const listed = index.apps
          .find((a) => a.id === release.catalog_id)
          ?.versions.find((v) => v.version === release.version_label);
        if (!listed) continue;
        if (listed.digest === release.digest) {
          setRelease(release.id, "published", release.pr_url, null);
          db.prepare(
            "UPDATE library_apps SET published_version = ?, published_digest = ? WHERE id = ? AND publish_catalog_id = ?",
          ).run(
            release.version_label,
            release.digest,
            release.app_id,
            release.catalog_id,
          );
        } else if (release.status !== "superseded")
          setRelease(
            release.id,
            "failed",
            release.pr_url,
            `The catalog lists ${release.version_label} with different content than this release.`,
          );
      }
    },
    authoredListing(catalogId: string) {
      const row = db
        .prepare("SELECT id FROM library_apps WHERE publish_catalog_id = ?")
        .get(catalogId) as { id: string } | undefined;
      return row?.id ?? null;
    },
    copyRuns(fromThreadId: string, toThreadId: string, id: string | null) {
      db.prepare(
        "INSERT OR IGNORE INTO library_runs (answer_id, thread_id, app_id, version_id, origin, kind, inherited, created_at) SELECT answer_id, ?, app_id, version_id, origin, kind, 1, created_at FROM library_runs WHERE thread_id = ? AND (? IS NULL OR answer_id = ?)",
      ).run(toThreadId, fromThreadId, id, id);
    },
    removeThread(threadId: string) {
      db.prepare("DELETE FROM library_runs WHERE thread_id = ?").run(threadId);
      db.prepare(
        "UPDATE library_operations SET status = 'tombstone', result = NULL, updated_at = ? WHERE thread_id = ?",
      ).run(now(), threadId);
    },
    settleInterrupted() {
      db.prepare(
        "UPDATE library_operations SET status = 'unknown', updated_at = ? WHERE status = 'pending'",
      ).run(now());
      prune();
    },
    async reconcile(
      removeThread: (threadId: string) => void,
      signal?: AbortSignal,
    ) {
      let cursor = "";
      const pending: string[] = [];
      for (;;) {
        if (signal?.aborted) return pending;
        const batch = (
          db
            .prepare(
              "SELECT DISTINCT thread_id FROM library_runs WHERE thread_id > ? ORDER BY thread_id LIMIT ?",
            )
            .all(cursor, RECONCILE_BATCH) as { thread_id: string }[]
        ).map((r) => r.thread_id);
        if (!batch.length) return pending;
        for (const threadId of batch) {
          const check = await checkThread(threadId);
          if (check === "deleted") removeThread(threadId);
          if (check === "unknown") pending.push(threadId);
        }
        cursor = batch.at(-1)!;
      }
    },
    addCatalogVersion(input: {
      catalogId: string;
      text: string;
      name: string;
      description: string;
      select: boolean;
      requestId?: string;
    }) {
      const { pkg } = parsePackage(input.text);
      return idempotent(
        "community-add",
        input.requestId,
        {
          catalogId: input.catalogId,
          version: pkg.version,
          digest: sha256(input.text),
          select: input.select,
        },
        () => {
          const existing = db
            .prepare(
              "SELECT * FROM library_apps WHERE origin_kind = 'catalog' AND origin_ref = ?",
            )
            .get(input.catalogId) as AppRow | undefined;
          if (!existing)
            return {
              ...insertApp(pkg, input.text, {
                name: input.name,
                description: input.description,
                originKind: "catalog",
                originRef: input.catalogId,
              }),
              added: true,
            };
          const have = db
            .prepare(
              "SELECT * FROM library_versions WHERE app_id = ? AND label = ?",
            )
            .get(existing.id, pkg.version) as VersionRow | undefined;
          if (have) {
            if (have.digest !== sha256(input.text))
              throw new LibraryError(
                "conflict",
                `Catalog version ${pkg.version} changed after it was installed. It was not replaced.`,
              );
            if (input.select && existing.selected_version_id !== have.id)
              db.prepare(
                "UPDATE library_apps SET selected_version_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
              ).run(have.id, now(), existing.id);
            return {
              appId: existing.id,
              versionId: have.id,
              versionLabel: have.label,
              added: false,
            };
          }
          const versionId = randomUUID();
          insertVersion(existing.id, versionId, pkg, input.text, now());
          if (input.select)
            db.prepare(
              "UPDATE library_apps SET selected_version_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?",
            ).run(versionId, now(), existing.id);
          return {
            appId: existing.id,
            versionId,
            versionLabel: pkg.version,
            added: true,
          };
        },
      );
    },
    catalogInstalls() {
      return db
        .prepare(
          "SELECT a.origin_ref AS catalog_id, a.id AS app_id, a.trashed_at, v.label, v.digest, sv.label AS selected FROM library_apps a JOIN library_versions v ON v.app_id = a.id JOIN library_versions sv ON sv.id = a.selected_version_id WHERE a.origin_kind = 'catalog'",
        )
        .all() as {
        catalog_id: string;
        app_id: string;
        trashed_at: number | null;
        label: string;
        digest: string;
        selected: string;
      }[];
    },
    packageFor(appId: string, versionId?: string) {
      const app = requireApp(appId);
      const version = requireVersion(app, versionId);
      return { app, version, pkg: packageOf(version) };
    },
  };
}
export type Library = ReturnType<typeof createLibrary>;
