import { readFile } from "node:fs/promises";
import { Command } from "commander";
// The /validation subpath only — the @bb/workflow-runtime barrel re-exports
// the sandbox module, which would pull node:vm into the CLI bundle.
import {
  determinismLint,
  parseWorkflow,
  WorkflowSyntaxError,
  type LintFinding,
  type Meta,
} from "@bb/workflow-runtime/validation";
import { action, CliExitError } from "../../action.js";
import { outputJson } from "../helpers.js";

interface WorkflowValidateCommandOptions {
  json?: boolean;
}

export type WorkflowSourceValidation =
  | { ok: true; meta: Meta }
  | { ok: false; syntaxError: string }
  | { ok: false; findings: LintFinding[] };

/**
 * The exact validation the server launch gate applies
 * (`validateWorkflowScriptSource`): structural pure-literal meta parse + zod
 * meta schema + static determinism lint — no vm, no host, no server.
 */
export function validateWorkflowSource(
  content: string,
): WorkflowSourceValidation {
  let meta: Meta;
  try {
    meta = parseWorkflow(content).meta;
  } catch (error) {
    if (error instanceof WorkflowSyntaxError) {
      return { ok: false, syntaxError: error.message };
    }
    throw error;
  }
  const findings = determinismLint(content);
  if (findings.length > 0) {
    return { ok: false, findings };
  }
  return { ok: true, meta };
}

export interface ValidatedWorkflowFile {
  content: string;
  meta: Meta;
}

/** Read and validate a workflow file, throwing the human-readable failure. */
export async function readValidatedWorkflowFile(
  file: string,
): Promise<ValidatedWorkflowFile> {
  const content = await readFile(file, "utf8");
  const validation = validateWorkflowSource(content);
  if (!validation.ok) {
    throw new CliExitError(formatValidationFailure(file, validation), 1);
  }
  return { content, meta: validation.meta };
}

function formatValidationFailure(
  file: string,
  validation: Extract<WorkflowSourceValidation, { ok: false }>,
): string {
  if ("syntaxError" in validation) {
    return `${file}: ${validation.syntaxError}`;
  }
  const findings = validation.findings
    .map((finding) => `${finding.token} (use ${finding.use} instead)`)
    .join("; ");
  return `${file}: violates the determinism contract: ${findings}`;
}

export function registerWorkflowValidateCommand(parent: Command): void {
  parent
    .command("validate <file>")
    .description(
      "Validate a workflow file locally: pure-literal meta parse + determinism lint (the same gate the server applies at launch)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (file: string, opts: WorkflowValidateCommandOptions) => {
        const content = await readFile(file, "utf8");
        const validation = validateWorkflowSource(content);

        if (outputJson(opts, { file, ...validation })) {
          if (!validation.ok) {
            throw new CliExitError(`${file} is not a valid workflow.`, 1);
          }
          return;
        }

        if (!validation.ok) {
          throw new CliExitError(formatValidationFailure(file, validation), 1);
        }
        console.log(`${file} is a valid workflow.`);
        console.log(`  Name: ${validation.meta.name}`);
        console.log(`  Description: ${validation.meta.description}`);
        if (validation.meta.whenToUse !== undefined) {
          console.log(`  When to use: ${validation.meta.whenToUse}`);
        }
        if (validation.meta.phases !== undefined) {
          console.log(`  Phases: ${validation.meta.phases.length}`);
        }
      }),
    );
}
