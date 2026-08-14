import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { JsonValue } from "../../shared/contract.js";
import { rpcContract } from "../../shared/contract.js";
import {
  VEX_JUSTIFICATIONS,
  VEX_RESPONSES,
  VEX_STATUSES,
} from "../../lib/remote/types.js";
import {
  backfillUnambiguousWorkspaceProjectBinding,
  WORKSPACE_PLATFORM_PROJECT_PREDICATE,
} from "../../lib/store/project-scope.js";
import { listFindingActivity } from "./cache/activity.js";
import {
  commentMutationAuthorizationUnavailable,
  listFindingComments,
} from "./cache/comments.js";
import { getCachedFinding, queryFindings } from "./cache/query.js";
import { findingsCacheState } from "./cache/query.js";
import type { CachedFinding, FindingsFilter } from "./cache/types.js";
import type { FindingsDriftService } from "./drift/index.js";
import type { VendorImportResult } from "./drift/vendor/import.js";
import { DRIFT_REPORT_MAX_LIMIT, type DriftState } from "./drift/report.js";
import {
  decisionFromInput,
  OverlayCasConflictError,
  readOverlayFiles,
  removeDecision,
  setDecision,
  stableKeyFor,
  TRIAGE_OVERLAY_SCHEMA,
  type ParsedOverlayFile,
  type TriageDecisionV1,
} from "./overlay/index.js";
import {
  parseEncodedFindingKey,
  resolveEncodedFinding,
} from "./stable-key/index.js";
import { assertAcceptedFindingsScope } from "./scope.js";

const findingsRpcContract = {
  findingsList: rpcContract.findingsList,
  findingsGet: rpcContract.findingsGet,
  findingsActivityList: rpcContract.findingsActivityList,
  findingsCommentsList: rpcContract.findingsCommentsList,
  findingsCommentsCreate: rpcContract.findingsCommentsCreate,
  findingsCommentsUpdate: rpcContract.findingsCommentsUpdate,
  findingsCommentsDelete: rpcContract.findingsCommentsDelete,
  findingsFacets: rpcContract.findingsFacets,
  triageVendorVexPreview: rpcContract.triageVendorVexPreview,
  triageVendorVexApply: rpcContract.triageVendorVexApply,
  triageOrphansPrune: rpcContract.triageOrphansPrune,
} as const;

const savedFilterSchema = z
  .object({
    severity: z.array(z.string().min(1).max(100)).max(20).optional(),
    reachability: z.enum(["reachable", "unreachable", "unknown"]).optional(),
    kev: z.enum(["kev", "vc-kev", "none"]).optional(),
    epssGte: z.number().min(0).max(1).optional(),
    component: z.string().max(512).optional(),
    cve: z.string().max(512).optional(),
    triage: z.array(z.string().min(1).max(100)).max(50).optional(),
    findingType: z.array(z.string().min(1).max(100)).max(50).optional(),
    localState: z
      .array(
        z.enum(["none", "local", "conflicted", "stale", "needs_completion"]),
      )
      .max(5)
      .optional(),
  })
  .strict();
const savedViewSchema = z
  .object({
    schema: z.literal("fs-findings-view/v1"),
    id: z.string().min(1).max(128),
    name: z.string().trim().min(1).max(100),
    filter: savedFilterSchema,
    sort: z
      .array(
        z
          .object({ field: z.literal("risk"), direction: z.literal("desc") })
          .strict(),
      )
      .length(1),
    columns: z.array(z.string().min(1).max(100)).min(1).max(20),
  })
  .strict();
const savedViewsDocumentSchema = z
  .object({
    schema: z.literal("fs-findings-views/v1"),
    views: z.array(savedViewSchema).max(100),
  })
  .strict();
const savedViewsResultSchema = z
  .object({
    views: z.array(savedViewSchema),
    sha256: z.string().length(64).nullable(),
    recoveredFromCorrupt: z.boolean(),
  })
  .strict();
const findingsUiListInputSchema = z
  .object({
    projectId: z.string().min(1).max(512),
    projectVersionId: z.string().min(1).max(512),
    pageSize: z.number().int().min(1).max(200),
    continuation: z.string().min(1).max(4096).nullable(),
    filters: savedFilterSchema,
  })
  .strict();

const triageComponentSchema = z
  .object({
    purl: z.string().nullable(),
    name: z.string().min(1),
    group: z.string().nullable(),
    version: z.string().nullable(),
  })
  .strict();
const triageTupleSchema = z
  .object({
    status: z.enum(VEX_STATUSES).nullable(),
    justification: z.enum(VEX_JUSTIFICATIONS).nullable(),
    response: z.enum(VEX_RESPONSES).nullable(),
    reason: z.string().nullable(),
  })
  .strict();
