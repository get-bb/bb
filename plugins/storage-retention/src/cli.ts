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
function booleanSetting(
  value: string | undefined,
  fallback: boolean,
  flag: string,
) {
  if (value === undefined) return fallback;
  if (value !== "true" && value !== "false")
    throw new Error(`Use true or false for --${flag}.`);
  return value === "true";
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
        cleanup: cliCommand({
          summary: "Start background cleanup; read progress with storage usage",
          options: {
            machine: MACHINE,
            kind: {
              type: "string",
              description: "orphans, development, or worktrees",
            },
            yes: YES,
          },
          run: ({ options }) =>
            output(async () => {
              if (!options.yes)
                throw new Error("Pass --yes to confirm cleanup.");
              const kind = options.kind;
              if (
                kind !== "orphans" &&
                kind !== "development" &&
                kind !== "worktrees"
              )
                throw new Error(
                  "Use --kind orphans, development, or worktrees.",
                );
              await storage.startCleanup({
                hostId: required(options.machine, "machine"),
                kind,
              });
              return { started: true };
            }),
        }),
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
            "delete-storage-on-archive": {
              type: "string",
              description: "Delete thread storage on archive: true or false",
            },
            "delete-dev-data-on-checkout-removal": {
              type: "string",
              description:
                "Delete development data for missing checkouts: true or false",
            },
            save: {
              type: "boolean",
              description: "Save the supplied settings",
            },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              const state = await service.state();
              const cleanup = input.options["delete-storage-on-archive"];
              const devCleanup =
                input.options["delete-dev-data-on-checkout-removal"];
              const policy = policySchema.parse({
                deleteStorageOnArchive: booleanSetting(
                  cleanup,
                  state.policy.deleteStorageOnArchive,
                  "delete-storage-on-archive",
                ),
                deleteDevDataOnCheckoutRemoval: booleanSetting(
                  devCleanup,
                  state.policy.deleteDevDataOnCheckoutRemoval,
                  "delete-dev-data-on-checkout-removal",
                ),
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
                input.options["delete-after"] !== undefined ||
                cleanup !== undefined ||
                devCleanup !== undefined
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
        "clear-large-files": cliCommand({
          summary:
            "Delete files of 10 MB or more from archived threads on --machine, or on every scanned online machine",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Pass --yes to permanently delete large files from archived threads.",
                );
              return storage.clearLargeFiles({
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
        "clear-archived-files": cliCommand({
          summary:
            "Clear all stored files from archived, stopped, unpinned threads on a machine",
          options: { machine: MACHINE, yes: YES },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Pass --yes to permanently clear archived thread files.",
                );
              return storage.clearArchivedFiles({
                hostId: required(input.options.machine, "machine"),
              });
            }),
        }),
        "remove-dev-instances": cliCommand({
          summary:
            "Remove ~/.bb-dev instances whose source checkout no longer exists, stopping servers still running from them",
          options: {
            machine: MACHINE,
            instance: {
              type: "string",
              description:
                "Remove only this ~/.bb-dev entry, stopping its dev server first if it is running (default: every instance with a missing checkout)",
            },
            yes: YES,
          },
          run: (input) =>
            output(async () => {
              if (!input.options.yes)
                throw new Error(
                  "Pass --yes to stop their servers and permanently remove development instance data.",
                );
              return storage.removeDevInstances({
                hostId: required(input.options.machine, "machine"),
                ...(input.options.instance === undefined
                  ? { names: null }
                  : { names: [input.options.instance], stopRunning: true }),
              });
            }),
        }),
      },
    }),
  );
}
