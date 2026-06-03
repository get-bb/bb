import { Command } from "commander";
import { PERSONAL_PROJECT_ID, type Thread } from "@bb/domain";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { fetchLocalHostId } from "../daemon.js";
import { renderBorderlessTable } from "../table.js";
import { resolveProjectIdWithLabel } from "../context-env.js";
import {
  confirmDestructiveAction,
  outputJson,
  parseReasoningLevel,
  printContextLabel,
} from "./helpers.js";
import { parseServiceTier } from "./thread/helpers.js";

interface ManagerHireCommandOptions {
  json?: boolean;
  project?: string;
  name?: string;
  host?: string;
  provider?: string;
  model?: string;
  serviceTier?: string;
  reasoningLevel?: string;
}

interface ManagerListCommandOptions {
  json?: boolean;
  project?: string;
}

interface ManagerStatusCommandOptions {
  json?: boolean;
}

interface ManagerDeleteCommandOptions {
  confirmAssignedChildThreads?: boolean;
  yes?: boolean;
  json?: boolean;
}

interface PrintThreadsTableArgs {
  includeProject: boolean;
  threads: Thread[];
}

export function registerManagerCommands(
  program: Command,
  getUrl: () => string,
): void {
  const manager = program.command("manager").description("Manage managers");

  manager
    .command("hire [projectId]")
    .description(
      "Hire a new manager; defaults to projectless when no project context is set",
    )
    .option("--project <id>", "Project ID (defaults to BB_PROJECT_ID)")
    .option("--name <name>", "Manager name")
    .option(
      "--provider <id>",
      "Provider ID for the manager. Omit to use the project's remembered manager defaults or the server manager policy",
    )
    .option(
      "--model <model>",
      "Model ID for the manager. Omit to use the remembered or server default for the resolved provider",
    )
    .option("--service-tier <tier>", "Service tier: fast or default")
    .option(
      "--reasoning-level <level>",
      "Reasoning level (low, medium, high, xhigh, max; provider-dependent)",
    )
    .option("--host <id>", "Host ID (defaults to local host)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectIdArg: string | undefined,
          opts: ManagerHireCommandOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const resolvedProject = resolveProjectIdWithLabel(
            projectIdArg ?? opts.project,
          );
          const projectId = resolvedProject?.id ?? PERSONAL_PROJECT_ID;
          if (resolvedProject) {
            printContextLabel(
              resolvedProject,
              "Project",
              "BB_PROJECT_ID",
              opts,
            );
          }
          const reasoningLevel = parseReasoningLevel(opts.reasoningLevel);
          const serviceTier = parseServiceTier(opts.serviceTier);
          let hostId: string | undefined = opts.host;
          if (!hostId) {
            hostId = (await fetchLocalHostId()) ?? undefined;
            if (!hostId) {
              throw new Error(
                "Cannot auto-detect host ID (daemon unreachable). Pass --host <id> explicitly.",
              );
            }
          }
          const thread = await sdk.managers.hire({
            projectId,
            origin: "cli",
            ...(opts.name ? { name: opts.name } : {}),
            ...(opts.provider ? { providerId: opts.provider } : {}),
            ...(opts.model ? { model: opts.model } : {}),
            ...(serviceTier ? { serviceTier } : {}),
            environment: { type: "host", hostId },
            ...(reasoningLevel ? { reasoningLevel } : {}),
          });
          if (outputJson(opts, thread)) return;
          console.log(`Manager hired: ${thread.id}`);
          printManagerThread(thread);
        },
      ),
    );

  manager
    .command("list [projectId]")
    .description(
      "List managers; without project context, lists managers across all projects",
    )
    .option(
      "--project <id>",
      "Project ID (defaults to BB_PROJECT_ID; omit both to list all projects)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          projectIdArg: string | undefined,
          opts: ManagerListCommandOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          const resolvedProject = resolveProjectIdWithLabel(
            projectIdArg ?? opts.project,
          );
          if (resolvedProject) {
            printContextLabel(
              resolvedProject,
              "Project",
              "BB_PROJECT_ID",
              opts,
            );
          }
          const managers = await sdk.managers.list(
            resolvedProject ? { projectId: resolvedProject.id } : {},
          );
          if (outputJson(opts, managers)) return;
          if (managers.length === 0) {
            console.log("No managers hired");
            return;
          }
          printThreadsTable({
            includeProject: resolvedProject === undefined,
            threads: managers,
          });
        },
      ),
    );

  manager
    .command("status <id>")
    .description("Show manager status and managed threads")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ManagerStatusCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const result = await sdk.managers.status({ managerId: id });
        if (outputJson(opts, result)) return;
        printManagerThread(result.manager);
        printManagedThreadTable(result.managedThreads);
      }),
    );

  manager
    .command("delete <id>")
    .description("Delete a manager permanently")
    .option("--yes", "Skip the confirmation prompt")
    .option(
      "--confirm-assigned-child-threads",
      "Confirm deleting a manager with assigned child threads",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, opts: ManagerDeleteCommandOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const managerThreadId = id;
        const managerThread = await sdk.threads.get({ threadId: managerThreadId });
        if (managerThread.type !== "manager") {
          throw new Error(`Thread ${managerThreadId} is not a manager`);
        }
        if (!opts.yes) {
          const confirmed = await confirmDestructiveAction(
            `Delete manager "${managerThread.title ?? managerThread.id}" permanently? This cannot be undone.`,
          );
          if (!confirmed) {
            console.log(`Manager ${managerThreadId} deletion cancelled`);
            return;
          }
        }
        await sdk.managers.delete({
          managerId: managerThreadId,
          managerChildThreadsConfirmed:
            opts.confirmAssignedChildThreads === true,
        });
        if (outputJson(opts, { ok: true, managerId: managerThreadId })) return;
        console.log(`Manager ${managerThreadId} deleted`);
      }),
    );
}

