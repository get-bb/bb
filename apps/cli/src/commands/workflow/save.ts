import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { loadCommonConfig } from "@bb/config/common";
import { action } from "../../action.js";
import { outputJson } from "../helpers.js";
import { readValidatedWorkflowFile } from "./validate.js";

interface WorkflowSaveCommandOptions {
  json?: boolean;
}

/** Filesystem-safe workflow names only — `meta.name` becomes the saved filename. */
const SAVABLE_WORKFLOW_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * The user registry tier lives at `<dataDir>/workflows` on this host; the
 * daemon rescans it on every `workflow.list`, so a plain local copy is the
 * whole save. Resolves the data dir with the same config machinery the daemon
 * uses (`BB_DATA_DIR`, else the mode default) — dev instances run with
 * checkout-scoped data dirs, so dev saves need `BB_DATA_DIR` set (the same
 * way dev CLI use needs `BB_SERVER_URL`).
 */
function resolveUserWorkflowsDir(): string {
  try {
    return join(loadCommonConfig().BB_DATA_DIR, "workflows");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot resolve the host data dir (${message}). Set BB_DATA_DIR to the host daemon's data dir and retry.`,
    );
  }
}

export function registerWorkflowSaveCommand(parent: Command): void {
  parent
    .command("save <file>")
    .description(
      "Validate a workflow file and copy it to this host's user tier (<dataDir>/workflows)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (file: string, opts: WorkflowSaveCommandOptions) => {
        const { content, meta } = await readValidatedWorkflowFile(file);
        if (!SAVABLE_WORKFLOW_NAME_PATTERN.test(meta.name)) {
          throw new Error(
            `Workflow name "${meta.name}" is not a safe filename. Saved workflow names may contain only letters, digits, dots, hyphens, and underscores.`,
          );
        }

        const workflowsDir = resolveUserWorkflowsDir();
        const targetPath = join(workflowsDir, `${meta.name}.workflow.js`);
        await mkdir(workflowsDir, { recursive: true });
        await writeFile(targetPath, content, "utf8");

        if (outputJson(opts, { name: meta.name, path: targetPath, tier: "user" }))
          return;
        console.log(`Saved workflow '${meta.name}' to ${targetPath}`);
        console.log(
          "It is now visible to every project on this host (project-tier .bb/workflows files win on name conflicts).",
        );
      }),
    );
}
