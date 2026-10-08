import { eq, inArray } from "drizzle-orm";
import {
  parseStoredModelOptionValues,
  serializeModelOptionValues,
  type ProjectExecutionDefaults,
  type PermissionMode,
  type ReasoningLevel,
  type ServiceTier,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectExecutionDefaults } from "../schema.js";

export interface GetProjectExecutionDefaultsArgs {
  projectId: string;
}

export interface ListProjectExecutionDefaultsByProjectIdsArgs {
  projectIds: readonly string[];
}

export interface UpsertProjectExecutionDefaultsArgs extends GetProjectExecutionDefaultsArgs {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  serviceTier: ServiceTier;
  modelOptions: Readonly<Record<string, string>>;
}

function toProjectExecutionDefaults(row: {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  serviceTier: ServiceTier;
  modelOptionsJson: string;
}): ProjectExecutionDefaults {
  const { modelOptionsJson, ...defaults } = row;
  return {
    ...defaults,
    modelOptions: parseStoredModelOptionValues(modelOptionsJson),
  };
}

export function getProjectExecutionDefaults(
  db: DbConnection,
  args: GetProjectExecutionDefaultsArgs,
): ProjectExecutionDefaults | null {
  const row = db
    .select({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
      modelOptionsJson: projectExecutionDefaults.modelOptionsJson,
    })
    .from(projectExecutionDefaults)
    .where(eq(projectExecutionDefaults.projectId, args.projectId))
    .get();

  return row ? toProjectExecutionDefaults(row) : null;
}

export function listProjectExecutionDefaultsByProjectIds(
  db: DbConnection,
  args: ListProjectExecutionDefaultsByProjectIdsArgs,
): Map<string, ProjectExecutionDefaults> {
  const byProjectId = new Map<string, ProjectExecutionDefaults>();
  if (args.projectIds.length === 0) {
    return byProjectId;
  }

  const rows = db
    .select({
      projectId: projectExecutionDefaults.projectId,
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
      modelOptionsJson: projectExecutionDefaults.modelOptionsJson,
    })
    .from(projectExecutionDefaults)
    .where(inArray(projectExecutionDefaults.projectId, [...args.projectIds]))
    .all();

  for (const row of rows) {
    const { projectId, ...defaults } = row;
    byProjectId.set(projectId, toProjectExecutionDefaults(defaults));
  }
  return byProjectId;
}

export function upsertProjectExecutionDefaults(
  db: DbConnection,
  args: UpsertProjectExecutionDefaultsArgs,
): ProjectExecutionDefaults {
  const updatedAt = Date.now();
  const row = db
    .insert(projectExecutionDefaults)
    .values({
      projectId: args.projectId,
      providerId: args.providerId,
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      permissionMode: args.permissionMode,
      serviceTier: args.serviceTier,
      modelOptionsJson: serializeModelOptionValues(args.modelOptions),
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [projectExecutionDefaults.projectId],
      set: {
        providerId: args.providerId,
        model: args.model,
        reasoningLevel: args.reasoningLevel,
        permissionMode: args.permissionMode,
        serviceTier: args.serviceTier,
        modelOptionsJson: serializeModelOptionValues(args.modelOptions),
        updatedAt,
      },
    })
    .returning({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
      modelOptionsJson: projectExecutionDefaults.modelOptionsJson,
    })
    .get();

  return toProjectExecutionDefaults(row);
}
