import { and, asc, eq, isNotNull } from "drizzle-orm";
import {
  deleteExpiredAuthApiKeys,
  disableEnabledAuthApiKeysForHost,
  findRedeemableAuthApiKey,
  hasEnabledAuthApiKeyForHost,
  insertAuthUserIfMissing,
} from "../../src/data/auth-api-keys.js";
import {
  deleteEnvironmentVariable,
  deleteEnvironmentVariablesInScope,
  hasAnyEnvironmentVariable,
  listEnvironmentVariables,
  saveEnvironmentVariable,
} from "../../src/data/environment-variables.js";
import {
  countLegacyAutomations,
  legacyAutomationTableExists,
  listLegacyAutomationRows,
  listLegacyAutomationRunRows,
} from "../../src/data/legacy-automations.js";
import {
  commitAttachmentBackfillStep,
  ensureProjectAttachmentBackfill,
  getProjectAttachmentBackfill,
  nextCompletedProjectAttachmentBackfill,
} from "../../src/data/project-attachment-backfill.js";
import {
  claimUnreadyProjectAttachmentDeletion,
  deleteClaimedProjectAttachment,
  markProjectAttachmentReady,
} from "../../src/data/project-attachments.js";
import { listActiveSessionHosts } from "../../src/data/sessions.js";
import type { DbConnection } from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import {
  authApiKeys,
  hosts,
  projectAttachments,
  projectAttachmentThreads,
} from "../../src/schema.js";
import { registerCostGroup, scaled, type QueryCostCase } from "./case.js";

const AUTH_API_KEYS = "packages/db/src/data/auth-api-keys.ts";
const ENVIRONMENT_VARIABLES = "packages/db/src/data/environment-variables.ts";
const LEGACY_AUTOMATIONS = "packages/db/src/data/legacy-automations.ts";
const BACKFILL = "packages/db/src/data/project-attachment-backfill.ts";
const ATTACHMENTS = "packages/db/src/data/project-attachments.ts";
const SESSIONS = "packages/db/src/data/sessions.ts";

const SYSTEM_USER_ID = "query-costs-machine-auth-user";
const ENROLL_CONFIG_ID = "daemon-enroll";
const HOST_CONFIG_ID = "daemon-host";
const DISABLED_HOST_KEYS_PER_HOST = 3;
const GLOBAL_VARIABLES = 60;
const PROJECT_VARIABLES = 20;
const LEGACY_AUTOMATION_ROWS = 50;
const LEGACY_RUNS_PER_AUTOMATION = 40;
const DAY_MS = 86_400_000;

interface CredentialsAttachmentsSeed {
  busyHostId: string;
  redeemableHashedKey: string;
  attachmentId: string;
  ownedAttachmentPaths: string[];
}

function insertKey(
  db: DbConnection,
  key: {
    id: string;
    configId: string;
    hostId: string;
    enabled: boolean;
    remaining: number | null;
    expiresAt: Date | null;
    createdAt: Date;
  },
): void {
  db.insert(authApiKeys)
    .values({
      id: key.id,
      name: null,
      start: null,
      prefix: key.configId === ENROLL_CONFIG_ID ? "bbde_" : "bbdh_",
      key: `hashed-${key.id}`,
      referenceId: SYSTEM_USER_ID,
      refillInterval: null,
      refillAmount: null,
      lastRefillAt: null,
      enabled: key.enabled,
      rateLimitEnabled: false,
      rateLimitTimeWindow: 86_400_000,
      rateLimitMax: 10,
      requestCount: 0,
      remaining: key.remaining,
      lastRequest: null,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
      updatedAt: key.createdAt,
      permissions: null,
      metadata: JSON.stringify({ hostId: key.hostId }),
      configId: key.configId,
    })
    .run();
}

