import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  JSON_FLAG_DESCRIPTION,
  type CliDoorOption,
  type CliDoorPositional,
  type CliValues,
  flag,
} from "@bb/operations";
import type {
  ExperimentalDesktopBrowserImportOutcome,
  ExperimentalDesktopBrowserImportSources,
  ExperimentalDesktopBrowserScope,
  ExperimentalDesktopBrowserTabs,
} from "@bb/sdk";
import {
  DESKTOP_BROWSER_IMPORT_FAILURE_COPY,
  desktopBrowserImportSourceIdSchema,
} from "@bb/host-daemon-contract";
import {
  clientCommand,
  mountCommands,
  type CliClient,
  type CliCommand,
} from "../operation-doors.js";

export function formatImportSources(
  result: ExperimentalDesktopBrowserImportSources,
): string {
  const lines = result.sources.map((source) => {
    const status = source.unavailable ?? "ready";
    const profiles = source.profiles
      .map(
        (profile) =>
          `${profile.directory}${
            profile.name === profile.directory ? "" : ` "${profile.name}"`
          }${profile.cookieCount === undefined ? "" : ` (${profile.cookieCount})`}`,
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
const JSON_OPTION: CliDoorOption = flag("--json", JSON_FLAG_DESCRIPTION);

function requiredOption(
  flag: string,
  placeholder: string,
  description: string,
): CliDoorOption {
  return { flag, type: "string", placeholder, required: true, description };
}

const INSTANCE_OPTIONS: readonly CliDoorOption[] = [
  requiredOption("host", "id", "Browser host ID"),
  requiredOption("instance", "id", "Desktop window instance ID"),
  requiredOption("generation", "id", "Desktop connection generation"),
];

const SCOPE_OPTIONS: readonly CliDoorOption[] = [
  ...INSTANCE_OPTIONS,
  requiredOption("thread", "id", "Owning thread ID"),
];

function text(values: CliValues, flag: string): string {
  const value = values.options[flag];
  return typeof value === "string" ? value : "";
}

function maybeText(values: CliValues, flag: string): string | undefined {
  const value = values.options[flag];
  return typeof value === "string" ? value : undefined;
}

function positional(values: CliValues, name: string): string {
  const value = values.positionals[name];
  return typeof value === "string" ? value : "";
}

function instance(values: CliValues) {
  return {
    hostId: text(values, "host"),
    instanceId: text(values, "instance"),
    generation: text(values, "generation"),
  };
}

function scope(values: CliValues): ExperimentalDesktopBrowserScope {
  return { ...instance(values), threadId: text(values, "thread") };
}

function print(value: object, values: CliValues, summary: string) {
  console.log(values.options.json === true ? JSON.stringify(value) : summary);
}

function describeTabs(result: ExperimentalDesktopBrowserTabs): string {
  return (
    result.tabs
      .map(
        (tab) =>
          `${tab.tabId}  ${tab.title || tab.url}  ${tab.control?.controllerLabel ?? "Available"}`,
      )
      .join("\n") || "No browser tabs in this thread"
  );
}

function browserCommand(spec: {
  name: string;
  kind: "read" | "write";
  description: string;
  path: readonly string[];
  summary: string;
  positionals?: readonly CliDoorPositional[];
  options: readonly CliDoorOption[];
  run(values: CliValues, client: CliClient): Promise<void>;
}): CliCommand {
  return clientCommand<CliValues, null>({
    name: spec.name,
    kind: spec.kind,
    description: spec.description,
    door: {
      path: spec.path,
      summary: spec.summary,
      ...(spec.positionals === undefined
        ? {}
        : { positionals: spec.positionals }),
      options: spec.options,
      noJson: true,
      prepare: (values) => values,
      async run(values, client) {
        await spec.run(values, client);
        return null;
      },
      print: () => null,
    },
  });
}

function tabCommand(name: "reveal" | "close"): CliCommand {
  return browserCommand({
    name: `cli.browser.${name}`,
    kind: "write",
    description:
      name === "close"
        ? "Close a native browser tab"
        : "Reveal a native browser tab",
    path: ["browser", name],
    summary:
      name === "close"
        ? "Close a native tab"
        : "Reveal a native tab in its desktop window",
    positionals: [{ name: "tabId" }],
    options: [...SCOPE_OPTIONS, JSON_OPTION],
    async run(values, client) {
      const tabId = positional(values, "tabId");
      const input = { ...scope(values), tabId };
      print(
        name === "close"
          ? await client.call("desktopBrowsers.closeTab", input)
          : await client.call("desktopBrowsers.revealTab", input),
        values,
        `${name === "close" ? "Closed" : "Revealed"} tab ${tabId}`,
      );
    },
  });
}

export const browserCommands = [
  browserCommand({
    name: "cli.browser.instances",
    kind: "read",
    description: "List connected desktop windows",
    path: ["browser", "instances"],
    summary: "List connected desktop windows on a host",
    options: [requiredOption("host", "id", "Browser host ID"), JSON_OPTION],
    async run(values, client) {
      const result = await client.call("desktopBrowsers.listInstances", {
        hostId: text(values, "host"),
      });
      print(
        result,
        values,
        result.instances
          .map(
            (entry) =>
              `${entry.instanceId}  ${entry.generation}  ${entry.label}`,
          )
          .join("\n") || "No connected desktop windows",
      );
    },
  }),
  browserCommand({
    name: "cli.browser.tabs",
    kind: "read",
    description: "List a thread's native browser tabs",
    path: ["browser", "tabs"],
    summary: "List a thread's native browser tabs",
    options: [...SCOPE_OPTIONS, JSON_OPTION],
    async run(values, client) {
      const result = await client.call(
        "desktopBrowsers.listTabs",
        scope(values),
      );
      print(result, values, describeTabs(result));
    },
  }),
  browserCommand({
    name: "cli.browser.create",
    kind: "write",
    description: "Create a tab in the BB browser profile",
    path: ["browser", "create"],
    summary: "Create a tab in the BB browser profile",
    options: [
      ...SCOPE_OPTIONS,
      JSON_OPTION,
      flag("--url <url>", "Initial HTTP(S) URL; defaults to about:blank"),
      flag("--reveal", "Show the new native tab"),
    ],
    async run(values, client) {
      const url = maybeText(values, "url");
      const result = await client.call("desktopBrowsers.createTab", {
        ...scope(values),
        ...(url === undefined ? {} : { url }),
        ...(values.options.reveal === true
          ? { presentation: "reveal" as const }
          : {}),
      });
      print(result, values, `Created tab ${result.tab.tabId}`);
    },
  }),
  browserCommand({
    name: "cli.browser.acquire",
    kind: "write",
    description: "Acquire an expiring control lease on browser tabs",
    path: ["browser", "acquire"],
    summary: "Acquire exclusive, expiring control of selected tabs",
    positionals: [{ name: "tabIds", variadic: true }],
    options: [
      ...SCOPE_OPTIONS,
      JSON_OPTION,
      requiredOption("controller", "label", "Visible controller name"),
      flag(
        "--ttl-ms <ms>",
        "Lease duration; defaults to five minutes, maximum thirty",
      ),
    ],
    async run(values, client) {
      const tabIds = values.positionals.tabIds;
      const ttlMs = maybeText(values, "ttl-ms");
      const result = await client.call("desktopBrowsers.acquireControl", {
        ...scope(values),
        tabIds: Array.isArray(tabIds) ? tabIds : [],
        controllerLabel: text(values, "controller"),
        ...(ttlMs === undefined ? {} : { ttlMs: Number(ttlMs) }),
      });
      print(
        result,
        values,
        `Control lease ${result.leaseId} expires ${new Date(result.expiresAt).toISOString()}`,
      );
    },
  }),
  browserCommand({
    name: "cli.browser.connection",
    kind: "write",
    description:
      "Open a private CDP connection and write it to a new local file",
    path: ["browser", "connection"],
    summary: "Write private CDP connection JSON to a new local file",
    positionals: [{ name: "leaseId" }],
    options: [
      ...SCOPE_OPTIONS,
      JSON_OPTION,
      requiredOption(
        "output",
        "file",
        "New credential file (mode 0600); endpoint works only on browser host",
      ),
    ],
    async run(values, client) {
      const output = text(values, "output");
      const connection = await client.call("desktopBrowsers.openConnection", {
        ...scope(values),
        leaseId: positional(values, "leaseId"),
      });
      await writeFile(output, JSON.stringify(connection), {
        mode: 0o600,
        flag: "wx",
      });
      print(
        {
          path: output,
          hostId: connection.hostId,
          expiresAt: connection.expiresAt,
        },
        values,
        `Wrote private connection to ${output}`,
      );
    },
  }),
  browserCommand({
    name: "cli.browser.release",
    kind: "write",
    description: "Release a browser control lease",
    path: ["browser", "release"],
    summary: "Stop automation and keep tabs open",
    positionals: [{ name: "leaseId" }],
    options: [...SCOPE_OPTIONS, JSON_OPTION],
    async run(values, client) {
      print(
        await client.call("desktopBrowsers.releaseControl", {
          ...scope(values),
          leaseId: positional(values, "leaseId"),
        }),
        values,
        "Released browser control",
      );
    },
  }),
  tabCommand("reveal"),
  tabCommand("close"),
  browserCommand({
    name: "cli.browser.capture",
    kind: "read",
    description: "Capture a native tab screenshot to a new local file",
    path: ["browser", "capture"],
    summary: "Save a native tab screenshot without focusing it",
    positionals: [{ name: "tabId" }],
    options: [
      ...SCOPE_OPTIONS,
      JSON_OPTION,
      requiredOption("output", "file", "New local JPEG file"),
    ],
    async run(values, client) {
      const output = text(values, "output");
      const capture = await client.call("desktopBrowsers.captureTab", {
        ...scope(values),
        tabId: positional(values, "tabId"),
      });
      await writeFile(output, Buffer.from(capture.base64, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
      print(
        { path: output, mimeType: capture.mimeType },
        values,
        `Saved screenshot to ${output}`,
      );
    },
  }),
  browserCommand({
    name: "cli.browser.import-sources",
    kind: "read",
    description: "List browsers whose cookies can be imported",
    path: ["browser", "import-sources"],
    summary: "List browsers on the desktop host whose cookies can be imported",
    options: [...INSTANCE_OPTIONS, JSON_OPTION],
    async run(values, client) {
      const result = await client.call(
        "desktopBrowsers.listImportSources",
        instance(values),
      );
      print(result, values, formatImportSources(result));
    },
  }),
  browserCommand({
    name: "cli.browser.import-cookies",
    kind: "write",
    description: "Import signed-in cookies from an installed browser",
    path: ["browser", "import-cookies"],
    summary:
      "Copy signed-in cookies from an installed browser into the BB browser",
    options: [
      ...INSTANCE_OPTIONS,
      JSON_OPTION,
      requiredOption(
        "from",
        "source",
        "Source browser ID from `bb browser import-sources`",
      ),
      requiredOption(
        "profile",
        "directory",
        "Source profile directory as printed by `bb browser import-sources`",
      ),
    ],
    async run(values, client) {
      const outcome = await client.call("desktopBrowsers.importCookies", {
        ...instance(values),
        sourceId: desktopBrowserImportSourceIdSchema.parse(
          text(values, "from"),
        ),
        sourceProfileDirectory: text(values, "profile"),
      });
      print(outcome, values, formatImportOutcome(outcome));
      if (!outcome.ok) process.exitCode = 1;
    },
  }),
  browserCommand({
    name: "cli.browser.watch",
    kind: "read",
    description: "Poll a thread's browser tabs and print each change",
    path: ["browser", "watch"],
    summary: "Print changed tab snapshots every two seconds until interrupted",
    options: [...SCOPE_OPTIONS, JSON_OPTION],
    async run(values, client) {
      await new Promise<void>((resolve, reject) => {
        const subscription = client
          .sdk()
          .experimental_desktopBrowsers.subscribe({
            ...scope(values),
            onChange: (result) => print(result, values, describeTabs(result)),
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
    },
  }),
];

export function registerBrowserCommands(
  program: Command,
  getUrl: () => string,
) {
  program
    .command("browser")
    .description("Experimental built-in desktop browser control");
  mountCommands(program, browserCommands, { getUrl });
}
