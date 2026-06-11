// Built-in workflows shipped with the package. The .workflow.js files live in
// builtins/ beside src/ (plain workflow JS, runnable as-is); this module is
// how embedders (the registry's builtin tier, tests) read them.

import { readFileSync } from "node:fs";

export const BUILTIN_WORKFLOW_NAMES = ["deep-research", "code-review"] as const;
export type BuiltinWorkflowName = (typeof BUILTIN_WORKFLOW_NAMES)[number];

export interface BuiltinWorkflow {
  name: BuiltinWorkflowName;
  /** The full workflow file source. */
  source: string;
}

export function readBuiltinWorkflow(
  name: BuiltinWorkflowName,
): BuiltinWorkflow {
  const source = readFileSync(
    new URL(`../builtins/${name}.workflow.js`, import.meta.url),
    "utf8",
  );
  return { name, source };
}

export function listBuiltinWorkflows(): BuiltinWorkflow[] {
  return BUILTIN_WORKFLOW_NAMES.map(readBuiltinWorkflow);
}
