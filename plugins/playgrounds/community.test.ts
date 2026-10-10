import { createHash } from "node:crypto";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { afterEach, expect, it } from "vitest";
import { createPlugin } from "./server.js";
import { stepper } from "./examples.js";
import { PACKAGE_FORMAT } from "./app-package.js";
import { CATALOG_FORMAT, type CatalogIndex } from "./catalog-format.js";
import type { Fetcher } from "./catalog.js";

const BASE = "https://catalog.example.org/playgrounds/";
const sha = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

function makePackage(
  version: string,
  html = stepper.html,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    format: PACKAGE_FORMAT,
    version,
    title: "Pocket synth",
    summary: "Two oscillators and a filter",
    content: {
      kind: "html",
      playground: { ...stepper, title: "Pocket synth", html },
    },
    actions: {
      mode: "documented",
      purpose: "Play notes.",
      actions: [
        {
          name: "note",
          description: "Play one note",
          args: [{ type: "string" }],
        },
      ],
    },
    requires: { renderer: 1 },
    author: { name: "Example author" },
    license: "MIT",
    ...extra,
  });
}

const REPO = "https://catalog.example.org/repo/";
const commitOf = (n: number) =>
  createHash("sha1").update(`r${n}`).digest("hex");

class FakeCatalog {
  files = new Map<string, string>();
  commits = new Map<string, Map<string, string>>();
  packages = `${REPO}{revision}/`;
  offline = false;
  requests: string[] = [];
  revision = 0;
  apps: CatalogIndex["apps"] = [];
  contributing = "https://github.com/example/catalog/blob/main/CONTRIBUTING.md";
  publish(
    id: string,
    version: string,
    text: string,
    notes?: string,
    digest = sha(text),
  ) {
    const path = `apps/${id}/${version}.json`;
    this.files.set(path, text);
    let app = this.apps.find((a) => a.id === id);
    if (!app) {
      app = {
        id,
        title: "Pocket synth",
        summary: "Two oscillators and a filter",
        author: { name: "Example author" },
        license: "MIT",
        agentActions: "documented",
        versions: [],
      };
      this.apps.push(app);
    }
    app.versions = [
      ...app.versions.filter((v) => v.version !== version),
      {
        version,
        path,
        digest,
        bytes: Buffer.byteLength(text),
        ...(notes ? { notes } : {}),
      },
    ];
    this.revision += 1;
  }
  index(): string {
    const commit = commitOf(this.revision);
    if (!this.commits.has(commit))
      this.commits.set(commit, new Map(this.files));
    return JSON.stringify({
      format: CATALOG_FORMAT,
      revision: commit,
      packages: this.packages,
      contributing: this.contributing,
      apps: this.apps,
    });
  }
  fetcher: Fetcher = async (url, init) => {
    this.requests.push(url);
    if (this.offline) throw new Error("getaddrinfo ENOTFOUND");
    if (url === `${BASE}index.json`) {
      const body = this.index();
      const etag = `"${sha(body)}"`;
      const headers = init.headers as Record<string, string>;
      if (headers["if-none-match"] === etag)
        return new Response(null, { status: 304 });
      return new Response(body, { headers: { etag } });
    }
    if (!url.startsWith(REPO)) return new Response("missing", { status: 404 });
    const [commit = "", ...rest] = url.slice(REPO.length).split("/");
    const path = rest.join("/");
    if (path === "apps/redirect.json")
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/x.json" },
      });
    const file = this.commits.get(commit)?.get(path);
    return file === undefined
      ? new Response("missing", { status: 404 })
      : new Response(file);
  };
}

