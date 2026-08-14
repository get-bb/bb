import type { BbPluginApi } from "@bb/plugin-sdk";
import type { PluginContext } from "../../lib/context.js";
import type { RemoteServices } from "../../lib/remote/types.js";
import type { NamespacedCliRunner } from "../sync/cli.js";
import { registerCachePuller } from "../sync/engine/adapter.js";
import { hydrateFindingActivity } from "./cache/activity.js";
import { hydrateFindingComments } from "./cache/comments.js";
import { pullFindings } from "./cache/pull.js";
import { registerFindingsBulk } from "./bulk/index.js";
import {
  registerFindingsDrift,
  type FindingsDriftService,
} from "./drift/index.js";
import { registerFindingsOverlay } from "./overlay/index.js";
import { registerFindingsPolicyStub } from "./policy/index.js";
import { registerFindingsStableKeyStub } from "./stable-key/index.js";
import { registerFindingsRpc } from "./rpc.js";
import { createFindingsCliRunner } from "./cli.js";
import { assertAcceptedFindingsScope } from "./scope.js";
import { MAX_VENDOR_VEX_BYTES } from "./drift/vendor/parse.js";

interface PersistedPullAdvisories {
  generationId: string;
  advisories: ReadonlyArray<{ code: string; count: number }>;
}

function persistedPullAdvisories(
  value: unknown,
): PersistedPullAdvisories | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const generationId = Reflect.get(value, "generationId");
  const rawAdvisories = Reflect.get(value, "advisories");
  if (typeof generationId !== "string" || !Array.isArray(rawAdvisories)) {
    return null;
  }
  const advisories: Array<{ code: string; count: number }> = [];
  for (const advisory of rawAdvisories) {
    if (
      typeof advisory !== "object" ||
      advisory === null ||
      Array.isArray(advisory)
    ) {
      return null;
    }
    const code = Reflect.get(advisory, "code");
    const count = Reflect.get(advisory, "count");
    if (
      typeof code !== "string" ||
      code.length === 0 ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count <= 0
    ) {
      return null;
    }
    advisories.push({ code, count });
  }
  return { generationId, advisories };
}

function pullAdvisoryKey(projectId: string, projectVersionId: string): string {
  return `findings/pull-advisories/${Buffer.from(
    JSON.stringify([projectId, projectVersionId]),
  ).toString("base64url")}`;
}