function seedCredentials(db: DbConnection, hostIds: readonly string[]): string {
  const now = Date.now();
  insertAuthUserIfMissing(db, {
    id: SYSTEM_USER_ID,
    name: "Machine Auth System",
    email: "query-costs-machine-auth@bb.internal",
    now: new Date(now),
  });
  let redeemable = "";
  hostIds.forEach((hostId, hostIndex) => {
    for (let index = 0; index < DISABLED_HOST_KEYS_PER_HOST; index += 1) {
      insertKey(db, {
        id: `host-key-${hostIndex}-old-${index}`,
        configId: HOST_CONFIG_ID,
        hostId,
        enabled: false,
        remaining: null,
        expiresAt: null,
        createdAt: new Date(now - (index + 2) * DAY_MS),
      });
    }
    insertKey(db, {
      id: `host-key-${hostIndex}`,
      configId: HOST_CONFIG_ID,
      hostId,
      enabled: true,
      remaining: null,
      expiresAt: null,
      createdAt: new Date(now - DAY_MS),
    });
    insertKey(db, {
      id: `enroll-key-${hostIndex}-used`,
      configId: ENROLL_CONFIG_ID,
      hostId,
      enabled: true,
      remaining: 0,
      expiresAt: new Date(now - DAY_MS),
      createdAt: new Date(now - 2 * DAY_MS),
    });
    if (hostIndex % 4 === 0) {
      const id = `enroll-key-${hostIndex}-pending`;
      insertKey(db, {
        id,
        configId: ENROLL_CONFIG_ID,
        hostId,
        enabled: true,
        remaining: 1,
        expiresAt: new Date(now + 15 * 60_000),
        createdAt: new Date(now),
      });
      if (redeemable === "") redeemable = `hashed-${id}`;
    }
  });
  return redeemable;
}

function seedEnvironmentVariables(db: DbConnection, projectId: string): void {
  for (let index = 0; index < GLOBAL_VARIABLES; index += 1) {
    saveEnvironmentVariable(db, {
      projectId: null,
      name: `GLOBAL_VARIABLE_${index}`,
      ciphertext: "c".repeat(120),
      encryptionVersion: 2,
      note: index % 3 === 0 ? "rotated quarterly" : null,
    });
  }
  for (let index = 0; index < PROJECT_VARIABLES; index += 1) {
    saveEnvironmentVariable(db, {
      projectId,
      name: `PROJECT_VARIABLE_${index}`,
      ciphertext: "p".repeat(120),
      encryptionVersion: 2,
      note: null,
    });
  }
}

function seedCredentialsAttachments(
  db: DbConnection,
  fixture: HistoryFixture,
  scale: number,
): CredentialsAttachmentsSeed {
  const hostIds = db
    .select({ id: hosts.id })
    .from(hosts)
    .orderBy(asc(hosts.id))
    .all()
    .map((row) => row.id);
  const redeemableHashedKey = seedCredentials(db, [
    fixture.hostId,
    ...hostIds.filter((id) => id !== fixture.hostId),
  ]);
  for (let index = 0; index < scaled(200, scale); index += 1) {
    insertKey(db, {
      id: `busy-host-key-history-${index}`,
      configId: HOST_CONFIG_ID,
      hostId: fixture.hostId,
      enabled: false,
      remaining: null,
      expiresAt: null,
      createdAt: new Date(Date.now() - (index + 10) * DAY_MS),
    });
  }
  seedEnvironmentVariables(db, fixture.projectId);
  const attachment = db
    .select({ id: projectAttachments.id })
    .from(projectAttachments)
    .where(eq(projectAttachments.projectId, fixture.projectId))
    .orderBy(asc(projectAttachments.id))
    .limit(1)
    .get();
  if (attachment === undefined) {
    throw new Error("Expected a seeded project attachment");
  }
  const owned = db
    .select({ storedPath: projectAttachments.storedPath })
    .from(projectAttachmentThreads)
    .innerJoin(
      projectAttachments,
      eq(projectAttachments.id, projectAttachmentThreads.attachmentId),
    )
    .where(eq(projectAttachmentThreads.threadId, fixture.threadId))
    .orderBy(asc(projectAttachments.storedPath))
    .limit(5)
    .all();
  return {
    busyHostId: fixture.hostId,
    redeemableHashedKey,
    attachmentId: attachment.id,
    ownedAttachmentPaths: owned.map((row) => row.storedPath),
  };
}