const triageStoredDecisionSchema = z
  .object({
    status: z.enum(VEX_STATUSES),
    justification: z.enum(VEX_JUSTIFICATIONS).nullable(),
    response: z.enum(VEX_RESPONSES).nullable(),
    reason: z.string(),
    pin: z.enum(["exact_version", "any_version"]),
    provenance: z
      .object({ by: z.string(), at: z.string(), evidence: z.string() })
      .strict(),
    sync: z
      .object({
        base: triageTupleSchema.nullable(),
        pushed_at: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const triageUndoTokenSchema = z
  .object({
    file: z.string().min(1),
    beforeSha256: z.string().length(64),
    afterSha256: z.string().length(64),
    prior: triageStoredDecisionSchema.nullable(),
  })
  .strict();
const triageTargetSchema = z
  .object({
    findingId: z.string().min(1),
    stableKey: z.string().min(1),
    cve: z.string().min(1),
    label: z.string().min(1),
    component: triageComponentSchema,
    evidence: z.string(),
    reasonSeed: z.string(),
    expectedSha256: z.string().length(64).nullable(),
    file: z.string().nullable(),
    prior: triageStoredDecisionSchema.nullable(),
  })
  .strict();
const triageSelectionSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("exact"),
      findingIds: z.array(z.string().min(1).max(512)).min(1).max(25),
    })
    .strict(),
  z
    .object({
      mode: z.literal("predicate"),
      filters: savedFilterSchema,
      excludedStableKeys: z.array(z.string().min(1).max(512)).max(2_000),
      total: z.number().int().nonnegative(),
    })
    .strict(),
]);
const triageWriteItemSchema = z
  .object({
    findingId: z.string().min(1).max(512),
    stableKey: z.string().min(1).max(512),
    status: z.enum(VEX_STATUSES),
    justification: z.enum(VEX_JUSTIFICATIONS).nullable(),
    response: z.enum(VEX_RESPONSES).nullable(),
    reason: z.string().trim().min(12).max(10_000),
    evidence: z.string().trim().min(1).max(20_000),
    pin: z.enum(["exact_version", "any_version"]),
    expectedSha256: z.string().length(64).nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.status === "NOT_AFFECTED" && item.justification === null) {
      context.addIssue({
        code: "custom",
        path: ["justification"],
        message: "NOT_AFFECTED requires a frozen VEX justification",
      });
    }
    if (item.status !== "NOT_AFFECTED" && item.justification !== null) {
      context.addIssue({
        code: "custom",
        path: ["justification"],
        message: "Justification is only valid for NOT_AFFECTED",
      });
    }
    if (
      item.justification === "CODE_NOT_REACHABLE" &&
      item.pin !== "exact_version"
    ) {
      context.addIssue({
        code: "custom",
        path: ["pin"],
        message: "CODE_NOT_REACHABLE requires exact_version",
      });
    }
  });
const triageWriteSuccessSchema = z
  .object({
    success: z.literal(true),
    findingId: z.string(),
    stableKey: z.string(),
    file: z.string(),
    afterSha256: z.string().length(64),
    undo: triageUndoTokenSchema,
  })
  .strict();
const triageWriteFailureSchema = z
  .object({
    success: z.literal(false),
    findingId: z.string(),
    stableKey: z.string(),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  })
  .strict();

const driftStates = [
  "reattached_noop",
  "reapply",
  "stale",
  "orphaned",
  "conflict",
  "needs_completion",
] as const satisfies readonly DriftState[];
const driftTotalsSchema = z
  .object(
    Object.fromEntries(
      driftStates.map((state) => [state, z.number().int().nonnegative()]),
    ) as Record<DriftState, z.ZodNumber>,
  )
  .strict();
const driftItemSchema = z
  .object({
    stableKey: z.string().min(1).max(2_048),
    state: z.enum(driftStates),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    reason: z.string().min(1).max(2_000),
    previousVersion: z.string().max(1_024).optional(),
    currentVersion: z.string().max(1_024).optional(),
  })
  .strict();
const driftReportSchema = z
  .object({
    pvId: z.string().min(1).max(512),
    runId: z.string().min(1).max(512),
    createdAt: z.string().min(1).max(128),
    unclassifiedCount: z.number().int().nonnegative(),
    totals: driftTotalsSchema,
    items: z.array(driftItemSchema).max(DRIFT_REPORT_MAX_LIMIT),
    nextCursor: z.string().max(2_048).nullable(),
  })
  .strict();
const driftScopeSchema = z
  .object({
    workspaceProjectId: z.string().min(1).max(512),
    platformProjectId: z.string().min(1).max(512),
    projectVersionId: z.string().min(1).max(512),
  })
  .strict();
export const findingsUiRpcContract = defineRpcContract({
  findingsDriftReport: {
    input: z
      .object({
        workspaceProjectId: z.string().min(1).max(512),
        platformProjectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        cursor: z.string().min(1).max(2_048).nullable(),
        limit: z.number().int().min(1).max(DRIFT_REPORT_MAX_LIMIT),
      })
      .strict(),
    output: driftReportSchema,
  },
  findingsDriftRefresh: {
    input: driftScopeSchema,
    output: driftReportSchema,
  },
  findingsDriftOrphanState: {
    input: z
      .object({
        workspaceProjectId: z.string().min(1).max(512),
        platformProjectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
      })
      .strict(),
    output: z
      .object({
        baseStateSha256: z.string().length(64),
        total: z.number().int().nonnegative(),
      })
      .strict(),
  },
  findingsPullAdvisories: {
    input: z
      .object({
        projectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        generationId: z.string().min(1).max(512),
      })
      .strict(),
    output: z
      .object({
        generationId: z.string().min(1).max(512),
        advisories: z.array(
          z
            .object({
              code: z.string().min(1).max(128),
              count: z.number().int().positive(),
            })
            .strict(),
        ),
      })
      .strict(),
  },
  findingsUiList: {
    input: findingsUiListInputSchema,
    output: rpcContract.findingsList.output,
  },
  cachedProjectVersions: {
    input: z.object({ projectId: z.string().min(1).max(512) }).strict(),
    output: z
      .object({
        versions: z.array(
          z
            .object({
              platformProjectId: z.string().min(1).max(512),
              projectVersionId: z.string().min(1).max(512),
              asOf: z.string().nullable(),
              state: z.enum(["fresh", "stale"]),
            })
            .strict(),
        ),
        selectedPlatformProjectId: z.string().min(1).max(512).nullable(),
        selectedProjectVersionId: z.string().min(1).max(512).nullable(),
      })
      .strict(),
  },
  findingsSavedViewsGet: {
    input: z.object({ projectId: z.string().min(1).max(512) }).strict(),
    output: savedViewsResultSchema,
  },
  findingsSavedViewsPut: {
    input: z
      .object({
        projectId: z.string().min(1).max(512),
        expectedSha256: z.string().length(64).nullable(),
        views: z.array(savedViewSchema).max(100),
      })
      .strict(),
    output: savedViewsResultSchema,
  },
  findingDetailGet: {
    input: z
      .object({
        projectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        stableKey: z.string().min(1).max(512),
      })
      .strict(),
    output: z
      .object({
        state: z.enum(["resolved", "stale", "orphaned"]),
        tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
        rows: z.array(rpcContract.findingsGet.output).max(200),
        cache: rpcContract.findingsList.output.shape.cache,
      })
      .strict(),
  },
  findingActivityRefresh: {
    input: z
      .object({
        projectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        findingId: z.string().min(1).max(512),
      })
      .strict(),
    output: z.object({ hydrated: z.number().int().nonnegative() }).strict(),
  },
  triageTargetsRead: {
    input: z
      .object({
        workspaceProjectId: z.string().min(1).max(512),
        platformProjectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        selection: triageSelectionSchema,
        continuation: z.string().min(1).max(4096).nullable(),
      })
      .strict(),
    output: z
      .object({
        items: z.array(triageTargetSchema).max(25),
        total: z.number().int().nonnegative(),
        next: z.string().nullable(),
      })
      .strict(),
  },
  triageDecisionsWrite: {
    input: z
      .object({
        workspaceProjectId: z.string().min(1).max(512),
        platformProjectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        decisions: z.array(triageWriteItemSchema).min(1).max(20),
      })
      .strict(),
    output: z
      .object({
        results: z
          .array(
            z.discriminatedUnion("success", [
              triageWriteSuccessSchema,
              triageWriteFailureSchema,
            ]),
          )
          .max(20),
      })
      .strict(),
  },
  triageDecisionUndo: {
    input: z
      .object({
        workspaceProjectId: z.string().min(1).max(512),
        platformProjectId: z.string().min(1).max(512),
        projectVersionId: z.string().min(1).max(512),
        findingId: z.string().min(1).max(512),
        stableKey: z.string().min(1).max(512),
        token: triageUndoTokenSchema,
      })
      .strict(),
    output: z
      .object({ file: z.string(), afterSha256: z.string().length(64) })
      .strict(),
  },
});