function printManagerThread(thread: Thread): void {
  console.log("");
  console.log(`  ID:       ${thread.id}`);
  console.log(`  Title:    ${thread.title ?? "<untitled>"}`);
  console.log(`  Type:     ${thread.type}`);
  console.log(`  Status:   ${thread.status}`);
  console.log(`  Project:  ${formatProjectLabel(thread.projectId)}`);
  console.log(`  Created:  ${new Date(thread.createdAt).toLocaleString()}`);
  console.log(`  Updated:  ${new Date(thread.updatedAt).toLocaleString()}`);
  console.log("");
}

function formatProjectLabel(projectId: string): string {
  return projectId === PERSONAL_PROJECT_ID ? "-" : projectId;
}

function printThreadsTable(args: PrintThreadsTableArgs): void {
  const rows = args.threads.map((thread) =>
    args.includeProject
      ? [
          thread.id,
          formatProjectLabel(thread.projectId),
          thread.status,
          thread.title ?? "<untitled>",
        ]
      : [thread.id, thread.status, thread.title ?? "<untitled>"],
  );
  const idWidth = Math.max(4, ...rows.map((row) => row[0].length));
  const tableArgs = args.includeProject
    ? {
        head: ["ID", "Project", "Status", "Title"],
        colWidths: [
          idWidth,
          Math.max(7, ...rows.map((row) => row[1].length)),
          Math.max(6, ...rows.map((row) => row[2].length)),
          Math.max(5, ...rows.map((row) => row[3].length)),
        ],
      }
    : {
        head: ["ID", "Status", "Title"],
        colWidths: [
          idWidth,
          Math.max(6, ...rows.map((row) => row[1].length)),
          Math.max(5, ...rows.map((row) => row[2].length)),
        ],
      };
  const table = renderBorderlessTable(tableArgs, rows);
  console.log("");
  console.log(table);
  console.log("");
}

function printManagedThreadTable(threads: Thread[]): void {
  console.log("Managed threads:");
  if (threads.length === 0) {
    console.log("  None");
    return;
  }
  printThreadsTable({ includeProject: false, threads });
}
