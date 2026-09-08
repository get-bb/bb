import { createVerificationService } from "./verification.js";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ResolvedSettings } from "../configuration.js";
import {
  fetchBaseArtifact,
  artifactMetadataSchema,
  type BaseArtifact,
} from "./artifact.js";
import { baseManifest } from "./base.js";
import { createImageBackend, type ImageBackendFactory } from "./backend.js";
import { acceptChunk, chunkSchema, contextFiles } from "./context.js";
import { modalRpcContract } from "./contract.js";
import {
  CatalogueError,
  hash,
  verificationSchema,
  type Build,
} from "./model.js";
import {
  inspectionSchema,
  sourceContract,
  isLockfile,
} from "./source-contract.js";
import { createBuildLogWriter } from "./logs.js";
import { Catalogue } from "./store.js";

export const accountIdentity = (
  settings: ResolvedSettings,
  factory: ImageBackendFactory = createImageBackend,
) => factory(settings).accountIdentity();
export const GC_GRACE_MS = 60 * 1000;
export function createCatalogueService(
  bb: BbPluginApi,
  settings: () => Promise<ResolvedSettings>,
  backendFactory: ImageBackendFactory = createImageBackend,
  now = Date.now,
  loadArtifact: () => Promise<BaseArtifact> = () =>
    fetchBaseArtifact(bb.server.loopbackBaseUrl),
) {
  const store = new Catalogue(bb.storage.database(), bb.storage, now);
  const verifications = createVerificationService(bb, store);
  const hosts = bb.hosts.experimental_client({ contract: sourceContract });
  const uploadPath = "/context-chunk";
  const uploadUrl = () =>
    `${bb.server.experimental_appUrl ?? bb.server.loopbackBaseUrl}/api/v1/plugins/${bb.pluginId}/http${uploadPath}`;
  async function source(projectId: string, environmentId: string) {
    await bb.sdk.projects.get({ projectId });
    const environment = await bb.sdk.environments.get({ environmentId });
    if (environment.projectId !== projectId || !environment.path)
      throw new CatalogueError(
        400,
        "Choose a source environment in this project with a checkout",
      );
    return environment;
  }
  async function inspect(projectId: string, environmentId: string) {
    await assertProject(projectId);
    try {
      const environment = await source(projectId, environmentId);
      const result = await hosts.call(
        "inspect",
        { path: environment.path!, hostId: environment.hostId },
        { hostId: environment.hostId },
      );
      store.db
        .prepare(
          "INSERT INTO source_observations VALUES (?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at",
        )
        .run(store.owner, projectId, JSON.stringify(result), now());
      return result;
    } catch (error) {
      store.db
        .prepare(
          "DELETE FROM source_observations WHERE user_id=? AND project_id=?",
        )
        .run(store.owner, projectId);
      throw error;
    }
  }
  async function assertProject(projectId: string) {
    await bb.sdk.projects.get({ projectId });
  }
  const handlers: PluginRpcHandlers<typeof modalRpcContract> = {
    "catalogue.projects": async () =>
      (await bb.sdk.projects.list()).map(({ id, name }) => ({ id, name })),
    "project.sources": async ({ projectId }) => {
      await assertProject(projectId);
      const sources = await bb.sdk.environments.list({ projectId });
      const primary = (await bb.sdk.hosts.list()).find(
        (host) => host.machineProviderId === null,
      );
      return sources
        .filter((row) => row.status === "ready" && row.path !== null)
        .map((row) => ({
          id: row.id,
          hostId: row.hostId,
          primaryHost: row.hostId === primary?.id,
          path: row.path!,
          name: row.path!,
        }));
    },
    "account.inspect": async () => {
      try {
        const resolved = await settings();
        return {
          available: true,
          accountIdentity: await backendFactory(resolved).accountIdentity(),
          appName: resolved.appName,
          baseVersion: baseManifest.version,
          message: "Modal account is reachable",
        };
      } catch {
        return {
          available: false,
          accountIdentity: null,
          appName: null,
          baseVersion: baseManifest.version,
          message:
            "Configure the Modal token and app above, then test the connection",
        };
      }
    },
    "verification.list": ({ buildId }) =>
      store.db
        .prepare(
          "SELECT data FROM verifications WHERE user_id=? AND build_id=? ORDER BY rowid DESC LIMIT 50",
        )
        .all(store.owner, buildId)
        .map((row) =>
          verificationSchema.parse(
            JSON.parse(z.object({ data: z.string() }).parse(row).data),
          ),
        ),
    "project.preflight": async ({ projectId, agentProviderId, buildId }) => {
      await assertProject(projectId);
      const selected = buildId ?? store.project(projectId).usableBuildId;
      if (!selected)
        return {
          ready: false,
          message:
            "Build, verify and use an image for this project in Modal settings",
          build: null,
        };
      try {
        const build = store.build(selected);
        if (
          build.projectId !== projectId ||
          build.state !== "ready" ||
          build.imageId === null
        )
          throw new CatalogueError(
            409,
            "Choose a ready image for this project",
          );
        verifications.assertPassed(selected, agentProviderId);
        const resolved = await settings();
        if (
          build.accountIdentity !==
          (await accountIdentity(resolved, backendFactory))
        )
          throw new CatalogueError(
            409,
            "The image belongs to a different account; restore its account configuration",
          );
        if (!(await backendFactory(resolved).resolve(build.imageId)))
          throw new CatalogueError(
            409,
            "The image is missing; explicitly build a replacement",
          );
        return {
          ready: true,
          message:
            "Verified image available; checkout and credentials are checked before the first turn",
          build,
        };
      } catch (error) {
        return {
          ready: false,
          message:
            error instanceof CatalogueError
              ? error.message
              : "Image preflight failed; check account configuration and vendor availability",
          build: null,
        };
      }
    },
    "project.inspect": ({ projectId, environmentId }) =>
      inspect(projectId, environmentId),
    "recipe.put": async (input) => {
      await assertProject(input.projectId);
      return store.putRecipe(input);
    },
    "recipe.get": async ({ projectId }) => {
      await assertProject(projectId);
      return store.recipe(projectId);
    },
    "recipe.list": ({ cursor, limit }) => {
      const recipes = store.recipes(cursor, limit);
      return {
        recipes,
        nextCursor: recipes.length === limit ? recipes.at(-1)!.projectId : null,
      };
    },
    "context.prepare": async (input) => {
      const environment = await source(input.projectId, input.environmentId);
      const recipe = store.recipe(input.projectId, input.revision);
      if (recipe.recipeId !== input.recipeId)
        throw new CatalogueError(409, "Recipe does not belong to this project");
      const manifest = await hosts.call(
        "manifest",
        {
          path: environment.path!,
          hostId: environment.hostId,
          recipeId: recipe.recipeId,
          revision: recipe.revision,
          ...recipe.contextRules,
          reviewedDirty: input.reviewedDirty,
        },
        { hostId: environment.hostId },
      );
      const context = store.putContext(input.projectId, manifest);
      const uploadToken = randomBytes(32).toString("hex");
      store.db
        .prepare("INSERT INTO context_uploads VALUES (?,?,?)")
        .run(context.contextId, hash(uploadToken), environment.hostId);
      return {
        ...context,
        files: manifest.files.length,
        uploadToken,
        uploadUrl: uploadUrl(),
      };
    },
    "context.upload": async ({ contextId, uploadToken }) => {
      const context = store.context(contextId);
      await hosts.call(
        "upload",
        {
          contextId,
          path: context.manifest.source.path,
          manifest: context.manifest,
          url: uploadUrl(),
          token: uploadToken,
        },
        { hostId: context.manifest.source.hostId },
      );
      return handlers["context.complete"]({ contextId });
    },
    "context.complete": ({ contextId }) => {
      contextFiles(store, contextId);
      store.completeContext(contextId);
      return store.context(contextId);
    },
    "build.start": async (input) => {
      await assertProject(input.projectId);
      const resolved = await settings();
      const artifact = await loadArtifact();
      store.db
        .prepare(
          "INSERT INTO base_artifacts VALUES (?,?,?) ON CONFLICT(hash) DO NOTHING",
        )
        .run(
          artifact.metadata.sha256,
          JSON.stringify(artifact.metadata),
          artifact.data,
        );
      const { build, reused } = store.start(
        input,
        await accountIdentity(resolved, backendFactory),
        resolved.appName,
        artifact.metadata,
      );
      if (
        reused &&
        build.state === "ready" &&
        build.imageId &&
        !(await backendFactory(resolved).resolve(build.imageId))
      ) {
        store.saveBuild({
          ...build,
          state: "failed",
          failure: "Published image is missing",
        });
        throw new CatalogueError(
          409,
          "Published image is missing; explicitly build again with a new request key",
        );
      }
      return { buildId: build.buildId, state: build.state, reused };
    },
    "verification.start": (input) => verifications.start(input),
    "verification.get": ({ verificationId }) =>
      verifications.get(verificationId),
    "project.useImage": async (input) => {
      await assertProject(input.projectId);
      const build = store.build(input.buildId);
      const resolved = await settings();
      if (
        build.accountIdentity !==
          (await accountIdentity(resolved, backendFactory)) ||
        !build.imageId ||
        !(await backendFactory(resolved).resolve(build.imageId))
      )
        throw new CatalogueError(
          409,
          "Published image is missing or belongs to a different account",
        );
      return verifications.promote(input);
    },
    "build.events": ({ buildId, cursor, limit }) =>
      store.events(buildId, cursor, limit),
    "build.get": ({ buildId }) => store.build(buildId),
    "build.cancel": ({ buildId }) => store.cancel(buildId),
    "image.list": ({ projectId, cursor, limit }) => {
      const images = store.images(projectId, cursor, limit);
      return {
        images,
        nextCursor: images.length === limit ? images.at(-1)!.buildId : null,
      };
    },
    "image.gc": async ({ dryRun }) => {
      const resolved = await settings();
      const backend = backendFactory(resolved);
      const candidates = [];
      const blockedReferences = [];
      for (const row of store.gcCandidates()) {
        const build = store.build(row.build_id);
        if (
          build.accountIdentity !==
            (await accountIdentity(resolved, backendFactory)) ||
          store.protected(build.buildId)
        ) {
          blockedReferences.push(build.buildId);
          continue;
        }
        let deleted = false;
        if (!dryRun && store.claimDeletion(build.buildId, GC_GRACE_MS)) {
          await backend.delete(row.image_id);
          store.deleted(build.buildId);
          deleted = true;
        }
        candidates.push({
          buildId: build.buildId,
          imageId: row.image_id,
          markedAt: dryRun
            ? row.marked_at
            : z
                .object({ marked_at: z.number().nullable() })
                .parse(
                  store.db
                    .prepare(
                      "SELECT marked_at FROM images WHERE build_id=? AND user_id=?",
                    )
                    .get(build.buildId, store.owner),
                ).marked_at,
          deleted,
        });
      }
      return { candidates, blockedReferences };
    },
    "project.configure": async (input) => {
      await assertProject(input.projectId);
      return store.configure(input);
    },
    "project.show": async ({ projectId }) => {
      await assertProject(projectId);
      const project = store.project(projectId);
      const latest = store.db
        .prepare(
          "SELECT data FROM builds WHERE user_id=? AND project_id=? AND state='ready' ORDER BY rowid DESC LIMIT 1",
        )
        .get(store.owner, projectId);
      const build = project.usableBuildId
        ? store.build(project.usableBuildId)
        : latest
          ? store.build(
              z
                .object({ data: z.string() })
                .transform(
                  (row) =>
                    z
                      .object({ buildId: z.string() })
                      .parse(JSON.parse(row.data)).buildId,
                )
                .parse(latest),
            )
          : null;
      const observed = store.db
        .prepare(
          "SELECT data,checked_at FROM source_observations WHERE user_id=? AND project_id=?",
        )
        .get(store.owner, projectId);
      const observation = observed
        ? z.object({ data: z.string(), checked_at: z.number() }).parse(observed)
        : null;
      const facts = observation
        ? inspectionSchema.parse(JSON.parse(observation.data))
        : null;
      const previous = build
        ? store.context(build.contextId).manifest.files
        : [];
      const lockfilesChanged =
        facts && build
          ? facts.evidence
              .filter((file) => file.kind === "lockfile")
              .some(
                (file) =>
                  previous.find((before) => before.path === file.path)
                    ?.sha256 !== file.sha256,
              ) ||
            previous.some(
              (before) =>
                isLockfile(before.path) &&
                !facts.evidence.some((file) => file.path === before.path),
            )
          : null;
      return {
        ...project,
        staleness: {
          dockerfileChanged: build
            ? store.recipe(projectId).recipeHash !==
              store.recipe(projectId, build.revision).recipeHash
            : false,
          lockfilesChanged,
          reason: !build
            ? "No built image"
            : facts
              ? null
              : "Source not checked",
          lastCheckedAt: observation?.checked_at ?? null,
        },
      };
    },
  };
  bb.http.route(
    "POST",
    uploadPath,
    async (context) => {
      try {
        const body = await context.req.text();
        if (Buffer.byteLength(body) > 400000)
          return context.json({ error: "Archive chunk exceeds limit" }, 413);
        const token =
          context.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
        acceptChunk(store, token, chunkSchema.parse(JSON.parse(body)));
        return context.json({ ok: true });
      } catch (error) {
        return context.json(
          { error: error instanceof Error ? error.message : "Invalid archive" },
          error instanceof CatalogueError && error.status === 403 ? 403 : 400,
        );
      }
    },
    { auth: "none" },
  );
  async function runBuild(
    build: Build,
    resolved: ResolvedSettings,
    signal: AbortSignal,
  ) {
    const backend = backendFactory(resolved);
    const lease = store.lease(build.buildId);
    const currentLease = () =>
      store.lease(build.buildId) === lease &&
      store.build(build.buildId).state === "building";
    const recipe = store.recipe(build.projectId, build.revision);
    const logs = createBuildLogWriter((kind, text) => {
      if (currentLease())
        store.event(build.buildId, kind, text, [
          resolved.tokenId,
          resolved.tokenSecret,
        ]);
    });
    try {
      const row = build.baseArtifact
        ? store.db
            .prepare(
              "SELECT metadata_json,data FROM base_artifacts WHERE hash=?",
            )
            .get(build.baseArtifact.sha256)
        : null;
      const artifact = row
        ? z
            .object({ metadata_json: z.string(), data: z.instanceof(Buffer) })
            .parse(row)
        : null;
      const baseArtifact = artifact
        ? {
            metadata: artifactMetadataSchema.parse(
              JSON.parse(artifact.metadata_json),
            ),
            data: artifact.data,
          }
        : null;
      const imageId = await backend.build(
        {
          baseArtifact,
          name: build.name,
          appName: build.appName,
          dockerfileText: recipe.dockerfileText,
          files: contextFiles(store, build.contextId),
        },
        {
          signal,
          log: (text) => logs.append(text),
          allocated: (imageId) => {
            if (!currentLease()) return;
            store.db
              .transaction(() => {
                const current = store.build(build.buildId);
                store.saveBuild({ ...current, imageId });
                store.db
                  .prepare(
                    "INSERT INTO images(build_id,user_id,image_id,manifest_json) VALUES (?,?,?,?) ON CONFLICT(build_id) DO NOTHING",
                  )
                  .run(
                    build.buildId,
                    store.owner,
                    imageId,
                    JSON.stringify({
                      version: 1,
                      state: "building",
                      base: baseManifest,
                    }),
                  );
              })
              .immediate();
          },
        },
      );
      logs.flush();
      if (!currentLease()) return;
      store.ready(build.buildId, imageId, {
        version: 1,
        base: baseManifest,
        bbPackage: build.baseArtifact,
        recipe,
        context: store.context(build.contextId).manifest,
      });
    } catch (error) {
      logs.flush();
      if (!currentLease()) return;
      const text = error instanceof Error ? error.message : String(error);
      store.event(build.buildId, "log", text, [
        resolved.tokenId,
        resolved.tokenSecret,
      ]);
      const transient =
        /unavailable|deadline|timeout|ECONN|socket|429|rate.limit|cancel|aborted|worker stopped/i.test(
          text,
        );
      store.saveBuild({
        ...store.build(build.buildId),
        state: transient ? "reconciling" : "failed",
        failure: transient
          ? "Vendor outcome unknown; reconciling published name"
          : "Build failed; inspect redacted logs",
      });
    }
  }
  async function sweep(signal = new AbortController().signal) {
    const resolved = await settings();
    const backend = backendFactory(resolved);
    for (const build of store.reconciling(
      await accountIdentity(resolved, backendFactory),
    )) {
      const imageId = await backend.reconcile(build.name);
      if (imageId)
        store.ready(build.buildId, imageId, {
          version: 1,
          base: baseManifest,
          recipe: store.recipe(build.projectId, build.revision),
          context: store.context(build.contextId).manifest,
        });
    }
    const build = store.claim(await accountIdentity(resolved, backendFactory));
    if (build) await runBuild(build, resolved, signal);
    store.db
      .prepare(
        "DELETE FROM context_chunks WHERE context_id IN (SELECT id FROM contexts WHERE user_id=? AND expiry<? AND id NOT IN (SELECT json_extract(data,'$.contextId') FROM builds WHERE state IN ('queued','building','reconciling')))",
      )
      .run(store.owner, now());
  }
  bb.background.service("image-builds", {
    async start(signal) {
      store.restart();
      let backoff = 1000;
      while (!signal.aborted) {
        try {
          await sweep(signal);
          await verifications.sweep();
          backoff = 1000;
        } catch (error) {
          bb.log.warn(
            error instanceof CatalogueError
              ? error.message
              : "Modal build reconciliation unavailable; retrying",
          );
          backoff = Math.min(backoff * 2, 60000);
        }
        await delay(backoff, undefined, { signal }).catch(() => {});
      }
    },
  });
  bb.rpc.register(modalRpcContract, handlers);
  return { store, handlers, sweep, backendFactory, settings, verifications };
}
export type CatalogueService = ReturnType<typeof createCatalogueService>;