const SAVED_VIEWS_PATH = "product-security/findings/views.json";

async function projectSource(bb: BbPluginApi, projectId: string) {
  const project = await bb.sdk.projects.get({ projectId });
  const source =
    project.sources.find((candidate) => candidate.isDefault) ??
    project.sources[0];
  if (!source) throw new Error("FINDINGS_PROJECT_SOURCE_REQUIRED");
  return source;
}

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

function triageIdentity(finding: CachedFinding) {
  if (!finding.cve || !finding.componentName)
    throw new Error("TRIAGE_IDENTITY_INCOMPLETE");
  const component = {
    purl: finding.componentPurl,
    name: finding.componentName,
    group: finding.componentGroup,
    version: finding.componentVersion,
  };
  if (
    stableKeyFor(finding.projectId, component, finding.cve) !==
    finding.stableKey
  ) {
    throw new Error("TRIAGE_STABLE_KEY_MISMATCH");
  }
  return { cve: finding.cve, component };
}

function exactFinding(
  db: Database.Database,
  platformProjectId: string,
  projectVersionId: string,
  findingId: string,
): CachedFinding {
  const cached = getCachedFinding(
    db,
    platformProjectId,
    projectVersionId,
    findingId,
  );
  if (!cached.finding)
    throw new Error(`TRIAGE_FINDING_NOT_FOUND: ${findingId}`);
  return cached.finding;
}

function reachabilityEvidence(finding: CachedFinding): string {
  const factors = finding.reachabilityFactors;
  if (!Array.isArray(factors)) return "";
  return factors
    .flatMap((factor) => {
      if (
        typeof factor !== "object" ||
        factor === null ||
        Array.isArray(factor)
      )
        return [];
      const label =
        typeof factor["label"] === "string" ? factor["label"].trim() : "";
      const value =
        typeof factor["value"] === "string" ? factor["value"].trim() : "";
      const source =
        typeof factor["source"] === "string" ? factor["source"].trim() : "";
      if (!label || !value) return [];
      return [`${label}: ${value}${source ? ` (source: ${source})` : ""}`];
    })
    .join("\n");
}

interface TriageSnapshot {
  file: string | null;
  sha256: string | null;
  prior: TriageDecisionV1 | null;
}

type TriageCorpus = Awaited<ReturnType<typeof readOverlayFiles>>;

function sameTriageComponent(
  left: ParsedOverlayFile["overlay"]["component"],
  right: ParsedOverlayFile["overlay"]["component"],
): boolean {
  return (
    left.purl === right.purl &&
    left.name === right.name &&
    left.group === right.group &&
    left.version === right.version
  );
}

function triageSnapshot(
  corpus: TriageCorpus,
  finding: CachedFinding,
): TriageSnapshot {
  const identity = triageIdentity(finding);
  if (finding.localFile) {
    const scopedError = corpus.errors.find(
      (error) => error.file === finding.localFile,
    );
    if (scopedError)
      throw new Error(
        `TRIAGE_OVERLAY_INVALID: ${scopedError.file}: ${scopedError.message}`,
      );
  }
  const match = corpus.files.find(
    (candidate) =>
      candidate.overlay.project === finding.projectId &&
      sameTriageComponent(candidate.overlay.component, identity.component),
  );
  if (!match) return { file: null, sha256: null, prior: null };
  return {
    file: match.file,
    sha256: match.sha256,
    prior: match.overlay.decisions[identity.cve] ?? null,
  };
}

function triageTarget(corpus: TriageCorpus, finding: CachedFinding) {
  const identity = triageIdentity(finding);
  const snapshot = triageSnapshot(corpus, finding);
  const evidence = reachabilityEvidence(finding);
  return {
    findingId: finding.findingId,
    stableKey: finding.stableKey,
    cve: identity.cve,
    label: `${identity.cve} · ${identity.component.name}${identity.component.version ? ` ${identity.component.version}` : ""}`,
    component: identity.component,
    evidence,
    reasonSeed: evidence,
    expectedSha256: snapshot.sha256,
    file: snapshot.file,
    prior: snapshot.prior,
  };
}

