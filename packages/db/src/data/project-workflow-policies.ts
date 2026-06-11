import { eq } from "drizzle-orm";
import type { WorkflowSandbox } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { projectWorkflowPolicies } from "../schema.js";

type ProjectWorkflowPolicyConnection = DbConnection | DbTransaction;

export type ProjectWorkflowPolicyRow =
  typeof projectWorkflowPolicies.$inferSelect;

/**
 * The project's explicit workflow policy row, or null when the project has
 * never set one (the server then applies its built-in policy defaults).
 */
export function getProjectWorkflowPolicy(
  db: ProjectWorkflowPolicyConnection,
  projectId: string,
): ProjectWorkflowPolicyRow | null {
  return (
    db
      .select()
      .from(projectWorkflowPolicies)
      .where(eq(projectWorkflowPolicies.projectId, projectId))
      .get() ?? null
  );
}

export interface UpsertProjectWorkflowPolicyArgs {
  /** Null = clear any project budget default (launches run unbounded). */
  defaultBudgetOutputTokens: number | null;
  projectId: string;
  sandboxCeiling: WorkflowSandbox;
}

export function upsertProjectWorkflowPolicy(
  db: ProjectWorkflowPolicyConnection,
  args: UpsertProjectWorkflowPolicyArgs,
): ProjectWorkflowPolicyRow {
  const now = Date.now();
  return db
    .insert(projectWorkflowPolicies)
    .values({
      projectId: args.projectId,
      sandboxCeiling: args.sandboxCeiling,
      defaultBudgetOutputTokens: args.defaultBudgetOutputTokens,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectWorkflowPolicies.projectId,
      set: {
        sandboxCeiling: args.sandboxCeiling,
        defaultBudgetOutputTokens: args.defaultBudgetOutputTokens,
        updatedAt: now,
      },
    })
    .returning()
    .get();
}
