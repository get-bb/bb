import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CatalogueError,
  hash,
  verificationSchema,
  type Verification,
} from "./model.js";
import type { Catalogue } from "./store.js";
import { sourceContract } from "./source-contract.js";

const rowSchema = z.object({ data: z.string() });
export function createVerificationService(bb: BbPluginApi, store: Catalogue) {
  const hosts = bb.hosts.experimental_client({ contract: sourceContract });
  const get = (id: string) => {
    const row = store.db
      .prepare("SELECT data FROM verifications WHERE user_id=? AND id=?")
      .get(store.owner, id);
    if (!row) throw new CatalogueError(404, "Verification not found");
    return verificationSchema.parse(JSON.parse(rowSchema.parse(row).data));
  };
  const save = (record: Verification) => {
    record.updatedAt = store.now();
    store.db
      .prepare(
        "UPDATE verifications SET state=?,data=? WHERE user_id=? AND id=?",
      )
      .run(
        record.state,
        JSON.stringify(record),
        store.owner,
        record.verificationId,
      );
  };
  async function start(input: {
    buildId: string;
    agentProviderId: string;
    key: string;
  }) {
    const build = store.build(input.buildId);
    if (build.state !== "ready")
      throw new CatalogueError(409, "Verification requires a ready image");
    const recipe = store.recipe(build.projectId, build.revision);
    if (!recipe.smoke.commands.length)
      throw new CatalogueError(
        400,
        "Record at least one smoke command before verification",
      );
    return store.db
      .transaction(() => {
        const payloadHash = hash(JSON.stringify(input));
        const previous = store.db
          .prepare(
            "SELECT payload_hash,verification_id FROM verification_requests WHERE user_id=? AND key=?",
          )
          .get(store.owner, input.key);
        if (previous) {
          const row = z
            .object({ payload_hash: z.string(), verification_id: z.string() })
            .parse(previous);
          if (row.payload_hash !== payloadHash)
            throw new CatalogueError(
              409,
              "Verification key has a different payload",
            );
          return get(row.verification_id);
        }
        const record: Verification = {
          ...input,
          verificationId: `v_${randomUUID()}`,
          state: "queued",
          hostId: null,
          environmentId: null,
          threadId: null,
          completedTurnSeq: null,
          restored: false,
          checks: [],
          failure: null,
          createdAt: store.now(),
          updatedAt: store.now(),
        };
        store.reference(build.buildId, "verification", record.verificationId);
        store.db
          .prepare("INSERT INTO verifications VALUES (?,?,?,?,?)")
          .run(
            record.verificationId,
            store.owner,
            build.buildId,
            record.state,
            JSON.stringify(record),
          );
        store.db
          .prepare("INSERT INTO verification_requests VALUES (?,?,?,?)")
          .run(store.owner, input.key, payloadHash, record.verificationId);
        return record;
      })
      .immediate();
  }
  function assertPassed(buildId: string, agentProviderId: string) {
    const build = store.build(buildId);
    const passed = store.db
      .prepare(
        "SELECT data FROM verifications WHERE user_id=? AND build_id=? AND state='passed' AND json_extract(data,'$.agentProviderId')=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(store.owner, buildId, agentProviderId);
    if (!passed)
      throw new CatalogueError(
        409,
        "A successful verification for the selected agent is required",
      );
    const proof = verificationSchema.parse(
      JSON.parse(rowSchema.parse(passed).data),
    );
    const commands = store.recipe(build.projectId, build.revision).smoke
      .commands;
    if (
      !proof.restored ||
      proof.completedTurnSeq === null ||
      proof.threadId === null ||
      proof.hostId === null ||
      proof.environmentId === null ||
      !commands.length ||
      proof.checks.length !== commands.length ||
      proof.checks.some(
        (check, index) =>
          check.command !== commands[index] || check.exitCode !== 0,
      )
    )
      throw new CatalogueError(
        409,
        "Verification lacks successful agent and independent command evidence",
      );
    return proof;
  }
  function promote(input: {
    projectId: string;
    buildId: string;
    agentProviderId: string;
    expectedRevision: number;
  }) {
    return store.db
      .transaction(() => {
        const build = store.build(input.buildId);
        if (build.projectId !== input.projectId || build.state !== "ready")
          throw new CatalogueError(
            409,
            "Choose a ready image for this project",
          );
        assertPassed(input.buildId, input.agentProviderId);
        const previous = store.project(input.projectId);
        if (previous.revision !== input.expectedRevision)
          throw new CatalogueError(
            409,
            "Project revision changed",
            previous.revision,
          );
        store.reference(input.buildId, "promotion", input.projectId);
        const next = {
          ...previous,
          usableBuildId: input.buildId,
          revision: previous.revision + 1,
        };
        store.db
          .prepare(
            "INSERT INTO project_images VALUES (?,?,?,?,?) ON CONFLICT(user_id,project_id) DO UPDATE SET usable_build_id=excluded.usable_build_id,revision=excluded.revision,data=excluded.data",
          )
          .run(
            store.owner,
            input.projectId,
            input.buildId,
            next.revision,
            JSON.stringify(next),
          );
        store.release("promotion", input.projectId);
        return { ...next, available: true as const };
      })
      .immediate();
  }
  async function advance(record: Verification) {
    const build = store.build(record.buildId);
    const title = `Modal verification ${record.verificationId}`;
    if (record.state === "queued") {
      const health = await bb.sdk.system.providerStates();
      if (
        !health.providers.some(
          (provider) =>
            provider.providerId === record.agentProviderId &&
            provider.status === "ready",
        )
      )
        throw new CatalogueError(
          409,
          "Configure a usable provider credential route before verification",
        );
      record.state = "allocating";
      save(record);
    }
    if (record.state === "allocating") {
      const launch = await bb.sdk.hosts.submit({
        machineProviderId: "modal-sandbox",
        projectId: build.projectId,
        inputs: { buildId: build.buildId, policy: { idleMinutes: 0 } },
        key: `modal-${record.verificationId}`,
      });
      if (launch.phase === "cancelled")
        throw new CatalogueError(
          409,
          "Verification machine allocation was cancelled",
        );
      if (launch.phase === "failed") {
        record.failure =
          "Machine allocation has failed; awaiting core reconciliation or explicit cancellation";
        save(record);
        return;
      }
      if (launch.phase !== "ready" || !launch.hostId) return;
      record.failure = null;
      record.hostId = launch.hostId;
      record.state = "preparing";
      save(record);
    }
    if (record.state === "preparing" && record.hostId) {
      const project = await bb.sdk.projects.get({ projectId: build.projectId });
      if (!project.sources.some((source) => source.hostId === record.hostId)) {
        await bb.sdk.projects.sources.add({
          projectId: build.projectId,
          type: "clone",
          hostId: record.hostId,
        });
      }
      record.state = "starting";
      save(record);
      const recipe = store.recipe(build.projectId, build.revision);
      const thread = await bb.sdk.threads.spawn({
        projectId: build.projectId,
        providerId: record.agentProviderId,
        origin: "plugin",
        originPluginId: bb.pluginId,
        title,
        prompt: `Run these recorded smoke commands, report each exit code and cwd, then stop. Do not change tracked source files.\n${recipe.smoke.commands.join("\n")}`,
        environment: {
          type: "provider",
          environmentProviderId: "project-checkout",
          machine: { type: "existing", hostId: record.hostId },
          inputs: {
            branch: {
              kind: "new",
              baseBranch: store.context(build.contextId).manifest.source.commit,
            },
          },
        },
      });
      record.threadId = thread.id;
      record.state = "running";
      save(record);
    }
    if (record.state === "starting") {
      const matches = await bb.sdk.threads.search({
        query: record.verificationId,
        limitPerGroup: "10",
      });
      const threads = [...matches.active.results, ...matches.archived.results]
        .map((result) => result.thread)
        .filter(
          (thread) =>
            thread.title === title && thread.projectId === build.projectId,
        );
      if (threads.length !== 1) return;
      record.threadId = threads[0]!.id;
      record.state = "running";
      save(record);
    }
    if (record.state === "running" && record.threadId) {
      const thread = await bb.sdk.threads.get({ threadId: record.threadId });
      record.environmentId = thread.environmentId;
      const events = await bb.sdk.threads.events.list({
        threadId: record.threadId,
        types: ["turn/completed"],
        limit: "1",
        order: "desc",
      });
      const completed = events[0];
      if (completed?.type !== "turn/completed") {
        if (thread.status === "error")
          throw new CatalogueError(
            409,
            "Smoke thread failed before a completed agent turn",
          );
        save(record);
        return;
      }
      if (completed.data.status !== "completed")
        throw new CatalogueError(
          409,
          "The real agent smoke turn did not complete successfully",
        );
      record.completedTurnSeq = completed.seq;
      record.state = "checking";
      save(record);
    }
    if (record.state === "checking" && record.hostId && record.environmentId) {
      const environment = await bb.sdk.environments.get({
        environmentId: record.environmentId,
      });
      if (!environment.path || environment.hostId !== record.hostId)
        throw new CatalogueError(409, "Verification checkout is unavailable");
      const recipe = store.recipe(build.projectId, build.revision);
      const result = await hosts.call(
        "smoke",
        {
          path: environment.path,
          commands: recipe.smoke.commands,
          timeoutMs: recipe.smoke.timeoutSeconds * 1000,
          expectedCommit: store.context(build.contextId).manifest.source.commit,
        },
        { hostId: record.hostId },
      );
      record.checks = result.results;
      if (record.checks.some((check) => check.exitCode !== 0))
        throw new CatalogueError(409, "Independent smoke command failed");
      const sentinel = await hosts.call(
        "smoke",
        {
          path: environment.path,
          commands: [
            `printf '%s' '${record.verificationId}' > .bb-modal-verification-sentinel`,
          ],
          timeoutMs: 30000,
          expectedCommit: store.context(build.contextId).manifest.source.commit,
        },
        { hostId: record.hostId },
      );
      if (sentinel.results.some((check) => check.exitCode !== 0))
        throw new CatalogueError(
          409,
          "Cannot persist the verification sentinel",
        );
      record.state = "suspending";
      save(record);
    }
    if (record.state === "suspending" && record.hostId) {
      const host = await bb.sdk.hosts.get({ hostId: record.hostId });
      if (host.lifecycle.phase !== "suspended") {
        await bb.sdk.hosts.suspend({ hostId: record.hostId });
        return;
      }
      record.state = "resuming";
      save(record);
    }
    if (record.state === "resuming" && record.hostId) {
      const host = await bb.sdk.hosts.get({ hostId: record.hostId });
      if (host.lifecycle.phase !== "active") {
        await bb.sdk.hosts.resume({ hostId: record.hostId });
        return;
      }
      record.state = "restoring";
      save(record);
    }
    if (record.state === "restoring" && record.hostId && record.environmentId) {
      const ready = await bb.sdk.hosts.experimental_ensureReady({
        hostId: record.hostId,
        projectId: build.projectId,
        providerId: record.agentProviderId,
      });
      if (ready.status !== "ready")
        throw new CatalogueError(409, "Restored machine readiness failed");
      const environment = await bb.sdk.environments.get({
        environmentId: record.environmentId,
      });
      if (!environment.path || environment.hostId !== record.hostId)
        throw new CatalogueError(
          409,
          "Restored verification checkout is unavailable",
        );
      const recipe = store.recipe(build.projectId, build.revision);
      const result = await hosts.call(
        "smoke",
        {
          path: environment.path,
          commands: [
            `test "$(cat .bb-modal-verification-sentinel)" = '${record.verificationId}'`,
            ...recipe.smoke.commands,
          ],
          timeoutMs: recipe.smoke.timeoutSeconds * 1000,
          expectedCommit: store.context(build.contextId).manifest.source.commit,
        },
        { hostId: record.hostId },
      );
      if (result.results.some((check) => check.exitCode !== 0))
        throw new CatalogueError(
          409,
          "Restored sentinel or independent smoke command failed",
        );
      record.checks = result.results.slice(1);
      record.restored = true;
      record.state = "retaining";
      save(record);
    }
    if (record.state === "retaining" && record.hostId) {
      const host = await bb.sdk.hosts.get({ hostId: record.hostId });
      if (host.lifecycle.phase !== "suspended") {
        await bb.sdk.hosts.suspend({ hostId: record.hostId });
        return;
      }
      record.state = "passed";
      save(record);
      store.release("verification", record.verificationId);
    }
  }
  async function sweep() {
    const rows = store.db
      .prepare(
        "SELECT data FROM verifications WHERE user_id=? AND state NOT IN ('passed','failed') ORDER BY rowid LIMIT 10",
      )
      .all(store.owner);
    for (const row of rows) {
      const record = verificationSchema.parse(
        JSON.parse(rowSchema.parse(row).data),
      );
      try {
        if (store.now() - record.createdAt > 30 * 60 * 1000)
          throw new CatalogueError(
            409,
            "Verification timed out; inspect the retained machine and thread",
          );
        await advance(record);
      } catch (error) {
        const expired = store.now() - record.createdAt > 30 * 60 * 1000;
        if (record.state === "allocating" && expired) {
          try {
            const cancelled = await bb.sdk.hosts.cancel({
              id: `modal-${record.verificationId}`,
            });
            if (cancelled.cancelPending) continue;
          } catch {
            record.failure =
              "Verification timed out; allocation cancellation is pending";
            save(record);
            continue;
          }
        }
        if (
          !expired &&
          [
            "queued",
            "allocating",
            "suspending",
            "resuming",
            "retaining",
          ].includes(record.state) &&
          !(error instanceof CatalogueError)
        ) {
          record.failure = `Verification ${record.state} is awaiting reconciliation`;
          save(record);
          continue;
        }
        if (
          record.state === "starting" &&
          !(error instanceof CatalogueError) &&
          store.now() - record.createdAt <= 30 * 60 * 1000
        ) {
          record.failure =
            "Smoke submission outcome is uncertain; reconciling its durable title";
          save(record);
          continue;
        }
        record.failure =
          error instanceof CatalogueError
            ? error.message
            : `Verification failed during ${record.state}; inspect machine launch modal-${record.verificationId} and the retained smoke thread`;
        record.state = "failed";
        save(record);
        store.release("verification", record.verificationId);
      }
    }
  }
  return { start, get, promote, sweep, assertPassed };
}