function triageError(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "TRIAGE_WRITE_FAILED";
  const message =
    error instanceof Error
      ? error.message.slice(0, 500)
      : "The local triage write failed.";
  return {
    code,
    message,
    retryable: code === "OVERLAY_LOCK_HELD" || code === "OVERLAY_CAS_CONFLICT",
  };
}

async function lockBackoff<T>(action: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : null;
      if (code !== "OVERLAY_LOCK_HELD" || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

async function writeTriageDecision(
  root: string,
  corpus: TriageCorpus,
  finding: CachedFinding,
  item: z.output<typeof triageWriteItemSchema>,
  chainedExpected: string | null | undefined,
) {
  if (finding.stableKey !== item.stableKey)
    throw new Error("TRIAGE_EXACT_ROW_MISMATCH");
  const identity = triageIdentity(finding);
  const snapshot = triageSnapshot(corpus, finding);
  const expected =
    chainedExpected === undefined ? item.expectedSha256 : chainedExpected;
  if (snapshot.sha256 !== expected) {
    throw new OverlayCasConflictError(
      snapshot.file ?? `.fs/triage/${finding.projectId}`,
      expected ?? undefined,
      snapshot.sha256 ?? undefined,
    );
  }
  const decisionInput = {
    project: finding.projectId,
    component: identity.component,
    cve: identity.cve,
    stableKey: finding.stableKey,
    status: item.status,
    justification: item.justification,
    response: item.response,
    reason: item.reason,
    pin: item.pin,
    provenance: {
      by: "bb-user",
      at: new Date().toISOString(),
      evidence: item.evidence,
    },
    ...(snapshot.prior ? { sync: snapshot.prior.sync } : {}),
  };
  const result = await lockBackoff(() =>
    setDecision(root, decisionInput, snapshot.sha256 ?? undefined),
  );
  const current = corpus.files.find(
    (candidate) => candidate.file === result.file,
  );
  if (current) {
    current.sha256 = result.afterSha256;
    current.overlay.decisions[identity.cve] = decisionFromInput(decisionInput);
  } else {
    corpus.files.push({
      file: result.file,
      absoluteFile: join(root, result.file),
      sha256: result.afterSha256,
      overlay: {
        schema: TRIAGE_OVERLAY_SCHEMA,
        project: finding.projectId,
        component: identity.component,
        decisions: { [identity.cve]: decisionFromInput(decisionInput) },
      },
    });
  }
  return {
    success: true as const,
    findingId: finding.findingId,
    stableKey: finding.stableKey,
    file: result.file,
    afterSha256: result.afterSha256,
    undo: {
      file: result.file,
      beforeSha256: result.beforeSha256 ?? EMPTY_SHA256,
      afterSha256: result.afterSha256,
      prior: snapshot.prior,
    },
  };
}

function missingFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\bENOENT\b|not found|does not exist/iu.test(message);
}

function decodeFile(content: string, encoding: "utf8" | "base64"): string {
  return encoding === "utf8"
    ? content
    : Buffer.from(content, "base64").toString("utf8");
}

async function readSavedViews(bb: BbPluginApi, projectId: string) {
  const source = await projectSource(bb, projectId);
  const path = join(source.path, SAVED_VIEWS_PATH);
  try {
    const file = await bb.sdk.files.read({
      hostId: source.hostId,
      path,
      rootPath: source.path,
    });
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeFile(file.content, file.contentEncoding));
    } catch {
      decoded = null;
    }
    const parsed = savedViewsDocumentSchema.safeParse(decoded);
    if (parsed.success) {
      return {
        views: parsed.data.views,
        sha256: file.sha256,
        recoveredFromCorrupt: false,
      };
    }

    const quarantinePath = `${path}.corrupt-${file.sha256.slice(0, 12)}.json`;
    try {
      await bb.sdk.files.write({
        hostId: source.hostId,
        path: quarantinePath,
        rootPath: source.path,
        content: decodeFile(file.content, file.contentEncoding),
        contentEncoding: "utf8",
        createParents: true,
        expectedSha256: null,
      });
    } catch {
      // A previous read may already have quarantined these exact bytes.
    }
    const repaired = await bb.sdk.files.write({
      hostId: source.hostId,
      path,
      rootPath: source.path,
      content: `${JSON.stringify({ schema: "fs-findings-views/v1", views: [] }, null, 2)}\n`,
      contentEncoding: "utf8",
      createParents: true,
      expectedSha256: file.sha256,
    });
    if (repaired.outcome !== "written")
      throw new Error("FINDINGS_SAVED_VIEWS_CONFLICT");
    return { views: [], sha256: repaired.sha256, recoveredFromCorrupt: true };
  } catch (error) {
    if (missingFile(error))
      return { views: [], sha256: null, recoveredFromCorrupt: false };
    throw error;
  }
}

async function writeSavedViews(
  bb: BbPluginApi,
  input: {
    projectId: string;
    expectedSha256: string | null;
    views: z.output<typeof savedViewSchema>[];
  },
) {
  const source = await projectSource(bb, input.projectId);
  const result = await bb.sdk.files.write({
    hostId: source.hostId,
    path: join(source.path, SAVED_VIEWS_PATH),
    rootPath: source.path,
    content: `${JSON.stringify({ schema: "fs-findings-views/v1", views: input.views }, null, 2)}\n`,
    contentEncoding: "utf8",
    createParents: true,
    expectedSha256: input.expectedSha256,
  });
  if (result.outcome !== "written")
    throw new Error("FINDINGS_SAVED_VIEWS_CONFLICT");
  return {
    views: input.views,
    sha256: result.sha256,
    recoveredFromCorrupt: false,
  };
}

function requireVersion(projectVersionId: string | null): string {
  if (projectVersionId === null)
    throw new Error("FINDINGS_PROJECT_VERSION_REQUIRED");
  return projectVersionId;
}

function stringArray(
  filters: Record<string, JsonValue>,
  key: string,
): string[] | undefined {
  const value = filters[key];
  if (!Array.isArray(value)) return undefined;
  const result = value.filter(
    (item): item is string => typeof item === "string",
  );
  return result.length > 0 ? result : undefined;
}

