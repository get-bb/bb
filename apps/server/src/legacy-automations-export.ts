import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  countLegacyAutomations,
  legacyAutomationTableExists,
  listLegacyAutomationRows,
  listLegacyAutomationRunRows,
  type DbConnection,
} from "@bb/db";
import { resolveContainedPath } from "@bb/process-utils";

interface LegacyAutomationsExportLogger {
  error(fields: { err: unknown }, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
}

const sqliteBooleanSchema = z.union([z.boolean(), z.number().int()]);

const automationRowSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    targetThreadId: z.string().min(1).nullable(),
    name: z.string().min(1),
    enabled: sqliteBooleanSchema,
    triggerType: z.enum(["schedule", "once"]),
    triggerConfig: z.string().min(1),
    runMode: z.enum(["agent", "script"]),
    execution: z.string().min(1),
    environment: z.string().min(1),
    autoArchive: sqliteBooleanSchema,
    origin: z.enum(["human", "app", "agent"]),
    createdByThreadId: z.string().min(1).nullable(),
    nextRunAt: z.number().int().nullable(),
    lastRunAt: z.number().int().nullable(),
    runCount: z.number().int().min(0),
    lastRunStatus: z
      .enum(["running", "succeeded", "failed", "skipped"])
      .nullable(),
    lastRunThreadId: z.string().min(1).nullable(),
    lastError: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();

const runRowSchema = z
  .object({
    id: z.string().min(1),
    automationId: z.string().min(1),
    runMode: z.enum(["agent", "script"]),
    threadId: z.string().min(1).nullable(),
    status: z.enum(["running", "succeeded", "failed", "skipped"]),
    trigger: z.enum(["schedule", "manual"]),
    skipReason: z.string().nullable(),
    error: z.string().nullable(),
    output: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    idempotencyKey: z.string().min(1).nullable(),
    scheduledFor: z.number().int(),
    startedAt: z.number().int(),
    finishedAt: z.number().int().nullable(),
  })
  .strict();

const scriptExecutionSchema = z
  .object({
    mode: z.literal("script"),
    scriptFile: z.string().min(1).optional(),
  })
  .passthrough();

const executionSchema = z.union([
  z.object({ mode: z.literal("agent") }).passthrough(),
  scriptExecutionSchema,
]);

function toBoolean(value: z.infer<typeof sqliteBooleanSchema>): boolean {
  return value === true || value === 1;
}

function containedPath(rootPath: string, pathFromRoot: string): string {
  const candidate = resolveContainedPath({
    rootPath,
    candidatePath: resolve(rootPath, pathFromRoot),
  });
  if (candidate !== null) return candidate;
  throw new Error(
    `Legacy automation script path escapes its directory: ${pathFromRoot}`,
  );
}

function readLegacyAutomationScripts(args: {
  automations: LegacyAutomationExportFile["automations"];
  dataDir: string;
  logger: LegacyAutomationsExportLogger;
}): LegacyAutomationExportFile["scripts"] {
  const scripts: LegacyAutomationExportFile["scripts"] = {};
  for (const automation of args.automations) {
    const execution = executionSchema.parse(JSON.parse(automation.execution));
    if (execution.mode !== "script" || execution.scriptFile === undefined) {
      continue;
    }
    const scriptDir = join(args.dataDir, "automation-scripts", automation.id);
    const scriptPath = containedPath(scriptDir, execution.scriptFile);
    let content: string;
    try {
      content = readFileSync(scriptPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      args.logger.error(
        { err },
        `Legacy automation ${automation.id} references missing script ${scriptPath}; exporting without script content`,
      );
      continue;
    }
    scripts[automation.id] = {
      fileName: execution.scriptFile,
      content,
    };
  }
  return scripts;
}

const legacyAutomationExportFileSchema = z
  .object({
    automations: z.array(
      automationRowSchema.transform((row) => ({
        ...row,
        enabled: toBoolean(row.enabled),
        autoArchive: toBoolean(row.autoArchive),
      })),
    ),
    runs: z.array(runRowSchema),
    scripts: z.record(
      z.string(),
      z.object({ fileName: z.string().min(1), content: z.string() }).strict(),
    ),
  })
  .strict();

type LegacyAutomationExportFile = z.infer<
  typeof legacyAutomationExportFileSchema
>;

function legacyImportPath(dataDir: string): string {
  return join(
    dataDir,
    "plugins",
    "automations",
    "import",
    "legacy-automations.json",
  );
}

function listLegacyAutomations(
  db: DbConnection,
): LegacyAutomationExportFile["automations"] {
  return z
    .array(automationRowSchema)
    .parse(listLegacyAutomationRows(db))
    .map((row) => ({
      ...row,
      enabled: toBoolean(row.enabled),
      autoArchive: toBoolean(row.autoArchive),
    }));
}

function listLegacyRuns(db: DbConnection): LegacyAutomationExportFile["runs"] {
  if (!legacyAutomationTableExists(db, "automation_runs")) {
    return [];
  }
  return z.array(runRowSchema).parse(listLegacyAutomationRunRows(db));
}

export function exportLegacyAutomationsForPluginImport(args: {
  dataDir: string;
  db: DbConnection;
  logger: LegacyAutomationsExportLogger;
}): void {
  const importPath = legacyImportPath(args.dataDir);
  if (
    existsSync(importPath) ||
    !legacyAutomationTableExists(args.db, "automations")
  ) {
    return;
  }

  const automationCount = countLegacyAutomations(args.db);
  if (automationCount === 0) {
    return;
  }

  try {
    const automations = listLegacyAutomations(args.db);
    const payload = legacyAutomationExportFileSchema.parse({
      automations,
      runs: listLegacyRuns(args.db),
      scripts: readLegacyAutomationScripts({
        automations,
        dataDir: args.dataDir,
        logger: args.logger,
      }),
    });

    mkdirSync(join(args.dataDir, "plugins", "automations", "import"), {
      recursive: true,
    });
    writeFileSync(importPath, `${JSON.stringify(payload, null, 2)}\n`, {
      mode: 0o600,
    });
    args.logger.info(
      {
        automationCount: payload.automations.length,
        importPath,
        runCount: payload.runs.length,
        scriptCount: Object.keys(payload.scripts).length,
      },
      "Exported legacy automations for builtin plugin import",
    );
  } catch (err) {
    args.logger.error(
      { err },
      "Failed to export legacy automations before destructive migration",
    );
    throw err;
  }
}

export function hasLegacyAutomationsToExport(db: DbConnection): boolean {
  return (
    legacyAutomationTableExists(db, "automations") &&
    countLegacyAutomations(db) > 0
  );
}
