import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPluginCommands } from "../commands/plugin.js";

const PAGE_URL =
  "https://getbb.app/marketplace/linear?utm_source=bb&utm_medium=share";

const INSTALLED = {
  id: "linear",
  source: "catalog:bb-community/linear",
  rootDir: "/plugins/linear",
  version: "1.4.2",
  provenance: "catalog",
  isOrphanedBuiltin: false,
  catalogEntryId: "linear",
  catalogMarketplaceName: "bb-community",
  marketplacePageUrl: PAGE_URL,
  publisherLabel: "BB Community",
  sourceDisplay: "BB Community · linear",
  updateState: {},
  enabled: true,
  description: "Linear issue tools",
  name: "Linear",
  screenshots: [],
  collections: [],
  icon: null,
  iconUrl: null,
  status: "running",
  statusDetail: null,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  capabilities: [],
  hasSettings: false,
  app: { hasApp: false, bundle: null },
  logoUrl: null,
  logoDarkUrl: null,
  providerIds: [],
  icons: {},
};

const LISTED = {
  entryId: "linear",
  pluginId: "linear",
  displayName: "Linear",
  description: "Linear issue tools",
  icon: null,
  iconUrl: null,
  iconTinted: false,
  screenshots: [],
  collections: [],
  source: "builtin:linear",
  repositoryUrl: null,
  marketplace: "bb-official",
  marketplaceDisplayName: "BB Official",
  publisherKey: "bb-official",
  publisherLabel: "BB Official",
  official: true,
  author: null,
  installed: false,
  installedByDefault: false,
  conflictingInstallSource: null,
  installs: null,
  compatible: true,
  incompatibleReason: null,
  marketplacePageUrl: PAGE_URL,
};

describe("bb plugin share", () => {
  let logged: string[];
  let errored: string[];

  beforeEach(() => {
    logged = [];
    errored = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errored.push(String(line));
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit:${code}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function serve(routes: { plugins: object[]; results: object[] }) {
    const telemetry: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(
          input instanceof Request ? input.url : String(input),
        ).pathname;
        if (path === "/api/v1/plugins") {
          return Response.json({ plugins: routes.plugins });
        }
        if (path === "/api/v1/plugin-catalog/search") {
          return Response.json({
            results: routes.results,
            collections: [],
            categories: [],
          });
        }
        if (path === "/api/v1/system/telemetry/events") {
          telemetry.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      }),
    );
    return telemetry;
  }

  async function share(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerPluginCommands(program, () => "http://localhost");
    await program.parseAsync(["node", "bb", "plugin", "share", ...args]);
  }

  it("prints an installed plugin's page link and records the share", async () => {
    const telemetry = serve({ plugins: [INSTALLED], results: [] });

    await share(["linear"]);

    expect(logged).toEqual([PAGE_URL]);
    expect(telemetry).toEqual([
      {
        name: "plugin_link_shared",
        properties: {
          entry_id: "linear",
          marketplace: "bb-community",
          share_method: "cli",
        },
      },
    ]);
  });

  it("shares an uninstalled official listing found in the catalog", async () => {
    const telemetry = serve({ plugins: [], results: [LISTED] });

    await share(["linear", "--json"]);

    expect(logged).toEqual([JSON.stringify({ url: PAGE_URL }, null, 2)]);
    expect(telemetry).toEqual([
      {
        name: "plugin_link_shared",
        properties: {
          entry_id: "linear",
          marketplace: "bb-official",
          share_method: "cli",
        },
      },
    ]);
  });

  it("still prints the link when the server rejects the event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        return path === "/api/v1/plugins"
          ? Response.json({ plugins: [INSTALLED] })
          : Response.json({ error: "nope" }, { status: 500 });
      }),
    );

    await share(["linear"]);

    expect(logged).toEqual([PAGE_URL]);
    expect(errored).toEqual([]);
  });

  it.each([
    {
      label: "an installed plugin with no page",
      plugins: [
        {
          ...INSTALLED,
          provenance: "direct",
          catalogEntryId: undefined,
          catalogMarketplaceName: undefined,
          source: "path:/plugins/linear",
          marketplacePageUrl: null,
        },
      ],
      results: [],
      message: '"linear" has no marketplace page to share.',
    },
    {
      label: "a plugin no catalog lists",
      plugins: [],
      results: [{ ...LISTED, official: false, marketplace: "acme" }],
      message:
        'No plugin "linear" is installed or listed in BB Official or BB Community.',
    },
  ])("exits 1 for $label without recording a share", async (scenario) => {
    const telemetry = serve(scenario);

    await expect(share(["linear"])).rejects.toThrow("process.exit:1");

    expect(errored.join("\n")).toContain(scenario.message);
    expect(logged).toEqual([]);
    expect(telemetry).toEqual([]);
  });
});
