import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  JSON_FLAG_DESCRIPTION,
  arg,
  flag,
  type CliArgs,
  type CliFlags,
  type CliValues,
} from "../cli-door.js";
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
const JSON_OPTION = { json: flag("--json", JSON_FLAG_DESCRIPTION) };

const INSTANCE_OPTIONS = {
  host: flag("--host <id>", "Browser host ID", { required: true }),
  instance: flag("--instance <id>", "Desktop window instance ID", {
    required: true,
  }),
  generation: flag("--generation <id>", "Desktop connection generation", {
    required: true,
  }),
};

const SCOPE_OPTIONS = {
  ...INSTANCE_OPTIONS,
  thread: flag("--thread <id>", "Owning thread ID", { required: true }),
};

function instance(options: {
  host: string;
  instance: string;
  generation: string;
}) {
  return {
    hostId: options.host,
    instanceId: options.instance,
    generation: options.generation,
  };
}

function scope(options: {
  host: string;
  instance: string;
  generation: string;
  thread: string;
}): ExperimentalDesktopBrowserScope {
  return { ...instance(options), threadId: options.thread };
}

function print(value: object, json: boolean, summary: string) {
  console.log(json ? JSON.stringify(value) : summary);
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

function browserCommand<Args extends CliArgs, Flags extends CliFlags>(spec: {
  path: readonly string[];
  summary: string;
  positionals?: Args;
  options: Flags;
  run(values: CliValues<Args, Flags>, client: CliClient): Promise<void>;
}): CliCommand {
  return clientCommand<Args, Flags, null>({
    ...spec,
    noJson: true,
    async run(values, client) {
      await spec.run(values, client);
      return null;
    },
    print: () => null,
  });
}

function tabCommand(name: "reveal" | "close"): CliCommand {
  return browserCommand({
    path: ["browser", name],
    summary:
      name === "close"
        ? "Close a native tab"
        : "Reveal a native tab in its desktop window",
    positionals: { tabId: arg("<tabId>") },
    options: { ...SCOPE_OPTIONS, ...JSON_OPTION },
    async run({ positionals: { tabId }, options }, client) {
      const input = { ...scope(options), tabId };
      print(
        name === "close"
          ? await client.call("desktopBrowsers.closeTab", input)
          : await client.call("desktopBrowsers.revealTab", input),
        options.json,
        `${name === "close" ? "Closed" : "Revealed"} tab ${tabId}`,
      );
    },
  });
}

export const browserCommands = [
  browserCommand({
    path: ["browser", "instances"],
    summary: "List connected desktop windows on a host",
    options: { host: INSTANCE_OPTIONS.host, ...JSON_OPTION },
    async run({ options }, client) {
      const result = await client.call("desktopBrowsers.listInstances", {
        hostId: options.host,
      });
      print(
        result,
        options.json,
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
    path: ["browser", "tabs"],
    summary: "List a thread's native browser tabs",
    options: { ...SCOPE_OPTIONS, ...JSON_OPTION },
    async run({ options }, client) {
      const result = await client.call(
        "desktopBrowsers.listTabs",
        scope(options),
      );
      print(result, options.json, describeTabs(result));
    },
  }),
  browserCommand({
    path: ["browser", "create"],
    summary: "Create a tab in the BB browser profile",
    options: {
      ...SCOPE_OPTIONS,
      ...JSON_OPTION,
      url: flag("--url <url>", "Initial HTTP(S) URL; defaults to about:blank"),
      reveal: flag("--reveal", "Show the new native tab"),
    },
    async run({ options }, client) {
      const result = await client.call("desktopBrowsers.createTab", {
        ...scope(options),
        ...(options.url === undefined ? {} : { url: options.url }),
        ...(options.reveal ? { presentation: "reveal" as const } : {}),
      });
      print(result, options.json, `Created tab ${result.tab.tabId}`);
    },
  }),
  browserCommand({
    path: ["browser", "acquire"],
    summary: "Acquire exclusive, expiring control of selected tabs",
    positionals: { tabIds: arg("<tabIds...>") },
    options: {
      ...SCOPE_OPTIONS,
      ...JSON_OPTION,
      controller: flag("--controller <label>", "Visible controller name", {
        required: true,
      }),
      ttlMs: flag(
        "--ttl-ms <ms>",
        "Lease duration; defaults to five minutes, maximum thirty",
      ),
    },
    async run({ positionals, options }, client) {
      const result = await client.call("desktopBrowsers.acquireControl", {
        ...scope(options),
        tabIds: positionals.tabIds,
        controllerLabel: options.controller,
        ...(options.ttlMs === undefined
          ? {}
          : { ttlMs: Number(options.ttlMs) }),
      });
      print(
        result,
        options.json,
        `Control lease ${result.leaseId} expires ${new Date(result.expiresAt).toISOString()}`,
      );
    },
  }),
  browserCommand({
    path: ["browser", "connection"],
    summary: "Write private CDP connection JSON to a new local file",
    positionals: { leaseId: arg("<leaseId>") },
    options: {
      ...SCOPE_OPTIONS,
      ...JSON_OPTION,
      output: flag(
        "--output <file>",
        "New credential file (mode 0600); endpoint works only on browser host",
        { required: true },
      ),
    },
    async run({ positionals, options }, client) {
      const output = options.output;
      const connection = await client.call("desktopBrowsers.openConnection", {
        ...scope(options),
        leaseId: positionals.leaseId,
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
        options.json,
        `Wrote private connection to ${output}`,
      );
    },
  }),
  browserCommand({
    path: ["browser", "release"],
    summary: "Stop automation and keep tabs open",
    positionals: { leaseId: arg("<leaseId>") },
    options: { ...SCOPE_OPTIONS, ...JSON_OPTION },
    async run({ positionals, options }, client) {
      print(
        await client.call("desktopBrowsers.releaseControl", {
          ...scope(options),
          leaseId: positionals.leaseId,
        }),
        options.json,
        "Released browser control",
      );
    },
  }),
  tabCommand("reveal"),
  tabCommand("close"),
  browserCommand({
    path: ["browser", "capture"],
    summary: "Save a native tab screenshot without focusing it",
    positionals: { tabId: arg("<tabId>") },
    options: {
      ...SCOPE_OPTIONS,
      ...JSON_OPTION,
      output: flag("--output <file>", "New local JPEG file", {
        required: true,
      }),
    },
    async run({ positionals, options }, client) {
      const output = options.output;
      const capture = await client.call("desktopBrowsers.captureTab", {
        ...scope(options),
        tabId: positionals.tabId,
      });
      await writeFile(output, Buffer.from(capture.base64, "base64"), {
        flag: "wx",
        mode: 0o600,
      });
      print(
        { path: output, mimeType: capture.mimeType },
        options.json,
        `Saved screenshot to ${output}`,
      );
    },
  }),
  browserCommand({
    path: ["browser", "import-sources"],
    summary: "List browsers on the desktop host whose cookies can be imported",
    options: { ...INSTANCE_OPTIONS, ...JSON_OPTION },
    async run({ options }, client) {
      const result = await client.call(
        "desktopBrowsers.listImportSources",
        instance(options),
      );
      print(result, options.json, formatImportSources(result));
    },
  }),
  browserCommand({
    path: ["browser", "import-cookies"],
    summary:
      "Copy signed-in cookies from an installed browser into the BB browser",
    options: {
      ...INSTANCE_OPTIONS,
      ...JSON_OPTION,
      from: flag(
        "--from <source>",
        "Source browser ID from `bb browser import-sources`",
        { required: true },
      ),
      profile: flag(
        "--profile <directory>",
        "Source profile directory as printed by `bb browser import-sources`",
        { required: true },
      ),
    },
    async run({ options }, client) {
      const outcome = await client.call("desktopBrowsers.importCookies", {
        ...instance(options),
        sourceId: desktopBrowserImportSourceIdSchema.parse(options.from),
        sourceProfileDirectory: options.profile,
      });
      print(outcome, options.json, formatImportOutcome(outcome));
      if (!outcome.ok) process.exitCode = 1;
    },
  }),
  browserCommand({
    path: ["browser", "watch"],
    summary: "Print changed tab snapshots every two seconds until interrupted",
    options: { ...SCOPE_OPTIONS, ...JSON_OPTION },
    async run({ options }, client) {
      await new Promise<void>((resolve, reject) => {
        const subscription = client
          .sdk()
          .experimental_desktopBrowsers.subscribe({
            ...scope(options),
            onChange: (result) =>
              print(result, options.json, describeTabs(result)),
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
