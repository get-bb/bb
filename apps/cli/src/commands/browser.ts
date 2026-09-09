import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import type {
  ExperimentalDesktopBrowserImportOutcome,
  ExperimentalDesktopBrowserImportSources,
  ExperimentalDesktopBrowserScope,
} from "@bb/sdk";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  desktopBrowserImportSourceIdSchema,
} from "@bb/host-daemon-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";

interface ScopeOptions {
  json?: boolean;
  host: string;
  instance: string;
  generation: string;
  thread: string;
}
function scope(options: ScopeOptions): ExperimentalDesktopBrowserScope {
  return {
    hostId: options.host,
    instanceId: options.instance,
    generation: options.generation,
    threadId: options.thread,
  };
}
interface InstanceOptions {
  json?: boolean;
  host: string;
  instance: string;
  generation: string;
}
function instanceScoped(command: Command) {
  return command
    .requiredOption("--host <id>", "Browser host ID")
    .requiredOption("--instance <id>", "Desktop window instance ID")
    .requiredOption("--generation <id>", "Desktop connection generation")
    .option("--json", "Print machine-readable JSON output");
}
function parseImportTarget(
  value: string | undefined,
): { kind: "personal" } | { kind: "automation"; id: string } {
  if (value === undefined || value === "personal") return { kind: "personal" };
  const match = /^automation:(.+)$/.exec(value);
  if (!match) {
    throw new Error(
      "Expected --into personal or --into automation:<profile-id>",
    );
  }
  return { kind: "automation", id: match[1] };
}
export function formatImportSources(
  result: ExperimentalDesktopBrowserImportSources,
): string {
  const lines = result.sources.map((source) => {
    const status = source.unavailable ?? "ready";
    const profiles = source.profiles
      .map((profile) =>
        profile.cookieCount === undefined
          ? profile.name
          : `${profile.name} (${profile.cookieCount})`,
      )
      .join(", ");
    return `${source.id}  ${status}  ${profiles}`.trimEnd();
  });
  return lines.join("\n") || "No importable browsers found";
}
export function formatImportOutcome(
  outcome: ExperimentalDesktopBrowserImportOutcome,
): string {
  if (!outcome.ok)
    return `Import failed: ${DESKTOP_BROWSER_IMPORT_FAILURE_COPY[outcome.reason]}`;
  const skipped =
    outcome.skipped > 0
      ? `, skipped ${outcome.skipped}${
          outcome.skippedDomains.length > 0
            ? ` (${outcome.skippedDomains.join(", ")})`
            : ""
        }`
      : "";
  return `Imported ${outcome.imported} cookies${skipped}`;
}
function scoped(command: Command) {
  return command
    .requiredOption("--host <id>", "Browser host ID")
    .requiredOption("--instance <id>", "Desktop window instance ID")
    .requiredOption("--generation <id>", "Desktop connection generation")
    .requiredOption("--thread <id>", "Owning thread ID")
    .option("--json", "Print machine-readable JSON output");
}
function print(value: object, options: { json?: boolean }, summary: string) {
  console.log(options.json ? JSON.stringify(value) : summary);
}

