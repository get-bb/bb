import type { Storage } from "./storage.js";
import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import { policySchema } from "./contract.js";
import type { Service } from "./service.js";

const MACHINE = { type: "string", description: "Machine ID" } as const;
const YES = {
  type: "boolean",
  description: "Confirm this destructive operation",
} as const;
function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`Provide --${name}.`);
  return value;
}
function days(value: string | undefined, fallback: number | null) {
  if (value === undefined) return fallback;
  if (value === "never") return null;
  if (!/^\d+$/.test(value))
    throw new Error("Use a number of days (1–3650) or never.");
  return Number(value);
}
async function output(work: () => Promise<unknown>): Promise<PluginCliResult> {
  try {
    return {
      exitCode: 0,
      stdout: JSON.stringify(await work(), null, 2) + "\n",
    };
  } catch (error) {
    return {
      exitCode: 1,
      stderr: (error instanceof Error ? error.message : String(error)) + "\n",
    };
  }
}
export function registerCli(
  bb: BbPluginApi,
  service: Service,
  storage: Storage,
) {
  bb.cli.register(
    defineCli({
      name: "storage",
      summary: "Inspect storage and manage thread retention (JSON output)",
      root: cliCommand({
        summary: "Show storage commands",
        run: (input) => ({ exitCode: 0, stdout: input.help }),
      }),
      commands: {
        retention: cliCommand({
          summary:
            "Show policy and last run, preview thresholds, or save with --save --yes",
          options: {
            "archive-after": {
              type: "string",
              description: "Idle days before archiving, or never",
            },
            "delete-after": {
              type: "string",
              description: "Archived days before deleting, or never",
            },
            save: {
              type: "boolean",
              description: "Save the supplied thresholds",
            },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              const state = await service.state();
              const policy = policySchema.parse({
                archiveAfterDays: days(
                  input.options["archive-after"],
                  state.policy.archiveAfterDays,
                ),
                deleteAfterDays: days(
                  input.options["delete-after"],
                  state.policy.deleteAfterDays,
                ),
              });
              if (input.options.save) {
                if (!input.options.yes)
                  throw new Error(
                    "Preview first, then pass --save --yes to confirm the policy.",
                  );
                return service.configure(policy);
              }
              if (
                input.options["archive-after"] !== undefined ||
                input.options["delete-after"] !== undefined
              )
                return { policy, preview: await service.preview(policy) };
              return state;
            }),
        }),
        usage: cliCommand({
          summary:
            "Read cached machine usage; --rescan starts a background scan, rerun to see results",
          options: {
            machine: MACHINE,
            rescan: {
              type: "boolean",
              description:
                "Start a scan of --machine, or of every online machine",
            },
          },
          run: (input) =>
            output(async () => {
              if (input.options.rescan)
                return input.options.machine
                  ? storage.scanHost({ hostId: input.options.machine })
                  : storage.scanAll();
              return input.options.machine
                ? storage.host({
                    hostId: input.options.machine,
                  })
                : storage.hosts();
            }),
        }),
        "remove-orphans": cliCommand({
          summary: "Remove orphaned storage from the last scan",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Pass --yes to permanently remove orphaned storage.",
                );
              return storage.removeOrphans({
                hostId: required(input.options.machine, "machine"),
              });
            }),
        }),
        "clear-archived": cliCommand({
          summary:
            "Empty storage of archived threads on --machine, or on every scanned online machine",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Pass --yes to permanently clear archived thread storage.",
                );
              return storage.clearArchived({
                hostId: input.options.machine ?? null,
              });
            }),
        }),
        "retry-worktree-cleanup": cliCommand({
          summary: "Retry cleanup of leftover worktrees",
          options: { machine: MACHINE },
          run: (input) =>
            output(async () => {
              return storage.retryWorktreeCleanup({
                hostId: required(input.options.machine, "machine"),
              });
            }),
        }),
        "clear-thread": cliCommand({
          summary: "Empty a stopped thread's storage directory",
          options: {
            thread: { type: "string", description: "Thread ID" },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Pass --yes to permanently clear thread storage.",
                );
              return storage.clearThread({
                threadId: required(input.options.thread, "thread"),
              });
            }),
        }),
      },
    }),
  );
}
