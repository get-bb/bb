import { Command } from "commander";
import { threadVisibilitySchema, type Thread } from "@bb/domain";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, prependErrorContext } from "../helpers.js";
import { parsePermissionMode, PERMISSION_MODE_HELP } from "./helpers.js";

interface ThreadImportCommandOptions {
  project: string;
  provider: string;
  providerSession: string;
  host?: string;
  cwd: string;
  json?: boolean;
  permissionMode?: string;
  title?: string;
  visibility?: string;
}

export function registerImportCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("import")
    .description(
      "Import an existing external ACP provider session as a thread",
    )
    .requiredOption("--project <id>", "Project the imported thread belongs to")
    .requiredOption(
      "--provider <acp-provider>",
      'ACP provider that owns the session (e.g. "acp-omp")',
    )
    .requiredOption(
      "--provider-session <external-session-id>",
      "External provider session ID to import",
    )
    .option("--host <id>", "Host the session lives on (default: primary host)")
    .requiredOption(
      "--cwd <path>",
      "Working directory the session ran in; must match the project source " +
        "path or an existing workspace of the project",
    )
    .option("--title <title>", "Thread title")
    .option("--permission-mode <mode>", PERMISSION_MODE_HELP)
    .option("--visibility <visibility>", "Thread visibility: visible or hidden")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: ThreadImportCommandOptions) => {
        const permissionMode = parsePermissionMode(opts.permissionMode);
        const visibility =
          opts.visibility === undefined
            ? undefined
            : threadVisibilitySchema.parse(opts.visibility);

        let thread: Thread;
        try {
          thread = await createCliBbSdk(getUrl()).threads.import({
            projectId: opts.project,
            providerId: opts.provider,
            providerSessionId: opts.providerSession,
            origin: "cli",
            ...(opts.host === undefined ? {} : { hostId: opts.host }),
            cwd: opts.cwd,
            ...(opts.title === undefined ? {} : { title: opts.title }),
            ...(permissionMode === undefined ? {} : { permissionMode }),
            ...(visibility === undefined ? {} : { visibility }),
          });
        } catch (error: unknown) {
          throw prependErrorContext(
            `Failed to import provider session ${opts.providerSession}`,
            error,
          );
        }

        if (outputJson(opts, thread)) return;
        console.log(`Thread imported: ${thread.id}`);
        console.log(`Provider: ${opts.provider}`);
        console.log(`Provider session: ${opts.providerSession}`);
        console.log(`Status: ${thread.status}`);
        if (thread.visibility === "hidden") {
          console.log("Visibility: hidden");
        }
      }),
    );
}
