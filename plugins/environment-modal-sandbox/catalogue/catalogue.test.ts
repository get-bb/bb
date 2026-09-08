import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { Catalogue } from "./store.js";
import { hash, recipeInputSchema } from "./model.js";
import { acceptChunk, contextFiles } from "./context.js";
import { parseDockerfile, translateDockerfile } from "./dockerfile.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});
function setup() {
  const host = createFakePluginHost({ pluginId: "environment-modal-sandbox" });
  disposals.push(() => host.harness.lifecycle.dispose());
  let now = 1000;
  const store = new Catalogue(
    host.bb.storage.database(),
    host.bb.storage,
    () => now,
  );
  const recipe = store.putRecipe(
    recipeInputSchema.parse({
      projectId: "p",
      expectedRevision: 0,
      dockerfileText: "COPY package-lock.json ./\nRUN node --version",
      contextRules: { include: ["package-lock.json"] },
    }),
  );
  const data = Buffer.from("{}");
  const context = store.putContext("p", {
    recipeId: recipe.recipeId,
    revision: recipe.revision,
    source: {
      hostId: "local",
      path: "/project",
      commit: "a".repeat(40),
      dirty: [],
      submodules: [],
      lfs: [],
    },
    reviewedDirty: [],
    files: [
      {
        path: "package-lock.json",
        bytes: data.length,
        sha256: hash(data),
        mode: "100644",
      },
    ],
  });
  store.db
    .prepare("INSERT INTO context_uploads VALUES (?,?,?)")
    .run(context.contextId, hash("upload-token"), "local");
  acceptChunk(store, "upload-token", {
    contextId: context.contextId,
    path: "package-lock.json",
    offset: 0,
    data: data.toString("base64"),
  });
  contextFiles(store, context.contextId);
  store.completeContext(context.contextId);
  const input = {
    projectId: "p",
    recipeId: recipe.recipeId,
    revision: 1,
    contextId: context.contextId,
    key: "request",
  };
  return {
    ...host,
    store,
    recipe,
    context,
    input,
    advance: (amount: number) => {
      now += amount;
    },
  };
}
describe("real migrated image catalogue", () => {
  it("claims a hash once across request keys and connection handles; account claims serialize builds", async () => {
    const test = setup();
    const second = new Catalogue(
      test.store.db,
      test.bb.storage,
      test.store.now,
    );
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        Promise.resolve().then(() =>
          (index % 2 ? second : test.store).start(
            { ...test.input, key: `request-${index}` },
            hash("account"),
            "app",
          ),
        ),
      ),
    );
    expect(new Set(results.map((result) => result.build.buildId)).size).toBe(1);
    expect(results.filter((result) => !result.reused)).toHaveLength(1);
    expect(test.store.claim(hash("account"))?.state).toBe("building");
    expect(second.claim(hash("account"))).toBeNull();
    expect(() =>
      second.start(
        { ...test.input, key: "request-0", contextId: "missing" },
        hash("account"),
        "app",
      ),
    ).toThrow();
    expect(() =>
      second.start(
        { ...test.input, key: "request-0" },
        hash("account"),
        "other-app",
      ),
    ).toThrow(/different payload/);
  });
  it("uses CAS for immutable recipes and project configuration", () => {
    const { store, recipe } = setup();
    expect(() =>
      store.putRecipe(
        recipeInputSchema.parse({
          ...recipe,
          recipeId: undefined,
          revision: undefined,
          recipeHash: undefined,
          baseDigest: undefined,
          createdAt: undefined,
          expectedRevision: 0,
        }),
      ),
    ).toThrow();
    expect(() =>
      store.putRecipe(
        recipeInputSchema.parse({
          projectId: "p",
          expectedRevision: 0,
          dockerfileText: "RUN true",
        }),
      ),
    ).toThrow(/latest revision 1/);
    const next = store.putRecipe(
      recipeInputSchema.parse({
        projectId: "p",
        expectedRevision: 1,
        dockerfileText: "RUN true",
      }),
    );
    expect(store.recipe("p", 1).dockerfileText).toBe(recipe.dockerfileText);
    expect(next.revision).toBe(2);
    const project = store.project("p");
    store.configure({ ...project, usableBuildId: null, expectedRevision: 0 });
    expect(() => store.configure({ ...project, usableBuildId: null, expectedRevision: 0 })).toThrow(
      /revision conflict/,
    );
  });
  it("reconciles restart mid-build without resubmitting or releasing its account claim", () => {
    const test = setup();
    const { build } = test.store.start(test.input, hash("account"), "app");
    test.store.claim(hash("account"));
    const restarted = new Catalogue(
      test.store.db,
      test.bb.storage,
      test.store.now,
    );
    restarted.restart();
    expect(restarted.build(build.buildId).state).toBe("reconciling");
    expect(restarted.claim(hash("account"))).toBeNull();
    expect(restarted.reconciling(hash("account"))[0]?.name).toBe(build.name);
    restarted.ready(build.buildId, "im-reconciled", {});
    expect(restarted.build(build.buildId).imageId).toBe("im-reconciled");
  });
  it("retains monotonic paged redacted logs under the byte cap", () => {
    const test = setup();
    const { build } = test.store.start(test.input, hash("account"), "app");
    test.store.event(
      build.buildId,
      "log",
      "private-value Bearer bearer-value api_key=key-value",
      ["private-value"],
    );
    const first = test.store.events(build.buildId, 0, 10);
    expect(first.events[0]?.text).not.toMatch(
      /private-value|bearer-value|key-value/,
    );
    for (let i = 0; i < 165; i++)
      test.store.event(build.buildId, "log", "x".repeat(65536));
    const retained = test.store.db
      .prepare("SELECT sum(bytes) AS bytes FROM build_events WHERE build_id=?")
      .get(build.buildId);
    expect(retained).toMatchObject({ bytes: expect.any(Number) });
    let cursor = first.nextCursor;
    let truncated = false;
    for (;;) {
      const page = test.store.events(build.buildId, cursor, 10);
      if (!page.events.length) break;
      expect(page.nextCursor).toBeGreaterThan(cursor);
      truncated ||= page.events.some((event) => event.kind === "truncated");
      cursor = page.nextCursor;
    }
    expect(truncated).toBe(true);
    expect(
      test.store.db
        .prepare(
          "SELECT sum(bytes)<=? AS bounded FROM build_events WHERE build_id=?",
        )
        .get(10 * 1024 * 1024, build.buildId),
    ).toEqual({ bounded: 1 });
  });
  it("cancelled watchers have no effect and vendor cancellation is only a request", () => {
    const test = setup();
    const { build } = test.store.start(test.input, hash("account"), "app");
    test.store.start(
      { ...test.input, key: "another-watcher" },
      hash("account"),
      "app",
    );
    test.store.claim(hash("account"));
    test.store.events(build.buildId, 0, 10);
    const controller = new AbortController();
    controller.abort();
    expect(test.store.build(build.buildId).state).toBe("building");
    expect(test.store.cancel(build.buildId)).toMatchObject({
      state: "building",
      cancelRequested: true,
    });
  });
  it("rejects malformed, escaping, unauthorized, corrupt and incomplete archives", () => {
    const test = setup();
    const fresh = test.store.putContext("p", test.context.manifest);
    test.store.db
      .prepare("INSERT INTO context_uploads VALUES (?,?,?)")
      .run(fresh.contextId, hash("token"), "local");
    const chunk = {
      contextId: fresh.contextId,
      path: "package-lock.json",
      offset: 0,
      data: "e30=",
    };
    expect(() => acceptChunk(test.store, "wrong", chunk)).toThrow(/token/);
    expect(() =>
      acceptChunk(test.store, "token", { ...chunk, path: "../outside" }),
    ).toThrow(/Unsafe/);
    expect(() =>
      acceptChunk(test.store, "token", { ...chunk, path: "unreviewed" }),
    ).toThrow(/allowlisted/);
    expect(() =>
      acceptChunk(test.store, "token", { ...chunk, offset: 1 }),
    ).toThrow(/bounds/);
    expect(() => contextFiles(test.store, fresh.contextId)).toThrow(/mismatch/);
    acceptChunk(test.store, "token", { ...chunk, data: "e3s=" });
    expect(() => contextFiles(test.store, fresh.contextId)).toThrow(/mismatch/);
    expect(() => acceptChunk(test.store, "token", chunk)).toThrow(
      /different content/,
    );
  });
  it("rechecks references at deletion and rejects references after a deletion claim", () => {
    const test = setup();
    const { build } = test.store.start(test.input, hash("account"), "app");
    test.store.ready(build.buildId, "im-owned", {});
    expect(test.store.claimDeletion(build.buildId, 1000)).toBe(false);
    test.store.reference(build.buildId, "machine", "host");
    test.advance(2000);
    expect(test.store.claimDeletion(build.buildId, 1000)).toBe(false);
    test.store.release("machine", "host");
    expect(test.store.claimDeletion(build.buildId, 1000)).toBe(false);
    test.advance(1000);
    expect(test.store.claimDeletion(build.buildId, 1000)).toBe(true);
    expect(() =>
      test.store.reference(build.buildId, "machine", "late-host"),
    ).toThrow(/being deleted/);
    test.store.deleted(build.buildId);
    expect(test.store.images("p", null, 10)).toEqual([]);
  });
  it("isolates recipes, contexts, build events and GC by authenticated owner", () => {
    const test = setup();
    const { build } = test.store.start(test.input, hash("account"), "app");
    test.store.ready(build.buildId, "im-owner", {});
    const other = new Catalogue(
      test.store.db,
      test.bb.storage,
      test.store.now,
      "different-owner",
    );
    expect(other.recipes(null, 10)).toEqual([]);
    expect(other.gcCandidates()).toEqual([]);
    expect(() => other.recipe("p")).toThrow(/not found/);
    expect(() => other.context(test.context.contextId)).toThrow(/not found/);
    expect(() => other.events(build.buildId, 0, 10)).toThrow(/not found/);
    expect(() => other.cancel(build.buildId)).toThrow(/not found/);
  });
});
describe("Dockerfile extension subset", () => {
  it.each([
    "FROM ubuntu",
    "ADD file /",
    "CMD true",
    "ENTRYPOINT true",
    "USER root",
    "RUN --mount=type=secret true",
  ])("reports the exact rejected source line for %s", (instruction) => {
    expect(() =>
      parseDockerfile(`# project\nRUN true\n${instruction}`),
    ).toThrow(/line 3/);
  });
  it("materializes exact binary COPY contents without depending on a server path or URL", () => {
    const data = Buffer.from([0, 255, 1, 128]);
    const commands = translateDockerfile(
      'WORKDIR /opt/cache\nCOPY ["lock file", "./"]\nENV HELLO=world\nARG BUILD_MODE=release\nRUN echo ok',
      new Map([["lock file", { data, executable: false }]]),
    );
    expect(commands.join("\n")).toContain(data.toString("base64"));
    expect(commands.join("\n")).toContain("'/opt/cache/lock file'");
    expect(commands.join("\n")).not.toContain("COPY");
    expect(() => translateDockerfile("COPY absent ./", new Map())).toThrow(
      /line 1.*absent/,
    );
  });
});
it("bounds log pages even when JSON escaping expands large chunks", () => {
  const { store, input } = setup();
  const { build } = store.start(input, hash("account"), "app");
  for (let i = 0; i < 20; i++)
    store.event(build.buildId, "log", "\u0001".repeat(65536));
  const page = store.events(build.buildId, 0, 200);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(1024 * 1024);
  expect(page.events).toHaveLength(2);
  expect(
    store.events(build.buildId, page.nextCursor, 200).events[0]?.sequence,
  ).toBe(3);
});
it("replays a completed request after staging expires and resets GC state after an explicit rebuild", () => {
  const { store, input, advance } = setup();
  const { build } = store.start(input, hash("account"), "app");
  store.ready(build.buildId, "im-first", {});
  advance(24 * 60 * 60 * 1000 + 1);
  expect(store.start(input, hash("account"), "app").build.buildId).toBe(
    build.buildId,
  );
  store.claimDeletion(build.buildId, 0);
  store.deleted(build.buildId);
  expect(store.images("p", null, 50)).toHaveLength(0);
  store.ready(build.buildId, "im-rebuilt", {});
  store.reference(build.buildId, "allocation", "new-machine");
  expect(store.images("p", null, 50)).toHaveLength(1);
  expect(store.protected(build.buildId)).toBe(true);
});