export function registerBrowserCommands(
  program: Command,
  getUrl: () => string,
) {
  const browser = program
    .command("browser")
    .description("Experimental built-in desktop browser control");
  const api = () => createCliBbSdk(getUrl()).experimental_desktopBrowsers;
  browser
    .command("instances")
    .description("List connected desktop windows on a host")
    .requiredOption("--host <id>", "Browser host ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: { host: string; json?: boolean }) => {
        const result = await api().listInstances({ hostId: options.host });
        print(
          result,
          options,
          result.instances
            .map(
              (instance) =>
                `${instance.instanceId}  ${instance.generation}  ${instance.label}`,
            )
            .join("\n") || "No connected desktop windows",
        );
      }),
    );
  scoped(
    browser.command("tabs").description("List a thread's native browser tabs"),
  ).action(
    action(async (options: ScopeOptions) => {
      const result = await api().listTabs(scope(options));
      print(
        result,
        options,
        result.tabs
          .map(
            (tab) =>
              `${tab.tabId}  ${tab.title || tab.url}  ${tab.control?.controllerLabel ?? "Available"}`,
          )
          .join("\n") || "No browser tabs in this thread",
      );
    }),
  );
  scoped(
    browser
      .command("create")
      .description("Create a tab with a separate automation profile"),
  )
    .option("--url <url>", "Initial HTTP(S) URL; defaults to about:blank")
    .option("--reveal", "Show the new native tab")
    .action(
      action(
        async (options: ScopeOptions & { url?: string; reveal?: boolean }) => {
          const result = await api().createTab({
            ...scope(options),
            ...(options.url === undefined ? {} : { url: options.url }),
            ...(options.reveal ? { presentation: "reveal" } : {}),
          });
          print(result, options, `Created tab ${result.tab.tabId}`);
        },
      ),
    );
  scoped(
    browser
      .command("acquire <tabIds...>")
      .description("Acquire exclusive, expiring control of selected tabs"),
  )
    .requiredOption("--controller <label>", "Visible controller name")
    .option(
      "--ttl-ms <ms>",
      "Lease duration; defaults to five minutes, maximum thirty",
    )
    .option(
      "--allow-personal",
      "Explicitly hand off an existing personal browser profile",
    )
    .action(
      action(
        async (
          tabIds: string[],
          options: ScopeOptions & {
            controller: string;
            ttlMs?: string;
            allowPersonal?: boolean;
          },
        ) => {
          const result = await api().acquireControl({
            ...scope(options),
            tabIds,
            controllerLabel: options.controller,
            ...(options.ttlMs === undefined
              ? {}
              : { ttlMs: Number(options.ttlMs) }),
            ...(options.allowPersonal ? { allowPersonal: true } : {}),
          });
          print(
            result,
            options,
            `Control lease ${result.leaseId} expires ${new Date(result.expiresAt).toISOString()}`,
          );
        },
      ),
    );
  scoped(
    browser
      .command("connection <leaseId>")
      .description("Write private CDP connection JSON to a new local file"),
  )
    .requiredOption(
      "--output <file>",
      "New credential file (mode 0600); endpoint works only on browser host",
    )
    .action(
      action(
        async (leaseId: string, options: ScopeOptions & { output: string }) => {
          const connection = await api().openConnection({
            ...scope(options),
            leaseId,
          });
          await writeFile(options.output, JSON.stringify(connection), {
            mode: 0o600,
            flag: "wx",
          });
          print(
            {
              path: options.output,
              hostId: connection.hostId,
              expiresAt: connection.expiresAt,
            },
            options,
            `Wrote private connection to ${options.output}`,
          );
        },
      ),
    );
  scoped(
    browser
      .command("release <leaseId>")
      .description("Stop automation and keep tabs open"),
  ).action(
    action(async (leaseId: string, options: ScopeOptions) => {
      print(
        await api().releaseControl({ ...scope(options), leaseId }),
        options,
        "Released browser control",
      );
    }),
  );
  for (const name of ["reveal", "close"] as const) {
    scoped(
      browser
        .command(`${name} <tabId>`)
        .description(
          name === "close"
            ? "Close a native tab"
            : "Reveal a native tab in its desktop window",
        ),
    ).action(
      action(async (tabId: string, options: ScopeOptions) => {
        const input = { ...scope(options), tabId };
        print(
          await (name === "close"
            ? api().closeTab(input)
            : api().revealTab(input)),
          options,
          `${name === "close" ? "Closed" : "Revealed"} tab ${tabId}`,
        );
      }),
    );
  }
  scoped(
    browser
      .command("capture <tabId>")
      .description("Save a native tab screenshot without focusing it"),
  )
    .requiredOption("--output <file>", "New local JPEG file")
    .action(
      action(
        async (tabId: string, options: ScopeOptions & { output: string }) => {
          const capture = await api().captureTab({ ...scope(options), tabId });
          await writeFile(
            options.output,
            Buffer.from(capture.base64, "base64"),
            { flag: "wx", mode: 0o600 },
          );
          print(
            { path: options.output, mimeType: capture.mimeType },
            options,
            `Saved screenshot to ${options.output}`,
          );
        },
      ),
    );
  instanceScoped(
    browser
      .command("import-sources")
      .description(
        "List browsers on the desktop host whose cookies can be imported",
      ),
  ).action(
    action(async (options: InstanceOptions) => {
      const result = await api().listImportSources({
        hostId: options.host,
        instanceId: options.instance,
        generation: options.generation,
      });
      print(result, options, formatImportSources(result));
    }),
  );
  instanceScoped(
    browser
      .command("import-cookies")
      .description(
        "Copy signed-in cookies from an installed browser into the BB browser",
      ),
  )
    .requiredOption(
      "--from <source>",
      "Source browser ID from `bb browser import-sources`",
    )
    .requiredOption(
      "--profile <directory>",
      "Source profile directory as listed by `bb browser import-sources`",
    )
    .option(
      "--into <target>",
      "Target profile: personal (default) or automation:<profile-id>",
    )
    .action(
      action(
        async (
          options: InstanceOptions & {
            from: string;
            profile: string;
            into?: string;
          },
        ) => {
          const outcome = await api().importCookies({
            hostId: options.host,
            instanceId: options.instance,
            generation: options.generation,
            sourceId: desktopBrowserImportSourceIdSchema.parse(options.from),
            sourceProfileDirectory: options.profile,
            profile: parseImportTarget(options.into),
          });
          print(outcome, options, formatImportOutcome(outcome));
          if (!outcome.ok) process.exitCode = 1;
        },
      ),
    );
  scoped(
    browser
      .command("watch")
      .description(
        "Print changed tab snapshots every two seconds until interrupted",
      ),
  ).action(
    action(async (options: ScopeOptions) => {
      await new Promise<void>((resolve, reject) => {
        const subscription = api().subscribe({
          ...scope(options),
          onChange: (result) =>
            print(
              result,
              options,
              result.tabs
                .map(
                  (tab) =>
                    `${tab.tabId}  ${tab.title || tab.url}  ${tab.control?.controllerLabel ?? "Available"}`,
                )
                .join("\n") || "No browser tabs in this thread",
            ),
          onError(error) {
            cleanup();
            reject(error);
          },
        });
        const stop = () => {
          cleanup();
          resolve();
        };
        function cleanup() {
          subscription.dispose();
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
        }
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
      });
    }),
  );
}