type Host = ReturnType<typeof createFakePluginHost>;
const hosts: Host[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.harness.lifecycle.dispose();
});
async function server(catalog: FakeCatalog | null, address = "93.184.216.34") {
  const host = createFakePluginHost({
    pluginId: "playgrounds",
    ...(catalog ? { settings: { catalogUrl: `${BASE}index.json` } } : {}),
    sdk: {
      threads: {
        get: (async ({ threadId }: { threadId: string }) =>
          makeThreadResponse({ id: threadId })) as never,
      },
    },
  });
  createPlugin({
    ...(catalog ? { fetcher: catalog.fetcher } : {}),
    lookup: async () => [{ address, family: 4 }],
  })(host.bb);
  hosts.push(host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return host;
}

it("explains an unconfigured catalog honestly without inventing listings", async () => {
  const host = await server(null);
  expect(
    await host.harness.behavior.callRpc("communityList", {
      refreshIfStale: true,
    }),
  ).toMatchObject({ configured: false, apps: [] });
  expect(
    (await host.harness.behavior.runCli(["community", "list"])).stdout,
  ).toContain("No Community catalog is configured");
});

it("installs the same verified package on two servers with separate state, keeps the last good catalog offline, and offers updates", async () => {
  const catalog = new FakeCatalog();
  catalog.publish("example/pocket-synth", "1.0.0", makePackage("1.0.0"));
  const one = await server(catalog);
  const two = await server(catalog);
  for (const host of [one, two])
    await host.harness.behavior.callRpc("communityRefresh", {});
  const listed = (await one.harness.behavior.callRpc("communityList", {})) as {
    apps: { id: string; latest: { version: string } }[];
  };
  expect(listed.apps).toMatchObject([
    { id: "example/pocket-synth", latest: { version: "1.0.0" } },
  ]);
  expect(
    catalog.requests.some(
      (u) => u.endsWith(".json") && !u.endsWith("index.json"),
    ),
  ).toBe(false);

  const added = await Promise.all(
    [one, two].map(
      (host) =>
        host.harness.behavior.callRpc("communityAdd", {
          catalogId: "example/pocket-synth",
        }) as Promise<{ appId: string }>,
    ),
  );
  const digests = await Promise.all(
    [one, two].map(
      async (host, i) =>
        (
          (await host.harness.behavior.callRpc("appsExport", {
            appId: added[i]!.appId,
          })) as { digest: string }
        ).digest,
    ),
  );
  expect(digests[0]).toBe(digests[1]);
  expect(digests[0]).toBe(sha(makePackage("1.0.0")));
  expect(
    await one.harness.behavior.callRpc("communityAdd", {
      catalogId: "example/pocket-synth",
    }),
  ).toMatchObject({ appId: added[0]!.appId, added: false });

  const runs = await Promise.all(
    [one, two].map(
      (host, i) =>
        host.harness.behavior.callRpc("appsOpen", {
          appId: added[i]!.appId,
          threadId: "thr_a",
          fresh: false,
        }) as Promise<{ runId: string }>,
    ),
  );
  await one.harness.behavior.callRpc("setState", {
    id: runs[0]!.runId,
    threadId: "thr_a",
    clientId: "client-one-123",
    state: { preset: "Lead" },
  });
  expect(
    await two.harness.behavior.callRpc("getState", {
      id: runs[1]!.runId,
      threadId: "thr_a",
    }),
  ).toMatchObject({ state: null });

  catalog.offline = true;
  const offline = (await one.harness.behavior.callRpc(
    "communityRefresh",
    {},
  )) as { error: string };
  expect(offline.error).toContain("ENOTFOUND");
  expect(await one.harness.behavior.callRpc("communityList", {})).toMatchObject(
    { apps: [{ id: "example/pocket-synth" }] },
  );
  expect(
    await one.harness.behavior.callRpc("get", {
      id: runs[0]!.runId,
      threadId: "thr_a",
    }),
  ).toMatchObject({ kind: "html" });
  catalog.offline = false;

  catalog.publish(
    "example/pocket-synth",
    "1.1.0",
    makePackage("1.1.0", `${stepper.html}<p>v2</p>`),
    "Adds a pad preset",
  );
  await one.harness.behavior.callRpc("communityRefresh", {});
  expect(await one.harness.behavior.callRpc("communityList", {})).toMatchObject(
    {
      apps: [
        {
          updateAvailable: true,
          latest: { version: "1.1.0", notes: "Adds a pad preset" },
          installed: { selected: "1.0.0" },
        },
      ],
    },
  );
  await one.harness.behavior.callRpc("communityAdd", {
    catalogId: "example/pocket-synth",
    version: "1.1.0",
  });
  expect(
    await one.harness.behavior.callRpc("appsOpen", {
      appId: added[0]!.appId,
      threadId: "thr_a",
      fresh: false,
    }),
  ).toMatchObject({
    runId: runs[0]!.runId,
    versionLabel: "1.0.0",
    selectedVersionLabel: "1.1.0",
  });
  expect(
    await one.harness.behavior.callRpc("getState", {
      id: runs[0]!.runId,
      threadId: "thr_a",
    }),
  ).toMatchObject({ state: { preset: "Lead" } });
  await expect(
    one.harness.behavior.callRpc("appsCreateVersion", {
      appId: added[0]!.appId,
      expectedRevision: 1,
      packageText: makePackage("9.0.0"),
    }),
  ).rejects.toThrow("Remix");
  expect(
    await one.harness.behavior
      .callRpc("draftOpen", { appId: added[0]!.appId })
      .catch((e: Error) => e.message),
  ).toContain("Remix");
});

it("refuses tampered, oversized, unsupported, changed, and redirected packages before anything runs", async () => {
  const catalog = new FakeCatalog();
  const good = makePackage("1.0.0");
  catalog.publish("example/good", "1.0.0", good);
  catalog.publish("example/tampered", "1.0.0", good, undefined, "0".repeat(64));
  catalog.publish(
    "example/future",
    "1.0.0",
    makePackage("1.0.0", stepper.html, { requires: { renderer: 3 } }),
  );
  catalog.publish("example/oversized", "1.0.0", good);
  catalog.apps.find((a) => a.id === "example/oversized")!.versions[0]!.bytes =
    10;
  catalog.publish("example/redirect", "1.0.0", good);
  catalog.apps.find((a) => a.id === "example/redirect")!.versions[0]!.path =
    "apps/redirect.json";
  const host = await server(catalog);
  const { callRpc } = host.harness.behavior;
  await callRpc("communityRefresh", {});
  const installed = (await callRpc("communityAdd", {
    catalogId: "example/good",
  })) as { appId: string };
  await expect(
    callRpc("communityAdd", { catalogId: "example/tampered" }),
  ).rejects.toThrow("digest");
  await expect(
    callRpc("communityAdd", { catalogId: "example/future" }),
  ).rejects.toThrow("newer Playgrounds renderer");
  await expect(
    callRpc("communityAdd", { catalogId: "example/oversized" }),
  ).rejects.toThrow();
  await expect(
    callRpc("communityAdd", { catalogId: "example/redirect" }),
  ).rejects.toThrow("outside");
  expect(await callRpc("appsList", {})).toHaveLength(1);

  catalog.publish(
    "example/good",
    "1.0.0",
    makePackage("1.0.0", "<p>swapped</p>"),
  );
  await callRpc("communityRefresh", {});
  expect(await callRpc("communityList", {})).toMatchObject({
    apps: expect.arrayContaining([
      expect.objectContaining({
        id: "example/good",
        versions: [
          expect.objectContaining({ version: "1.0.0", changed: true }),
        ],
      }),
    ]),
  });
  await expect(
    callRpc("communityAdd", { catalogId: "example/good", version: "1.0.0" }),
  ).rejects.toThrow("changed");
  expect(
    (
      (await callRpc("appsExport", { appId: installed.appId })) as {
        digest: string;
      }
    ).digest,
  ).toBe(sha(good));

  catalog.apps.find((a) => a.id === "example/good")!.delisted = true;
  catalog.revision += 1;
  await callRpc("communityRefresh", {});
  expect(await callRpc("communityList", {})).toMatchObject({
    apps: expect.arrayContaining([
      expect.objectContaining({
        id: "example/good",
        installed: expect.objectContaining({ selectedDelisted: true }),
      }),
    ]),
  });

  catalog.packages = "https://evil.example.com/{revision}/";
  catalog.revision += 1;
  expect(await callRpc("communityRefresh", {})).toMatchObject({
    error: expect.stringContaining("share its origin"),
  });
  catalog.packages = `${REPO}{revision}/`;

  const local = await server(catalog, "127.0.0.1");
  expect(
    await local.harness.behavior.callRpc("communityRefresh", {}),
  ).toMatchObject({ error: expect.stringContaining("private") });
});

it("lets an author develop, preview, and release updates to the same listing while other users keep their runs", async () => {
  const catalog = new FakeCatalog();
  const author = await server(catalog);
  const other = await server(catalog);
  const { callRpc, runCli } = author.harness.behavior;
  await callRpc("communityRefresh", {});
  const published = /id="([^"]+)"/.exec(
    (
      await runCli([
        "publish",
        "--thread",
        "thr_a",
        "--playground",
        JSON.stringify(stepper),
      ])
    ).stdout!,
  )![1]!;
  const { appId } = (await callRpc("appsSave", {
    answerId: published,
    threadId: "thr_a",
    name: "Pocket synth",
  })) as { appId: string };

  let draft = (await callRpc("draftOpen", { appId })) as { revision: number };
  await expect(
    callRpc("releasePrepare", {
      appId,
      changelog: "First",
      catalogId: "example/pocket-synth",
      author: { name: "Example author" },
      license: "MIT",
      reviewed: true,
    }),
  ).rejects.toThrow("document their agent actions");
  draft = (await callRpc("draftWrite", {
    appId,
    expectedRevision: draft.revision,
    edit: {
      actionsJson: JSON.stringify({
        mode: "documented",
        purpose: "Step through.",
        actions: [{ name: "next", description: "Next step", args: [] }],
      }),
    },
  })) as { revision: number };
  await expect(
    callRpc("releasePrepare", {
      appId,
      changelog: "First",
      catalogId: "example/pocket-synth",
      license: "MIT",
      reviewed: false,
    }),
  ).rejects.toThrow("Review");
  const v1 = (await callRpc("releasePrepare", {
    appId,
    expectedDraftRevision: draft.revision,
    changelog: "First release",
    catalogId: "example/pocket-synth",
    author: { name: "Example author" },
    license: "MIT",
    reviewed: true,
  })) as { releaseId: string };
  const shown = (await callRpc("releaseShow", { releaseId: v1.releaseId })) as {
    version: string;
    status: string;
    ready: boolean;
    kind: string;
    files: { path: string; sha256: string }[];
    catalogEntry: { versions: { version: string }[] };
    agentRequest: string;
  };
  expect(shown).toMatchObject({
    version: "1.0.0",
    status: "prepared",
    ready: true,
    kind: "initial",
    files: [{ path: "apps/example/pocket-synth/1.0.0.json" }],
  });
  expect(shown.agentRequest).toContain(
    `bb playgrounds apps release package ${v1.releaseId}`,
  );
  await callRpc("releaseSubmitted", {
    releaseId: v1.releaseId,
    prUrl: "https://github.com/example/catalog/pull/1",
  });
  const v1Package = (await callRpc("releasePackage", {
    releaseId: v1.releaseId,
  })) as { text: string; digest: string };
  expect(sha(v1Package.text)).toBe(shown.files[0]!.sha256);
  catalog.publish(
    "example/pocket-synth",
    "1.0.0",
    v1Package.text,
    "First release",
  );
  await callRpc("communityRefresh", {});
  expect(await callRpc("releaseList", { appId })).toMatchObject([
    { status: "published", prUrl: "https://github.com/example/catalog/pull/1" },
  ]);

  const importedCopy = (await callRpc("appsImport", {
    text: v1Package.text,
  })) as { appId: string };
  await callRpc("draftOpen", { appId: importedCopy.appId });
  await expect(
    callRpc("releasePrepare", {
      appId: importedCopy.appId,
      changelog: "Mine",
      catalogId: "example/pocket-synth",
      reviewed: true,
    }),
  ).rejects.toThrow("already taken");
  await expect(
    callRpc("releaseRecover", {
      appId: importedCopy.appId,
      catalogId: "example/pocket-synth",
      prUrl: "https://github.com/example/catalog/pull/1",
    }),
  ).rejects.toThrow("Another app");

  const restored = await server(catalog);
  await restored.harness.behavior.callRpc("communityRefresh", {});
  const unrelated = (await restored.harness.behavior.callRpc("appsImport", {
    text: makePackage("1.0.0"),
  })) as { appId: string };
  await expect(
    restored.harness.behavior.callRpc("releaseRecover", {
      appId: unrelated.appId,
      catalogId: "example/pocket-synth",
      prUrl: "https://github.com/example/catalog/pull/1",
    }),
  ).rejects.toThrow("exactly the bytes");
  const backup = (await restored.harness.behavior.callRpc("appsImport", {
    text: v1Package.text,
  })) as { appId: string };
  expect(
    await restored.harness.behavior.callRpc("releaseRecover", {
      appId: backup.appId,
      catalogId: "example/pocket-synth",
      prUrl: "https://github.com/example/catalog/pull/1",
    }),
  ).toMatchObject({ publishedVersion: "1.0.0" });
  expect(
    await restored.harness.behavior.callRpc("draftOpen", {
      appId: backup.appId,
    }),
  ).toMatchObject({
    catalogId: "example/pocket-synth",
    publishedVersion: "1.0.0",
  });
  expect(
    await restored.harness.behavior.callRpc("releaseList", {
      appId: backup.appId,
    }),
  ).toMatchObject([{ status: "published", version: "1.0.0" }]);

  await other.harness.behavior.callRpc("communityRefresh", {});
  const installed = (await other.harness.behavior.callRpc("communityAdd", {
    catalogId: "example/pocket-synth",
  })) as { appId: string };
  const otherRun = (await other.harness.behavior.callRpc("appsOpen", {
    appId: installed.appId,
    threadId: "thr_z",
    fresh: false,
  })) as { runId: string };
  await other.harness.behavior.callRpc("setState", {
    id: otherRun.runId,
    threadId: "thr_z",
    clientId: "client-one-123",
    state: { step: 2 },
  });

  draft = (await callRpc("draftGet", { appId })) as { revision: number };
  const agentEdit = /id="([^"]+)"/.exec(
    (
      await runCli([
        "publish",
        "--thread",
        "thr_a",
        "--playground",
        JSON.stringify({
          ...stepper,
          html: `${stepper.html}<p>Water well.</p>`,
        }),
      ])
    ).stdout!,
  )![1]!;
  const edited = await runCli(
    [
      "apps",
      "draft",
      "set",
      appId,
      "--revision",
      String(draft.revision),
      "--from-playground",
      agentEdit,
    ],
    { threadId: "thr_a" },
  );
  expect(edited.exitCode).toBe(0);
  expect(JSON.parse(edited.stdout!)).not.toHaveProperty("package");
  const stale = await runCli(
    [
      "apps",
      "draft",
      "set",
      appId,
      "--revision",
      String(draft.revision),
      "--title",
      "Other",
    ],
    { threadId: "thr_a" },
  );
  expect(stale.stderr).toContain("changed since");
  draft = (await callRpc("draftWrite", {
    appId,
    expectedRevision: draft.revision + 1,
    edit: { summary: "Now with watering" },
  })) as { revision: number };
  const reloaded = (await callRpc("draftGet", { appId })) as {
    revision: number;
    diff: string;
    catalogId: string;
    package: { summary: string };
  };
  expect(reloaded).toMatchObject({
    revision: draft.revision,
    catalogId: "example/pocket-synth",
    package: { summary: "Now with watering" },
  });
  expect(reloaded.diff).toMatch(/^\+ .*<p>Water well\.<\/p>/m);

  const preview = (await callRpc("draftPreview", {
    appId,
    threadId: "thr_a",
  })) as { runId: string; preview: boolean };
  expect(preview.preview).toBe(true);
  expect(
    await callRpc("appsRunInfo", { runId: preview.runId, threadId: "thr_a" }),
  ).toMatchObject({ preview: true });
  expect(
    (
      (await callRpc("appsOpen", {
        appId,
        threadId: "thr_a",
        fresh: false,
      })) as { runId: string }
    ).runId,
  ).not.toBe(preview.runId);

  const v2 = (await callRpc("releasePrepare", {
    appId,
    expectedDraftRevision: draft.revision,
    changelog: "Adds watering",
    reviewed: true,
  })) as { releaseId: string };
  const v2View = (await callRpc("releaseShow", {
    releaseId: v2.releaseId,
  })) as {
    version: string;
    kind: string;
    diff: string;
    diffBase: string;
    prUrl: string | null;
  };
  expect(v2View).toMatchObject({
    version: "1.1.0",
    kind: "update",
    diffBase: "1.0.0",
    prUrl: null,
  });
  expect(v2View.diff).toContain("Water well");
  await callRpc("releaseSubmitted", {
    releaseId: v2.releaseId,
    prUrl: "https://github.com/example/catalog/pull/2",
  });
  draft = (await callRpc("draftWrite", {
    appId,
    expectedRevision: draft.revision,
    edit: { summary: "Watering, fixed" },
  })) as { revision: number };
  const v3 = (await callRpc("releasePrepare", {
    appId,
    changelog: "Fix typo",
    reviewed: true,
  })) as { releaseId: string };
  expect(
    await callRpc("releaseShow", { releaseId: v3.releaseId }),
  ).toMatchObject({
    version: "1.2.0",
    prUrl: "https://github.com/example/catalog/pull/2",
    status: "prepared",
  });
  await expect(
    callRpc("releaseSubmitted", {
      releaseId: v3.releaseId,
      prUrl: "https://github.com/example/catalog/pull/3",
    }),
  ).rejects.toThrow("already associated");
  await expect(
    callRpc("releasePrepare", {
      appId,
      version: "1.2.0",
      changelog: "Again",
      reviewed: true,
    }),
  ).rejects.toThrow("already exists");

  catalog.revision += 1;
  await callRpc("communityRefresh", {});
  expect(
    await callRpc("releaseShow", { releaseId: v3.releaseId }),
  ).toMatchObject({ ready: false, catalogMoved: true });
  expect(
    await callRpc("releaseRefresh", { releaseId: v3.releaseId }),
  ).toMatchObject({ ready: true, catalogMoved: false });

  const v3Package = (await callRpc("releasePackage", {
    releaseId: v3.releaseId,
  })) as { text: string };
  catalog.publish("example/pocket-synth", "1.2.0", v3Package.text, "Fix typo");
  await callRpc("communityRefresh", {});
  expect(
    await callRpc("releaseShow", { releaseId: v3.releaseId }),
  ).toMatchObject({ status: "published" });
  await other.harness.behavior.callRpc("communityRefresh", {});
  const otherList = (await other.harness.behavior.callRpc(
    "communityList",
    {},
  )) as {
    apps: {
      id: string;
      updateAvailable: boolean;
      latest: { version: string };
    }[];
  };
  expect(otherList.apps).toHaveLength(1);
  expect(otherList.apps[0]).toMatchObject({
    updateAvailable: true,
    latest: { version: "1.2.0" },
  });
  await other.harness.behavior.callRpc("communityAdd", {
    catalogId: "example/pocket-synth",
  });
  expect(
    await other.harness.behavior.callRpc("getState", {
      id: otherRun.runId,
      threadId: "thr_z",
    }),
  ).toMatchObject({ state: { step: 2 } });
  expect(
    await other.harness.behavior.callRpc("appsRunInfo", {
      runId: otherRun.runId,
      threadId: "thr_z",
    }),
  ).toMatchObject({ versionLabel: "1.0.0", selectedVersionLabel: "1.2.0" });
});