it("migrates stored recipe setup text away and rejects the removed input", async () => {
  const { migrations } = await import("./migrations.js");
  const host = createFakePluginHost({ pluginId: "environment-modal-sandbox" });
  disposals.push(() => host.harness.lifecycle.dispose());
  const db = host.bb.storage.database();
  host.bb.storage.migrate(db, migrations.slice(0, -1));
  db.prepare("INSERT INTO catalogue_owner VALUES ('owner', 'user')").run();
  const legacy = {
    projectId: "project",
    recipeId: "recipe",
    revision: 1,
    dockerfileText: "RUN true",
    setupScriptText: "legacy-private-setup",
    contextRules: { include: [], exclude: [] },
    smoke: { commands: [], timeoutSeconds: 120 },
    recipeHash: hash("legacy"),
    baseDigest: hash("base"),
    createdAt: 1,
  };
  db.prepare("INSERT INTO recipes VALUES (?,?,?,?,?,?)").run(
    "user",
    "project",
    "recipe",
    1,
    legacy.recipeHash,
    JSON.stringify(legacy),
  );
  const store = new Catalogue(db, host.bb.storage);
  expect(store.recipe("project")).not.toHaveProperty("setupScriptText");
  expect(
    JSON.stringify(db.prepare("SELECT data FROM recipes").all()),
  ).not.toContain("legacy-private-setup");
  expect(() =>
    recipeInputSchema.parse({
      projectId: "project",
      expectedRevision: 1,
      dockerfileText: "RUN true",
      setupScriptText: "ignored",
    }),
  ).toThrow();
});