function stringValue(
  filters: Record<string, JsonValue>,
  key: string,
): string | undefined {
  const value = filters[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(
  filters: Record<string, JsonValue>,
  key: string,
): number | undefined {
  const value = filters[key];
  return typeof value === "number" ? value : undefined;
}

function booleanValue(
  filters: Record<string, JsonValue>,
  key: string,
): boolean | undefined {
  const value = filters[key];
  return typeof value === "boolean" ? value : undefined;
}

function findingFilter(input: {
  projectId: string;
  projectVersionId: string | null;
  pageSize: number;
  continuation: string | null;
  filters?: Record<string, JsonValue>;
}): FindingsFilter {
  const filters = input.filters ?? {};
  const reachability = stringValue(filters, "reachability");
  const kev = stringValue(filters, "kev");
  if (
    reachability &&
    reachability !== "reachable" &&
    reachability !== "unreachable" &&
    reachability !== "unknown"
  ) {
    throw new Error("FINDINGS_FILTER_INVALID: reachability");
  }
  if (kev && kev !== "kev" && kev !== "vc-kev" && kev !== "none") {
    throw new Error("FINDINGS_FILTER_INVALID: kev");
  }
  const normalizedReachability = reachability as FindingsFilter["reachability"];
  const normalizedKev = kev as FindingsFilter["kev"];
  return {
    projectId: input.projectId,
    pvId: requireVersion(input.projectVersionId),
    limit: input.pageSize,
    ...(input.continuation ? { cursor: input.continuation } : {}),
    ...(stringArray(filters, "severity")
      ? { severity: stringArray(filters, "severity") }
      : {}),
    ...(normalizedReachability ? { reachability: normalizedReachability } : {}),
    ...(normalizedKev ? { kev: normalizedKev } : {}),
    ...(numberValue(filters, "epssGte") !== undefined
      ? { epssGte: numberValue(filters, "epssGte") }
      : {}),
    ...(stringValue(filters, "component")
      ? { component: stringValue(filters, "component") }
      : {}),
    ...(stringValue(filters, "cve")
      ? { cve: stringValue(filters, "cve") }
      : {}),
    ...(stringArray(filters, "triage")
      ? { triage: stringArray(filters, "triage") }
      : {}),
    ...(stringArray(filters, "findingType")
      ? { findingType: stringArray(filters, "findingType") }
      : {}),
    ...(booleanValue(filters, "hasLocalChange") !== undefined
      ? { hasLocalChange: booleanValue(filters, "hasLocalChange") }
      : {}),
    ...(stringArray(filters, "localState")
      ? {
          localState: stringArray(filters, "localState")?.filter(
            (
              value,
            ): value is NonNullable<FindingsFilter["localState"]>[number] =>
              value === "none" ||
              value === "local" ||
              value === "conflicted" ||
              value === "stale" ||
              value === "needs_completion",
          ),
        }
      : {}),
  };
}

function fields(finding: CachedFinding): Record<string, JsonValue> {
  return {
    stableKey: finding.stableKey,
    findingType: finding.findingType,
    cve: finding.cve,
    title: finding.title,
    componentName: finding.componentName,
    componentGroup: finding.componentGroup,
    componentVersion: finding.componentVersion,
    componentPurl: finding.componentPurl,
    severity: finding.severity,
    riskScore: finding.riskScore,
    band: finding.band,
    cvssScore: finding.cvssScore,
    cvssVector: finding.cvssVector,
    epssScore: finding.epssScore,
    epssPercentile: finding.epssPercentile,
    inKev: finding.inKev,
    inVcKev: finding.inVcKev,
    hasExploit: finding.hasExploit,
    exploitMaturity: finding.exploitMaturity,
    reachabilityScore: finding.reachabilityScore,
    reachabilityVerdict: finding.reachabilityVerdict,
    reachabilityFactors: finding.reachabilityFactors,
    vulnInDataset: finding.vulnInDataset,
    cwes: finding.cwes,
    warningCount: finding.warningCount,
    violationCount: finding.violationCount,
    location: finding.location,
    vexStatus: finding.vexStatus,
    vexResponse: finding.vexResponse,
    vexJustification: finding.vexJustification,
    vexReason: finding.vexReason,
    commentCount: finding.comments.length,
    firstSeen: finding.firstSeen,
    softDeleted: finding.softDeleted,
    pulledAt: finding.pulledAt,
    localState: finding.localState,
    localFile: finding.localFile,
  };
}

interface LocalVexRow {
  vex_status: string | null;
  vex_response: string | null;
  vex_justification: string | null;
  vex_reason: string | null;
  evidence: string | null;
  file_path: string;
  local_state: string;
  drift_state: string | null;
}

function projectedLocalState(
  row: LocalVexRow | undefined,
): "none" | "local" | "conflicted" | "stale" | "needs_completion" {
  if (!row) return "none";
  if (row.local_state === "conflict" || row.drift_state === "conflict")
    return "conflicted";
  if (
    row.local_state === "needs_completion" ||
    row.drift_state === "needs_completion"
  )
    return "needs_completion";
  if (
    row.local_state === "stale" ||
    row.drift_state === "stale" ||
    row.drift_state === "orphaned"
  )
    return "stale";
  return "local";
}

function localVexFields(
  db: Database.Database,
  finding: CachedFinding,
): Record<string, JsonValue> {
  const row = db
    .prepare(
      `SELECT vex_status, vex_response, vex_justification, vex_reason, evidence,
            file_path, local_state, drift_state
       FROM overlay_index
      WHERE project_id = ? AND project_version_id = ?
        AND entity_kind = 'vexDecision' AND stable_key = ?`,
    )
    .get(finding.projectId, finding.projectVersionId, finding.stableKey) as
    | LocalVexRow
    | undefined;
  return {
    ...fields(finding),
    localVexStatus: row?.vex_status ?? null,
    localVexResponse: row?.vex_response ?? null,
    localVexJustification: row?.vex_justification ?? null,
    localVexReason: row?.vex_reason ?? null,
    localEvidence: row?.evidence ?? null,
    localState: projectedLocalState(row),
    localFile: row?.file_path ?? null,
    componentSlug:
      typeof finding.raw["componentSlug"] === "string"
        ? finding.raw["componentSlug"]
        : typeof finding.raw["architectureComponentSlug"] === "string"
          ? finding.raw["architectureComponentSlug"]
          : null,
    remediation:
      typeof finding.raw["remediation"] === "string"
        ? finding.raw["remediation"]
        : typeof finding.raw["recommendation"] === "string"
          ? finding.raw["recommendation"]
          : null,
  };
}

function summary(finding: CachedFinding) {
  return {
    projectId: finding.projectId,
    projectVersionId: finding.projectVersionId,
    kind: "finding",
    key: finding.findingId,
    label: finding.title ?? finding.cve ?? finding.findingId,
    fields: fields(finding),
  };
}

function findingsListResult(
  db: Database.Database,
  input: z.output<typeof findingsUiListInputSchema>,
) {
  const page = queryFindings(db, findingFilter(input));
  return {
    items: page.items.map(summary),
    total: page.total,
    next: page.nextCursor,
    cache: page.cache,
  };
}

function acceptedPlatformProjectId(
  db: Database.Database,
  workspaceProjectId: string,
  projectVersionId: string,
): string {
  const rows = db
    .prepare<[string, string], { platform_project_id: string }>(
      `SELECT DISTINCT binding.platform_project_id
         FROM workspace_platform_project_binding binding
         JOIN sync_state s
           ON s.project_id = binding.platform_project_id
          AND s.project_version_id = ?
          AND s.entity_kind = 'finding'
          AND s.accepted_generation_id IS NOT NULL
        WHERE binding.workspace_project_id = ?
        ORDER BY binding.platform_project_id ASC
        LIMIT 2`,
    )
    .all(projectVersionId, workspaceProjectId);
  if (rows.length !== 1) throw new Error("FINDINGS_ACCEPTED_SCOPE_REQUIRED");
  return rows[0]!.platform_project_id;
}

function continuationOffset(value: string | null): number {
  if (value === null) return 0;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("VENDOR_IMPORT_CONTINUATION_INVALID");
  }
  return offset;
}

function vendorVexReport(
  db: Database.Database,
  input: {
    projectId: string;
    projectVersionId: string | null;
    pageSize: number;
    continuation: string | null;
  },
  result: VendorImportResult & { importId: string },
  platformProjectId: string,
) {
  const projectVersionId = requireVersion(input.projectVersionId);
  const offset = continuationOffset(input.continuation);
  const page = result.proposals.slice(offset, offset + input.pageSize);
  const nextOffset = offset + page.length;
  return {
    projectId: platformProjectId,
    projectVersionId,
    importId: result.importId,
    format: result.source.format,
    documentSha256: result.source.digest,
    items: page.map((proposal) => {
      const sourceKey = proposal.stableKey ?? proposal.sourceRef;
      return {
        projectId: platformProjectId,
        projectVersionId,
        kind: "vendorVexProposal",
        key:
          sourceKey.length <= 512
            ? sourceKey
            : `vendor-proposal-${createHash("sha256").update(sourceKey).digest("hex")}`,
        label: proposal.sourceRef.slice(0, 1_000),
        fields: {
          state: proposal.state,
          stableKey: proposal.stableKey ?? null,
          sourceRef: proposal.sourceRef,
        },
      };
    }),
    total: result.proposals.length,
    next: nextOffset < result.proposals.length ? String(nextOffset) : null,
    matched: result.matched,
    unmatched: result.unmatched,
    written: result.written,
    errors: result.errors.length,
    cache: findingsCacheState(db, platformProjectId, projectVersionId),
  };
}

export function registerFindingsRpc(
  bb: BbPluginApi,
  db: Database.Database,
  deps: {
    hydrateActivity?: (input: {
      projectId: string;
      projectVersionId: string;
      findingId: string;
    }) => Promise<number>;
    pullAdvisories?: (input: {
      projectId: string;
      projectVersionId: string;
      generationId: string;
    }) => Promise<ReadonlyArray<{ code: string; count: number }>>;
    drift?: FindingsDriftService;
  } = {},
): void {
  bb.rpc.register(findingsRpcContract, {
    findingsList(input) {
      const page = queryFindings(db, findingFilter(input));
      return {
        items: page.items.map(summary),
        total: page.total,
        next: page.nextCursor,
        cache: page.cache,
      };
    },
    findingsGet(input) {
      const pvId = requireVersion(input.projectVersionId);
      const cached = getCachedFinding(
        db,
        input.projectId,
        pvId,
        input.findingId,
      );
      if (!cached.finding) throw new Error("FINDING_NOT_FOUND");
      return { ...summary(cached.finding), links: [], cache: cached.cache };
    },
    findingsActivityList(input) {
      // pagedScopedInput's frozen helper erases its extra-field type while its
      // runtime schema still validates and retains findingId.
      const findingId = (input as typeof input & { findingId: string })
        .findingId;
      const pvId = requireVersion(input.projectVersionId);
      const page = listFindingActivity(db, {
        projectId: input.projectId,
        projectVersionId: pvId,
        findingId,
        limit: input.pageSize,
        ...(input.continuation ? { cursor: input.continuation } : {}),
      });
      return {
        items: page.items.map((item) => ({
          projectId: item.projectId,
          projectVersionId: item.projectVersionId,
          kind: "findingActivity",
          key: item.eventId,
          label: item.source ?? item.eventId,
          fields: {
            findingId: item.findingId,
            stableKey: item.stableKey,
            actor: item.actor,
            at: item.eventAt,
            source: item.source,
            old: item.oldTuple,
            new: item.newTuple,
            pulledAt: item.pulledAt,
          },
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    findingsCommentsList(input) {
      // See the frozen pagedScopedInput type-erasure note above.
      const findingId = (input as typeof input & { findingId: string })
        .findingId;
      const pvId = requireVersion(input.projectVersionId);
      const page = listFindingComments(db, {
        projectId: input.projectId,
        projectVersionId: pvId,
        findingId,
        limit: input.pageSize,
        ...(input.continuation ? { cursor: input.continuation } : {}),
      });
      return {
        items: page.items.map((comment) => ({
          projectId: input.projectId,
          projectVersionId: pvId,
          id: comment.id,
          findingId: comment.findingId,
          actorLabel: comment.actorLabel,
          text: comment.text,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          carriesAcrossVersions: false as const,
        })),
        total: page.total,
        next: page.next,
        cache: page.cache,
      };
    },
    findingsCommentsCreate() {
      return commentMutationAuthorizationUnavailable();
    },
    findingsCommentsUpdate() {
      return commentMutationAuthorizationUnavailable();
    },
    findingsCommentsDelete() {
      return commentMutationAuthorizationUnavailable();
    },
    findingsFacets(input) {
      const pvId = requireVersion(input.projectVersionId);
      const page = queryFindings(db, {
        projectId: input.projectId,
        pvId,
        limit: 1,
      });
      return {
        projectId: input.projectId,
        projectVersionId: pvId,
        severity: page.facets.severity ?? {},
        triage: page.facets.triage ?? {},
        total: page.total,
        cache: page.cache,
      };
    },
    async triageVendorVexPreview(input) {
      if (!deps.drift) throw new Error("FINDINGS_DRIFT_UNAVAILABLE");
      const projectVersionId = requireVersion(input.projectVersionId);
      const extended = input as typeof input & {
        documentSha256: string;
        vendor: string;
      };
      const platformProjectId = acceptedPlatformProjectId(
        db,
        input.projectId,
        projectVersionId,
      );
      const source = await projectSource(bb, input.projectId);
      const result = await deps.drift.previewVendorVex({
        root: source.path,
        projectId: platformProjectId,
        pvId: projectVersionId,
        documentSha256: extended.documentSha256,
        vendor: extended.vendor,
      });
      return vendorVexReport(db, input, result, platformProjectId);
    },
    async triageVendorVexApply(input) {
      if (!deps.drift) throw new Error("FINDINGS_DRIFT_UNAVAILABLE");
      const projectVersionId = requireVersion(input.projectVersionId);
      const extended = input as typeof input & {
        importId: string;
        expectedDocumentSha256: string;
        overwrite: boolean;
      };
      const platformProjectId = acceptedPlatformProjectId(
        db,
        input.projectId,
        projectVersionId,
      );
      const source = await projectSource(bb, input.projectId);
      const result = await deps.drift.applyVendorVex({
        root: source.path,
        projectId: platformProjectId,
        pvId: projectVersionId,
        importId: extended.importId,
        expectedDocumentSha256: extended.expectedDocumentSha256,
        overwrite: extended.overwrite,
      });
      return vendorVexReport(db, input, result, platformProjectId);
    },
    async triageOrphansPrune(input) {
      if (!deps.drift) throw new Error("FINDINGS_DRIFT_UNAVAILABLE");
      const projectVersionId = requireVersion(input.projectVersionId);
      const extended = input as typeof input & {
        stableKeys: string[];
        expectedBaseStateSha256: string;
      };
      const platformProjectId = acceptedPlatformProjectId(
        db,
        input.projectId,
        projectVersionId,
      );
      const source = await projectSource(bb, input.projectId);
      const result = await deps.drift.pruneOrphans({
        root: source.path,
        projectId: platformProjectId,
        pvId: projectVersionId,
        stableKeys: extended.stableKeys,
        expectedBaseStateSha256: extended.expectedBaseStateSha256,
      });
      return {
        projectId: input.projectId,
        projectVersionId,
        runId: `orphan-prune-${result.baseStateSha256.slice(0, 24)}`,
        total: result.selected,
        applied: result.pruned,
        failed: result.selected - result.pruned,
        results: result.results,
      };
    },
  });
  bb.rpc.register(findingsUiRpcContract, {
    findingsDriftReport(input) {
      if (!deps.drift) throw new Error("FINDINGS_DRIFT_UNAVAILABLE");
      assertAcceptedFindingsScope(db, input);
      return deps.drift.report({
        projectId: input.platformProjectId,
        pvId: input.projectVersionId,
        cursor: input.cursor,
        limit: input.limit,
      });
    },
    async findingsDriftRefresh(input) {
      if (!deps.drift) throw new Error("FINDINGS_DRIFT_UNAVAILABLE");
      assertAcceptedFindingsScope(db, input);
      const source = await projectSource(bb, input.workspaceProjectId);
      return deps.drift.refresh({
        root: source.path,
        projectId: input.platformProjectId,
        pvId: input.projectVersionId,
      });
    },
    findingsDriftOrphanState(input) {
      if (!deps.drift) throw new Error("FINDINGS_DRIFT_UNAVAILABLE");
      assertAcceptedFindingsScope(db, input);
      return deps.drift.orphanState({
        projectId: input.platformProjectId,
        pvId: input.projectVersionId,
      });
    },
    async findingsPullAdvisories(input) {
      return {
        generationId: input.generationId,
        advisories: deps.pullAdvisories
          ? [...(await deps.pullAdvisories(input))]
          : [],
      };
    },
    findingsUiList(input) {
      return findingsListResult(db, input);
    },
    async cachedProjectVersions(input) {
      await projectSource(bb, input.projectId);
      backfillUnambiguousWorkspaceProjectBinding(db, input.projectId);
      const rows = db
        .prepare(
          `SELECT s.project_id, s.project_version_id, MAX(s.last_pull) AS as_of,
                MAX(CASE WHEN s.error IS NOT NULL THEN 1 ELSE 0 END) AS stale
           FROM sync_state s
          WHERE ${WORKSPACE_PLATFORM_PROJECT_PREDICATE}
            AND s.entity_kind = 'finding'
            AND s.accepted_generation_id IS NOT NULL
          GROUP BY s.project_id, s.project_version_id
          ORDER BY as_of DESC, s.project_id ASC, s.project_version_id ASC`,
        )
        .all(input.projectId) as Array<{
        project_id: string;
        project_version_id: string;
        as_of: string | null;
        stale: number;
      }>;
      const versions = rows.map((row) => ({
        platformProjectId: row.project_id,
        projectVersionId: row.project_version_id,
        asOf: row.as_of,
        state: row.stale === 1 ? ("stale" as const) : ("fresh" as const),
      }));
      return {
        versions,
        selectedPlatformProjectId: versions[0]?.platformProjectId ?? null,
        selectedProjectVersionId: versions[0]?.projectVersionId ?? null,
      };
    },
    findingsSavedViewsGet(input) {
      return readSavedViews(bb, input.projectId);
    },
    findingsSavedViewsPut(input) {
      return writeSavedViews(bb, input);
    },
    findingDetailGet(input) {
      // Stable route attributes are untrusted. The frozen codec must reject
      // them before the first cache read or prepared statement.
      parseEncodedFindingKey(input.stableKey);
      const resolution = resolveEncodedFinding(
        db,
        input.stableKey,
        input.projectId,
        input.projectVersionId,
      );
      const cache = findingsCacheState(
        db,
        input.projectId,
        input.projectVersionId,
      );
      const rows =
        resolution.state === "orphaned"
          ? []
          : resolution.state === "stale"
            ? resolution.candidates
            : resolution.rows;
      const tier = resolution.state === "resolved" ? resolution.tier : null;
      return {
        state: resolution.state,
        tier,
        rows: rows.map((finding) => ({
          ...summary(finding),
          fields: localVexFields(db, finding),
          links: [],
          cache,
        })),
        cache,
      };
    },
    async findingActivityRefresh(input) {
      if (!deps.hydrateActivity)
        throw new Error("FINDING_ACTIVITY_REFRESH_UNAVAILABLE");
      return { hydrated: await deps.hydrateActivity(input) };
    },
    async triageTargetsRead(input) {
      const source = await projectSource(bb, input.workspaceProjectId);
      const corpus = await readOverlayFiles(source.path);
      if (input.selection.mode === "exact") {
        const findings = input.selection.findingIds.map((findingId) =>
          exactFinding(
            db,
            input.platformProjectId,
            input.projectVersionId,
            findingId,
          ),
        );
        return {
          items: findings.map((finding) => triageTarget(corpus, finding)),
          total: findings.length,
          next: null,
        };
      }
      const page = queryFindings(
        db,
        findingFilter({
          projectId: input.platformProjectId,
          projectVersionId: input.projectVersionId,
          pageSize: 25,
          continuation: input.continuation,
          filters: input.selection.filters,
        }),
      );
      const excluded = new Set(input.selection.excludedStableKeys);
      const findings = page.items.filter(
        (finding) => !excluded.has(finding.stableKey),
      );
      return {
        items: findings.map((finding) => triageTarget(corpus, finding)),
        total: Math.max(
          0,
          input.selection.total - input.selection.excludedStableKeys.length,
        ),
        next: page.nextCursor,
      };
    },
    async triageDecisionsWrite(input) {
      const source = await projectSource(bb, input.workspaceProjectId);
      const corpus = await readOverlayFiles(source.path);
      const chainedSha = new Map<string, string>();
      const results: Array<
        | z.output<typeof triageWriteSuccessSchema>
        | z.output<typeof triageWriteFailureSchema>
      > = [];
      for (const item of input.decisions) {
        let finding: CachedFinding | null = null;
        try {
          finding = exactFinding(
            db,
            input.platformProjectId,
            input.projectVersionId,
            item.findingId,
          );
          const identity = triageIdentity(finding);
          const chainKey = JSON.stringify(identity.component);
          const result = await writeTriageDecision(
            source.path,
            corpus,
            finding,
            item,
            chainedSha.get(chainKey),
          );
          chainedSha.set(chainKey, result.afterSha256);
          results.push(result);
        } catch (error) {
          const failure = triageError(error);
          results.push({
            success: false,
            findingId: item.findingId,
            stableKey: finding?.stableKey ?? item.stableKey,
            ...failure,
          });
        }
      }
      return { results };
    },
    async triageDecisionUndo(input) {
      const source = await projectSource(bb, input.workspaceProjectId);
      const finding = exactFinding(
        db,
        input.platformProjectId,
        input.projectVersionId,
        input.findingId,
      );
      if (finding.stableKey !== input.stableKey)
        throw new Error("TRIAGE_EXACT_ROW_MISMATCH");
      const identity = triageIdentity(finding);
      const corpus = await readOverlayFiles(source.path);
      const snapshot = triageSnapshot(corpus, finding);
      if (
        snapshot.sha256 !== input.token.afterSha256 ||
        snapshot.file !== input.token.file
      ) {
        throw new OverlayCasConflictError(
          input.token.file,
          input.token.afterSha256,
          snapshot.sha256 ?? undefined,
        );
      }
      const prior = input.token.prior;
      const result =
        prior === null
          ? await lockBackoff(() =>
              removeDecision(
                source.path,
                {
                  project: finding.projectId,
                  component: identity.component,
                  cve: identity.cve,
                  stableKey: finding.stableKey,
                },
                input.token.afterSha256,
              ),
            )
          : await lockBackoff(() =>
              setDecision(
                source.path,
                {
                  project: finding.projectId,
                  component: identity.component,
                  cve: identity.cve,
                  stableKey: finding.stableKey,
                  status: prior.status,
                  justification: prior.justification,
                  response: prior.response,
                  reason: prior.reason,
                  pin: prior.pin,
                  provenance: prior.provenance,
                  sync: prior.sync,
                },
                input.token.afterSha256,
              ),
            );
      return { file: result.file, afterSha256: result.afterSha256 };
    },
  });
}