export function registerFindings(bb: BbPluginApi, ctx: PluginContext): void {
  const db = ctx.db();
  const remote = ctx.service<RemoteServices>("remote-services", () => {
    throw new Error("Findings registration requires remote services");
  });
  registerCachePuller("finding", async (scope, generationId, onProgress) => {
    const advisoryKey = pullAdvisoryKey(
      scope.projectId,
      scope.projectVersionId ?? "",
    );
    const prior = persistedPullAdvisories(
      await bb.storage.kv.get<unknown>(advisoryKey),
    );
    const advisoryCounts = new Map<string, number>(
      prior?.generationId === generationId
        ? prior.advisories.map(({ code, count }) => [code, count])
        : [],
    );
    const checkpointAdvisories = async (
      reasons: ReadonlyArray<{ code: string; count: number }>,
    ) => {
      for (const { code, count } of reasons) {
        advisoryCounts.set(code, (advisoryCounts.get(code) ?? 0) + count);
      }
      await bb.storage.kv.set(advisoryKey, {
        generationId,
        advisories: [...advisoryCounts.entries()]
          .map(([code, count]) => ({ code, count }))
          .sort((left, right) => left.code.localeCompare(right.code)),
      } satisfies PersistedPullAdvisories);
    };
    const result = await pullFindings(
      {
        db,
        platform: remote.platform,
        warn(message, details) {
          ctx.log.warn(
            `${message}: ${details.count} for project version ${details.projectVersionId}`,
          );
        },
        quarantine({ count, reasons }) {
          const breakdown = reasons
            .map(({ code, count: reasonCount }) => `${code}=${reasonCount}`)
            .join(", ");
          ctx.log.warn(
            `Quarantined Platform finding rows with invalid identity: ${count}; reasons [${breakdown}]`,
          );
        },
        advisory: ({ reasons }) => checkpointAdvisories(reasons),
      },
      scope,
      generationId,
      (progress) => {
        onProgress({ page: progress.page, of: progress.of });
        bb.realtime.publish("fs-findings-pull", {
          pvId: scope.projectVersionId,
          ...progress,
        });
      },
    );
    const advisories =
      advisoryCounts.size > 0
        ? [...advisoryCounts.entries()]
            .map(([code, count]) => ({ code, count }))
            .sort((left, right) => left.code.localeCompare(right.code))
        : [...result.advisories];
    await bb.storage.kv.set(advisoryKey, {
      generationId,
      advisories,
    } satisfies PersistedPullAdvisories);
    return {
      fetched: result.fetched,
      baseRows: result.published,
      quarantined: result.quarantined,
      advisories,
    };
  });
  ctx.service("findings.hydration", () => ({
    activity: (input: {
      projectId: string;
      projectVersionId: string;
      findingId: string;
    }) => hydrateFindingActivity(db, remote.platform, input),
    comments: (input: {
      projectId: string;
      projectVersionId: string;
      findingId: string;
    }) => hydrateFindingComments(db, remote.platform, input),
  }));
  registerFindingsDrift(ctx);
  const drift = ctx.service<FindingsDriftService>("findings.drift", () => {
    throw new Error("Findings drift services are unavailable");
  });
  bb.http.route(
    "POST",
    "/findings/vendor-vex/document",
    async (http) => {
      const workspaceProjectId =
        http.req.header("x-fs-workspace-project")?.trim() ?? "";
      const platformProjectId =
        http.req.header("x-fs-platform-project")?.trim() ?? "";
      const projectVersionId =
        http.req.header("x-fs-project-version")?.trim() ?? "";
      if (
        !workspaceProjectId ||
        !platformProjectId ||
        !projectVersionId ||
        workspaceProjectId.length > 512 ||
        platformProjectId.length > 512 ||
        projectVersionId.length > 512
      ) {
        return http.json({ error: "FINDINGS_SCOPE_REQUIRED" }, 400);
      }
      assertAcceptedFindingsScope(db, {
        workspaceProjectId,
        platformProjectId,
        projectVersionId,
      });
      const declaredLength = Number(http.req.header("content-length") ?? "0");
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength < 1 ||
        declaredLength > MAX_VENDOR_VEX_BYTES
      ) {
        return http.json({ error: "VENDOR_FILE_OVERSIZED" }, 413);
      }
      const bytes = new Uint8Array(await http.req.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_VENDOR_VEX_BYTES) {
        return http.json({ error: "VENDOR_FILE_OVERSIZED" }, 413);
      }
      let file = "vendor-vex.json";
      try {
        file = decodeURIComponent(http.req.header("x-fs-vendor-file") ?? file);
      } catch {
        return http.json({ error: "VENDOR_FILE_INVALID" }, 400);
      }
      if (file.length > 1_024) {
        return http.json({ error: "VENDOR_FILE_INVALID" }, 400);
      }
      return http.json(
        drift.stageVendorDocument({
          projectId: platformProjectId,
          pvId: projectVersionId,
          file,
          bytes,
        }),
      );
    },
    { auth: "local" },
  );
  ctx.service<{ run: NamespacedCliRunner }>("findings.cli", () => ({
    run: createFindingsCliRunner(bb, drift, (input) =>
      assertAcceptedFindingsScope(db, input),
    ),
  }));
  registerFindingsRpc(bb, db, {
    drift,
    hydrateActivity: (input) =>
      hydrateFindingActivity(db, remote.platform, input),
    async pullAdvisories(input) {
      const value = persistedPullAdvisories(
        await bb.storage.kv.get<unknown>(
          pullAdvisoryKey(input.projectId, input.projectVersionId),
        ),
      );
      return value?.generationId === input.generationId ? value.advisories : [];
    },
  });
  registerFindingsStableKeyStub(db);
  registerFindingsOverlay(ctx);
  registerFindingsPolicyStub();
  registerFindingsBulk({
    db,
    platform: remote.platform,
    publish: (progress) =>
      bb.realtime.publish("fs-vex-push-progress", progress),
  });
}