function createLegacyAutomationTables(db: DbConnection): void {
  db.$client.exec(`
    CREATE TABLE automations (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      target_thread_id TEXT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      run_mode TEXT NOT NULL,
      execution TEXT NOT NULL,
      environment TEXT NOT NULL,
      auto_archive INTEGER NOT NULL,
      origin TEXT NOT NULL,
      created_by_thread_id TEXT,
      next_run_at INTEGER,
      last_run_at INTEGER,
      run_count INTEGER NOT NULL,
      last_run_status TEXT,
      last_run_thread_id TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE automation_runs (
      id TEXT PRIMARY KEY NOT NULL,
      automation_id TEXT NOT NULL,
      run_mode TEXT NOT NULL,
      thread_id TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      skip_reason TEXT,
      error TEXT,
      output TEXT,
      exit_code INTEGER,
      idempotency_key TEXT,
      scheduled_for INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER
    );
  `);
  const insertAutomation = db.$client.prepare(
    `INSERT INTO automations VALUES (?, ?, NULL, ?, 1, 'schedule', '{"cron":"0 9 * * *"}', 'agent', '{"mode":"agent"}', '{}', 0, 'human', NULL, NULL, NULL, ?, 'succeeded', NULL, NULL, ?, ?)`,
  );
  const insertRun = db.$client.prepare(
    `INSERT INTO automation_runs VALUES (?, ?, 'agent', NULL, 'succeeded', 'schedule', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
  );
  const now = Date.now();
  for (let index = 0; index < LEGACY_AUTOMATION_ROWS; index += 1) {
    const automationId = `legacy-automation-${index}`;
    insertAutomation.run(
      automationId,
      "legacy-project",
      `Legacy automation ${index}`,
      LEGACY_RUNS_PER_AUTOMATION,
      now - index * DAY_MS,
      now,
    );
    for (let run = 0; run < LEGACY_RUNS_PER_AUTOMATION; run += 1) {
      const startedAt = now - run * DAY_MS;
      insertRun.run(
        `${automationId}-run-${run}`,
        automationId,
        startedAt,
        startedAt,
        startedAt + 60_000,
      );
    }
  }
}

const CASES: readonly QueryCostCase<CredentialsAttachmentsSeed>[] = [
  {
    name: `${AUTH_API_KEYS}#insertAuthUserIfMissing`,
    run: (db) =>
      insertAuthUserIfMissing(db, {
        id: SYSTEM_USER_ID,
        name: "Machine Auth System",
        email: "query-costs-machine-auth@bb.internal",
        now: new Date(),
      }),
  },
  {
    name: `${AUTH_API_KEYS}#disableEnabledAuthApiKeysForHost`,
    growsWith: {
      history:
        "Filters the config's keys by json_extract(metadata, '$.hostId') because no column or index holds the host, so every key of the config is read, and the seed grows the hosts and their re-enrolled keys",
    },
    run: (db, _fixture, seed) =>
      disableEnabledAuthApiKeysForHost(db, {
        configId: HOST_CONFIG_ID,
        hostId: seed.busyHostId,
        preserveKeyId: "host-key-0",
        updatedAt: new Date(),
      }),
  },
  {
    name: `${AUTH_API_KEYS}#deleteExpiredAuthApiKeys`,
    growsWith: {
      history:
        "Deletes every expired enroll key, and the seed grows the hosts that each left one behind",
    },
    run: (db) =>
      deleteExpiredAuthApiKeys(db, {
        configIds: [ENROLL_CONFIG_ID, HOST_CONFIG_ID],
        now: new Date(),
      }),
  },
  {
    name: `${AUTH_API_KEYS}#findRedeemableAuthApiKey`,
    run: (db, _fixture, seed) =>
      findRedeemableAuthApiKey(db, {
        configId: ENROLL_CONFIG_ID,
        hashedKey: seed.redeemableHashedKey,
        now: new Date(),
      }),
  },
  {
    name: `${AUTH_API_KEYS}#hasEnabledAuthApiKeyForHost`,
    growsWith: {
      history:
        "Filters the config's keys by json_extract(metadata, '$.hostId') because no column or index holds the host, so every key of the config is read, and the seed grows the hosts and their re-enrolled keys",
    },
    run: (db) =>
      hasEnabledAuthApiKeyForHost(db, {
        configId: HOST_CONFIG_ID,
        hostId: "host-without-a-key",
      }),
  },
  {
    name: `${ENVIRONMENT_VARIABLES}#listEnvironmentVariables`,
    run: (db) => listEnvironmentVariables(db, null),
  },
  {
    name: `${ENVIRONMENT_VARIABLES}#listEnvironmentVariables`,
    variant: "project",
    run: (db, fixture) => listEnvironmentVariables(db, fixture.projectId),
  },
  {
    name: `${ENVIRONMENT_VARIABLES}#hasAnyEnvironmentVariable`,
    run: (db) => hasAnyEnvironmentVariable(db),
  },
  {
    name: `${ENVIRONMENT_VARIABLES}#deleteEnvironmentVariable`,
    run: (db, fixture) =>
      deleteEnvironmentVariable(db, {
        projectId: fixture.projectId,
        name: "PROJECT_VARIABLE_3",
      }),
  },
  {
    name: `${ENVIRONMENT_VARIABLES}#saveEnvironmentVariable`,
    run: (db) =>
      saveEnvironmentVariable(db, {
        projectId: null,
        name: "GLOBAL_VARIABLE_7",
        ciphertext: "n".repeat(120),
        encryptionVersion: 2,
        note: null,
      }),
  },
  {
    name: `${ENVIRONMENT_VARIABLES}#deleteEnvironmentVariablesInScope`,
    run: (db, fixture) =>
      deleteEnvironmentVariablesInScope(db, fixture.projectId),
  },
  {
    name: `${LEGACY_AUTOMATIONS}#legacyAutomationTableExists`,
    run: (db) => legacyAutomationTableExists(db, "automations"),
  },
  {
    name: `${LEGACY_AUTOMATIONS}#countLegacyAutomations`,
    prepare: (db) => createLegacyAutomationTables(db),
    run: (db) => countLegacyAutomations(db),
  },
  {
    name: `${LEGACY_AUTOMATIONS}#listLegacyAutomationRows`,
    prepare: (db) => createLegacyAutomationTables(db),
    run: (db) => listLegacyAutomationRows(db),
  },
  {
    name: `${LEGACY_AUTOMATIONS}#listLegacyAutomationRunRows`,
    prepare: (db) => createLegacyAutomationTables(db),
    run: (db) => listLegacyAutomationRunRows(db),
  },
  {
    name: `${BACKFILL}#getProjectAttachmentBackfill`,
    run: (db, fixture) => getProjectAttachmentBackfill(db, fixture.projectId),
  },
  {
    name: `${BACKFILL}#nextCompletedProjectAttachmentBackfill`,
    run: (db) =>
      nextCompletedProjectAttachmentBackfill(db, {
        afterProjectId: "",
        excludedProjectIds: new Set(),
      }),
  },
  {
    name: `${BACKFILL}#commitAttachmentBackfillStep`,
    run: (db, fixture, seed) =>
      commitAttachmentBackfillStep(db, {
        paths: seed.ownedAttachmentPaths,
        next: {
          ...ensureProjectAttachmentBackfill(db, fixture.projectId),
          phase: "done",
        },
        threadId: fixture.threadId,
      }),
  },
  {
    name: `${ATTACHMENTS}#markProjectAttachmentReady`,
    run: (db, _fixture, seed) =>
      markProjectAttachmentReady(db, {
        attachmentId: seed.attachmentId,
        readyAt: Date.now(),
      }),
  },
  {
    name: `${ATTACHMENTS}#claimUnreadyProjectAttachmentDeletion`,
    prepare: (db, _fixture, seed) => {
      db.update(projectAttachments)
        .set({ readyAt: null })
        .where(eq(projectAttachments.id, seed.attachmentId))
        .run();
    },
    run: (db, _fixture, seed) =>
      claimUnreadyProjectAttachmentDeletion(db, {
        attachmentId: seed.attachmentId,
        claimedAt: Date.now(),
      }),
  },
  {
    name: `${ATTACHMENTS}#deleteClaimedProjectAttachment`,
    prepare: (db, _fixture, seed) => {
      db.update(projectAttachments)
        .set({ deletionClaimedAt: Date.now() })
        .where(
          and(
            eq(projectAttachments.id, seed.attachmentId),
            isNotNull(projectAttachments.readyAt),
          ),
        )
        .run();
    },
    run: (db, _fixture, seed) =>
      deleteClaimedProjectAttachment(db, seed.attachmentId),
  },
  {
    name: `${SESSIONS}#listActiveSessionHosts`,
    run: (db) => listActiveSessionHosts(db),
  },
];

export const CREDENTIALS_ATTACHMENTS_COST_GROUP = registerCostGroup({
  name: "credentials-attachments",
  seed: seedCredentialsAttachments,
  cases: CASES,
});
