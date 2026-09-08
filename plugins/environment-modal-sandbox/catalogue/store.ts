import type { ArtifactMetadata } from "./artifact.js";
import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { baseDigest, baseManifest } from "./base.js";
import { parseDockerfile } from "./dockerfile.js";
import { migrations } from "./migrations.js";
import {
  buildSchema,
  CatalogueError,
  contextSchema,
  eventSchema,
  hash,
  projectSchema,
  recipeInputSchema,
  recipeSchema,
  type Build,
  type Context,
  type Manifest,
  type Project,
} from "./model.js";

const rowSchema = z.object({ data: z.string() });
const keySchema = z.object({ build_id: z.string(), payload_hash: z.string() });
const idRow = z.object({ id: z.string() });
const MAX_LOG_BYTES = 10 * 1024 * 1024;
export type CatalogueDb = ReturnType<BbPluginApi["storage"]["database"]>;
export class Catalogue {
  readonly owner: string;
  constructor(
    readonly db: CatalogueDb,
    storage: BbPluginApi["storage"],
    readonly now = Date.now,
    owner?: string,
  ) {
    storage.migrate(db, migrations);
    db.prepare("INSERT OR IGNORE INTO catalogue_owner VALUES ('owner', ?)").run(
      randomUUID(),
    );
    this.owner =
      owner ??
      z
        .object({ identity: z.string() })
        .parse(
          db
            .prepare("SELECT identity FROM catalogue_owner WHERE id='owner'")
            .get(),
        ).identity;
  }
  recipe(projectId: string, revision?: number) {
    const row =
      revision === undefined
        ? this.db
            .prepare(
              "SELECT data FROM recipes WHERE user_id=? AND project_id=? ORDER BY revision DESC LIMIT 1",
            )
            .get(this.owner, projectId)
        : this.db
            .prepare(
              "SELECT data FROM recipes WHERE user_id=? AND project_id=? AND revision=?",
            )
            .get(this.owner, projectId, revision);
    if (!row) throw new CatalogueError(404, "Recipe not found");
    return recipeSchema.parse(JSON.parse(rowSchema.parse(row).data));
  }
  putRecipe(input: z.infer<typeof recipeInputSchema>) {
    parseDockerfile(input.dockerfileText);
    return this.db
      .transaction(() => {
        const previous = this.db
          .prepare(
            "SELECT data FROM recipes WHERE user_id=? AND project_id=? ORDER BY revision DESC LIMIT 1",
          )
          .get(this.owner, input.projectId);
        const current = previous
          ? recipeSchema.parse(JSON.parse(rowSchema.parse(previous).data))
          : null;
        if ((current?.revision ?? 0) !== input.expectedRevision)
          throw new CatalogueError(
            409,
            `Recipe revision conflict; latest revision ${current?.revision ?? 0}`,
            current?.revision ?? 0,
          );
        const { expectedRevision, ...content } = input;
        const recipe = recipeSchema.parse({
          ...content,
          recipeId: current?.recipeId ?? `r_${randomUUID()}`,
          revision: expectedRevision + 1,
          recipeHash: hash(JSON.stringify({ ...content, baseDigest })),
          baseDigest,
          createdAt: this.now(),
        });
        this.db
          .prepare("INSERT INTO recipes VALUES (?,?,?,?,?,?)")
          .run(
            this.owner,
            input.projectId,
            recipe.recipeId,
            recipe.revision,
            recipe.recipeHash,
            JSON.stringify(recipe),
          );
        return recipe;
      })
      .immediate();
  }
  recipes(cursor: string | null, limit: number) {
    return this.db
      .prepare(
        `SELECT r.data FROM recipes r WHERE user_id=? AND project_id>? AND revision=(SELECT max(revision) FROM recipes latest WHERE latest.user_id=r.user_id AND latest.project_id=r.project_id) ORDER BY project_id LIMIT ?`,
      )
      .all(this.owner, cursor ?? "", limit)
      .map((row) => recipeSchema.parse(JSON.parse(rowSchema.parse(row).data)));
  }
  putContext(projectId: string, manifest: Manifest) {
    const recipe = this.recipe(projectId, manifest.revision);
    if (recipe.recipeId !== manifest.recipeId)
      throw new CatalogueError(
        409,
        "Context recipe does not match project revision",
      );
    const context: Context = {
      contextId: `c_${randomUUID()}`,
      projectId,
      manifest,
      manifestHash: hash(JSON.stringify(manifest)),
      bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      expiresAt: this.now() + 86400000,
      uploaded: false,
    };
    if (context.bytes > 256 * 1024 * 1024)
      throw new CatalogueError(413, "Context exceeds 256 MiB");
    this.db
      .prepare("INSERT INTO contexts VALUES (?,?,?,?,?,?)")
      .run(
        context.contextId,
        this.owner,
        projectId,
        context.manifestHash,
        context.expiresAt,
        JSON.stringify(context),
      );
    return context;
  }
  context(id: string) {
    const row = this.db
      .prepare("SELECT data FROM contexts WHERE id=? AND user_id=?")
      .get(id, this.owner);
    if (!row) throw new CatalogueError(404, "Context not found");
    return contextSchema.parse(JSON.parse(rowSchema.parse(row).data));
  }
  completeContext(id: string) {
    const context = this.context(id);
    context.uploaded = true;
    this.db
      .prepare("UPDATE contexts SET data=? WHERE id=? AND user_id=?")
      .run(JSON.stringify(context), id, this.owner);
  }
  build(id: string): Build {
    const row = this.db
      .prepare("SELECT data FROM builds WHERE id=? AND user_id=?")
      .get(id, this.owner);
    if (!row) throw new CatalogueError(404, "Build not found");
    return buildSchema.parse(JSON.parse(rowSchema.parse(row).data));
  }
  saveBuild(build: Build) {
    this.db
      .prepare(
        "UPDATE builds SET state=?,data=json_set(?, '$.lastEventSequence', max(json_extract(data, '$.lastEventSequence'), ?)) WHERE id=? AND user_id=?",
      )
      .run(
        build.state,
        JSON.stringify({ ...build, updatedAt: this.now() }),
        build.lastEventSequence,
        build.buildId,
        this.owner,
      );
  }
  start(
    input: {
      projectId: string;
      recipeId: string;
      revision: number;
      contextId: string;
      key: string;
    },
    accountIdentity: string,
    appName: string,
    baseArtifact: ArtifactMetadata | null = null,
  ) {
    return this.db
      .transaction(() => {
        const recipe = this.recipe(input.projectId, input.revision);
        const context = this.context(input.contextId);
        if (
          recipe.recipeId !== input.recipeId ||
          context.projectId !== input.projectId ||
          context.manifest.recipeId !== input.recipeId ||
          context.manifest.revision !== input.revision
        )
          throw new CatalogueError(409, "Build recipe/context mismatch");
        const payloadHash = hash(
          JSON.stringify({ input, accountIdentity, appName, baseArtifact }),
        );
        const request = this.db
          .prepare(
            "SELECT build_id,payload_hash FROM build_requests WHERE user_id=? AND key=?",
          )
          .get(this.owner, input.key);
        if (request) {
          const previous = keySchema.parse(request);
          if (previous.payload_hash !== payloadHash)
            throw new CatalogueError(
              409,
              "Request key already has a different payload",
            );
          return { build: this.build(previous.build_id), reused: true };
        }
        if (!context.uploaded || context.expiresAt <= this.now())
          throw new CatalogueError(
            409,
            "Context is incomplete or expired; upload it again",
          );
        const buildHash = hash(
          JSON.stringify({
            recipeHash: recipe.recipeHash,
            baseDigest: recipe.baseDigest,
            files: context.manifest.files,
            platform: baseManifest.platform,
            builder: baseManifest.builder,
            baseArtifact,
          }),
        );
        const match = this.db
          .prepare(
            "SELECT data FROM builds WHERE user_id=? AND account_id=? AND app=? AND hash=?",
          )
          .get(this.owner, accountIdentity, appName, buildHash);
        let build: Build;
        if (match) {
          build = buildSchema.parse(JSON.parse(rowSchema.parse(match).data));
          if (["failed", "cancelled", "reconciling"].includes(build.state)) {
            build = {
              ...build,
              contextId: context.contextId,
              state: "queued",
              failure: null,
              cancelRequested: false,
            };
            this.saveBuild(build);
            this.event(
              build.buildId,
              "state",
              "Explicit retry requested; an unresolved vendor build may still incur cost",
            );
          }
        } else {
          build = {
            buildId: `b_${randomUUID()}`,
            baseArtifact,
            projectId: input.projectId,
            recipeId: input.recipeId,
            revision: input.revision,
            contextId: input.contextId,
            accountIdentity,
            appName,
            hash: buildHash,
            name: `bb-${hash(this.owner).slice(0, 12)}-${hash(appName).slice(0, 12)}:${buildHash}`,
            state: "queued",
            imageId: null,
            failure: null,
            cancelRequested: false,
            lastEventSequence: 0,
            createdAt: this.now(),
            updatedAt: this.now(),
          };
          this.db
            .prepare("INSERT INTO builds VALUES (?,?,?,?,?,?,?,?,?,?)")
            .run(
              build.buildId,
              this.owner,
              build.projectId,
              accountIdentity,
              appName,
              buildHash,
              build.state,
              build.name,
              null,
              JSON.stringify(build),
            );
        }
        this.db
          .prepare("INSERT INTO build_requests VALUES (?,?,?,?)")
          .run(this.owner, input.key, payloadHash, build.buildId);
        return { build, reused: Boolean(match) };
      })
      .immediate();
  }
  claim(accountIdentity: string): Build | null {
    return this.db
      .transaction(() => {
        const active = this.db
          .prepare(
            "SELECT id FROM builds WHERE account_id=? AND state IN ('building','reconciling') LIMIT 1",
          )
          .get(accountIdentity);
        if (active) return null;
        const row = this.db
          .prepare(
            "SELECT data FROM builds WHERE user_id=? AND account_id=? AND state='queued' ORDER BY rowid LIMIT 1",
          )
          .get(this.owner, accountIdentity);
        if (!row) return null;
        const build = buildSchema.parse(JSON.parse(rowSchema.parse(row).data));
        build.state = "building";
        this.saveBuild(build);
        this.db
          .prepare("UPDATE builds SET lease=? WHERE id=?")
          .run(randomUUID(), build.buildId);
        this.event(build.buildId, "state", "building");
        return this.build(build.buildId);
      })
      .immediate();
  }
  lease(id: string) {
    return z
      .object({ lease: z.string().nullable() })
      .parse(
        this.db
          .prepare("SELECT lease FROM builds WHERE id=? AND user_id=?")
          .get(id, this.owner),
      ).lease;
  }
  restart() {
    this.db
      .transaction(() => {
        const rows = this.db
          .prepare("SELECT id FROM builds WHERE user_id=? AND state='building'")
          .all(this.owner);
        for (const row of rows) {
          const build = this.build(idRow.parse(row).id);
          this.db
            .prepare("UPDATE builds SET lease=NULL WHERE id=? AND user_id=?")
            .run(build.buildId, this.owner);
          this.saveBuild({
            ...build,
            state: "reconciling",
            failure:
              "Worker stopped; reconciling immutable published name before any retry",
          });
        }
      })
      .immediate();
  }
  reconciling(accountIdentity: string) {
    return this.db
      .prepare(
        "SELECT data FROM builds WHERE user_id=? AND account_id=? AND state='reconciling'",
      )
      .all(this.owner, accountIdentity)
      .map((row) => buildSchema.parse(JSON.parse(rowSchema.parse(row).data)));
  }
  cancel(id: string) {
    return this.db
      .transaction(() => {
        const build = this.build(id);
        if (build.state === "queued") build.state = "cancelled";
        else if (build.state === "building" || build.state === "reconciling")
          build.cancelRequested = true;
        this.saveBuild(build);
        this.event(
          id,
          "state",
          build.state === "cancelled"
            ? "Cancelled before vendor submission"
            : "Cancellation requested; vendor termination is not confirmed",
        );
        return this.build(id);
      })
      .immediate();
  }
  event(
    id: string,
    kind: "state" | "log" | "truncated",
    text: string,
    secrets: readonly string[] = [],
  ) {
    this.db
      .transaction(() => {
        const build = this.build(id);
        let safe = text;
        for (const secret of secrets)
          if (secret) safe = safe.replaceAll(secret, "[REDACTED]");
        safe = safe.replace(
          /(?:Bearer\s+\S+|(?:token|secret|password|api[_-]?key)\s*[=:]\s*\S+|https?:\/\/[^\s/]+:[^\s@]+@[^\s]+)/gi,
          "[REDACTED]",
        );
        safe = safe.replace(
          /'[A-Za-z0-9+/=]{512,}'/g,
          "'[encoded file contents]'",
        );
        const clipped = Buffer.byteLength(safe) > 65536;
        safe = Buffer.from(safe).subarray(0, 65536).toString("utf8");
        const insert = (eventKind: string, value: string) => {
          build.lastEventSequence++;
          this.db
            .prepare("INSERT INTO build_events VALUES (?,?,?,?,?,?)")
            .run(
              id,
              build.lastEventSequence,
              eventKind,
              value,
              this.now(),
              Buffer.byteLength(value),
            );
        };
        insert(kind, safe);
        if (clipped)
          insert("truncated", "One log chunk exceeded the 64 KiB chunk limit");
        const total = z
          .object({ bytes: z.number() })
          .parse(
            this.db
              .prepare(
                "SELECT coalesce(sum(bytes),0) AS bytes FROM build_events WHERE build_id=?",
              )
              .get(id),
          ).bytes;
        if (total > MAX_LOG_BYTES) {
          this.db
            .prepare(
              `DELETE FROM build_events WHERE build_id=? AND sequence IN (SELECT sequence FROM (SELECT sequence,sum(bytes) OVER (ORDER BY sequence DESC) AS retained FROM build_events WHERE build_id=?) WHERE retained>?)`,
            )
            .run(id, id, MAX_LOG_BYTES - 1024);
          insert(
            "truncated",
            "Earlier build logs were truncated at the 10 MiB retention limit",
          );
        }
        this.saveBuild(build);
      })
      .immediate();
  }
  events(id: string, cursor: number, limit: number) {
    const build = this.build(id);
    const events = this.db
      .prepare(
        "SELECT sequence,kind,text,time FROM (SELECT sequence,kind,text,time,sum(bytes) OVER (ORDER BY sequence) AS page_bytes FROM build_events WHERE build_id=? AND sequence>?) WHERE page_bytes<=131072 ORDER BY sequence LIMIT ?",
      )
      .all(id, cursor, limit)
      .map((row) => eventSchema.parse(row));
    return {
      events,
      nextCursor: events.at(-1)?.sequence ?? cursor,
      terminal:
        ["ready", "failed", "cancelled"].includes(build.state) &&
        (events.at(-1)?.sequence ?? cursor) >= build.lastEventSequence,
    };
  }
  ready(id: string, imageId: string, imageManifest: object) {
    this.db
      .transaction(() => {
        const build = this.build(id);
        this.db
          .prepare(
            "INSERT INTO images(build_id,user_id,image_id,manifest_json) VALUES (?,?,?,?) ON CONFLICT(build_id) DO UPDATE SET image_id=excluded.image_id,manifest_json=excluded.manifest_json,marked_at=NULL,deleting=0,deleted_at=NULL",
          )
          .run(id, this.owner, imageId, JSON.stringify(imageManifest));
        this.saveBuild({ ...build, state: "ready", imageId, failure: null });
        this.event(id, "state", "ready");
      })
      .immediate();
  }
  project(projectId: string): Project {
    const row = this.db
      .prepare(
        "SELECT data FROM project_images WHERE user_id=? AND project_id=?",
      )
      .get(this.owner, projectId);
    return row
      ? projectSchema.parse(JSON.parse(rowSchema.parse(row).data))
      : projectSchema.parse({
          projectId,
          revision: 0,
          usableBuildId: null,
          resources: {},
          policy: {},
        });
  }
  configure(input: {
    projectId: string;
    usableBuildId?: null;
    expectedRevision: number;
    resources: Project["resources"];
    policy: Project["policy"];
  }) {
    return this.db
      .transaction(() => {
        const previous = this.project(input.projectId);
        if (previous.revision !== input.expectedRevision)
          throw new CatalogueError(
            409,
            `Project revision conflict; latest revision ${previous.revision}`,
            previous.revision,
          );
        const next = {
          ...previous,
          usableBuildId:
            input.usableBuildId === null ? null : previous.usableBuildId,
          resources: input.resources,
          policy: input.policy,
          revision: previous.revision + 1,
        };
        this.db
          .prepare(
            "INSERT INTO project_images VALUES (?,?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET usable_build_id=excluded.usable_build_id,revision=excluded.revision,data=excluded.data",
          )
          .run(
            this.owner,
            input.projectId,
            next.usableBuildId,
            next.revision,
            JSON.stringify(next),
          );
        return next;
      })
      .immediate();
  }
  reference(buildId: string, kind: string, ownerId: string) {
    this.db
      .transaction(() => {
        this.build(buildId);
        const image = this.db
          .prepare(
            "SELECT image_id FROM images WHERE build_id=? AND user_id=? AND deleting=0 AND deleted_at IS NULL",
          )
          .get(buildId, this.owner);
        if (!image)
          throw new CatalogueError(409, "Image is missing or being deleted");
        this.db
          .prepare("INSERT OR IGNORE INTO image_references VALUES (?,?,?,?)")
          .run(this.owner, kind, ownerId, buildId);
        this.db
          .prepare(
            "UPDATE images SET marked_at=NULL WHERE build_id=? AND user_id=?",
          )
          .run(buildId, this.owner);
      })
      .immediate();
  }
  release(kind: string, ownerId: string) {
    this.db
      .prepare(
        "DELETE FROM image_references WHERE user_id=? AND owner_kind=? AND owner_id=?",
      )
      .run(this.owner, kind, ownerId);
  }
  protected(buildId: string) {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM image_references WHERE user_id=? AND build_id=? UNION ALL SELECT 1 FROM project_images WHERE user_id=? AND usable_build_id=? UNION ALL SELECT 1 FROM verifications WHERE user_id=? AND build_id=? AND state IN ('queued','running') UNION ALL SELECT 1 FROM builds WHERE user_id=? AND id=? AND state IN ('queued','building','reconciling') LIMIT 1`,
        )
        .get(
          this.owner,
          buildId,
          this.owner,
          buildId,
          this.owner,
          buildId,
          this.owner,
          buildId,
        ),
    );
  }
  images(projectId: string | null, cursor: string | null, limit: number) {
    return this.db
      .prepare(
        `SELECT b.data FROM builds b JOIN images i ON i.build_id=b.id WHERE b.user_id=? AND (? IS NULL OR b.project_id=?) AND b.id>? AND i.deleted_at IS NULL ORDER BY b.id LIMIT ?`,
      )
      .all(this.owner, projectId, projectId, cursor ?? "", limit)
      .map((row) => buildSchema.parse(JSON.parse(rowSchema.parse(row).data)));
  }
  gcCandidates() {
    return this.db
      .prepare(
        "SELECT build_id,image_id,marked_at FROM images WHERE user_id=? AND deleted_at IS NULL ORDER BY build_id",
      )
      .all(this.owner)
      .map((row) =>
        z
          .object({
            build_id: z.string(),
            image_id: z.string(),
            marked_at: z.number().nullable(),
          })
          .parse(row),
      );
  }
  claimDeletion(buildId: string, graceMs: number) {
    return this.db
      .transaction(() => {
        if (this.protected(buildId)) return false;
        this.db
          .prepare(
            "UPDATE images SET marked_at=? WHERE user_id=? AND build_id=? AND marked_at IS NULL",
          )
          .run(this.now(), this.owner, buildId);
        return (
          this.db
            .prepare(
              "UPDATE images SET deleting=1 WHERE user_id=? AND build_id=? AND marked_at<=? AND deleted_at IS NULL",
            )
            .run(this.owner, buildId, this.now() - graceMs).changes > 0
        );
      })
      .immediate();
  }
  deleted(buildId: string) {
    this.db
      .prepare(
        "UPDATE images SET deleted_at=? WHERE user_id=? AND build_id=? AND deleting=1",
      )
      .run(this.now(), this.owner, buildId);
  }
}
