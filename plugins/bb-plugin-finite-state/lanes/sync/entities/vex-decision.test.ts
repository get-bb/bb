import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import type { Json } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import {
  canonicalFindingStableKey,
  canonicalizeFindingIdentity,
} from "../../findings/stable-key/canonical.js";
import { normalizeFinding, pullFindings } from "../../findings/cache/pull.js";
import { pull } from "../engine/pull.js";
import { status } from "../engine/status.js";
import { computePlan } from "../plan/index.js";
import type { EntityAdapter } from "../engine/adapter.js";
import { createSerializer } from "../serialize/serializer.js";
import { SerializeError } from "../serialize/yaml.js";
import {
  createVexDecisionAdapter,
  fastForwardVexWorking,
  migrateVexWorkingKeys,
  projectVexDecision,
  projectVexDecisionKey,
  readVexWorking,
  type VexRemoteRowAdvisory,
  VexWorkingReadError,
} from "./vex-decision.js";

const FIXTURE = resolve(
  import.meta.dirname,
  "../../../test/mock-remote/fixtures/platform/findings.jsonl",
);
const roots: string[] = [];
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-wp17-vex-"));
  roots.push(root);
  await mkdir(join(root, ".fs", "triage"), { recursive: true });
  return root;
}

async function firstFixtureFinding(): Promise<Record<string, Json>> {
  const findingLine = (await readFile(FIXTURE, "utf8")).split("\n", 1)[0];
  if (findingLine === undefined) throw new Error("fixture is empty");
  return JSON.parse(findingLine) as Record<string, Json>;
}

describe("vexDecision adapter", () => {
  it("projects frozen Platform fixture bytes to the canonical tuple and stable key", async () => {
    const finding = await firstFixtureFinding();
    const projected = projectVexDecision(finding);
    expect(projected).toEqual({
      key: ENTITIES.vexDecision.key({
        cve: "CVE-2020-10000",
        purl: null,
        name: "eagle-component-001",
        group: null,
        version: "1.0.0",
      }),
      remoteId: "8000000000000000000",
      payload: {
        status: "IN_TRIAGE",
        justification: null,
        response: null,
        reason: null,
      },
    });
    const component = finding["component"];
    if (
      component === null ||
      Array.isArray(component) ||
      typeof component !== "object"
    ) {
      throw new Error("finding fixture has no nested component");
    }
    expect(() =>
      projectVexDecision({
        ...finding,
        component: null,
        componentId: String(component["id"]),
      }),
    ).toThrow("Platform finding is missing canonical identity");
  });

  it("parses aggregate .fs/triage YAML into one working entity per decision", async () => {
    const root = await worktree();
    await writeFile(
      join(root, ".fs", "triage", "busybox.yaml"),
      `schema: fs-triage/v1
component:
  purl: pkg:generic/busybox@1.36.1
  name: busybox
  version: 1.36.1
decisions:
  CVE-2026-10000:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: not compiled
  CVE-2026-10001:
    status: IN_TRIAGE
    justification: null
    response: null
    reason: null
`,
      "utf8",
    );

    const working = await readVexWorking(root);
    expect(working).toHaveLength(2);
    expect(working[0]?.file).toBe(".fs/triage/busybox.yaml");
    expect(working.map((item) => item.payload)).toEqual([
      {
        status: "NOT_AFFECTED",
        justification: "CODE_NOT_PRESENT",
        response: null,
        reason: "not compiled",
      },
      {
        status: "IN_TRIAGE",
        justification: null,
        response: null,
        reason: null,
      },
    ]);
  });

  it("canonicalizes an authored wire namespace instead of breaking the working read", async () => {
    const root = await worktree();
    await writeFile(
      join(root, ".fs", "triage", "distro.yaml"),
      `schema: fs-triage/v1
component:
  purl: null
  name: debian/libxml2
  group: null
  version: "1.0.0"
decisions:
  CVE-2026-10002:
    status: IN_TRIAGE
    justification: null
    response: null
    reason: null
`,
      "utf8",
    );

    await expect(readVexWorking(root)).resolves.toEqual([
      expect.objectContaining({
        key: ENTITIES.vexDecision.key({
          cve: "CVE-2026-10002",
          purl: null,
          name: "libxml2",
          group: "debian",
          version: "1.0.0",
        }),
      }),
    ]);
  });

  it("loads only the scoped project and rejects ambiguous unscoped reads", async () => {
    const root = await worktree();
    const overlay = (project: string) => `schema: fs-triage/v1
project: ${project}
component:
  purl: pkg:generic/busybox@1.36.1
  name: busybox
  group: null
  version: 1.36.1
decisions:
  CVE-2026-11000:
    status: IN_TRIAGE
    justification: null
    response: null
    reason: ${project}
`;
    for (const project of ["project-a", "project-b"]) {
      const directory = join(root, ".fs", "triage", project);
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "busybox.yaml"),
        overlay(project),
        "utf8",
      );
    }

    const projectA = await readVexWorking(root, {
      projectId: "project-a",
      projectVersionId: "pv-a",
    });
    const projectB = await readVexWorking(root, {
      projectId: "project-b",
      projectVersionId: "pv-b",
    });
    expect(projectA).toEqual([
      expect.objectContaining({ file: ".fs/triage/project-a/busybox.yaml" }),
    ]);
    expect(projectB).toEqual([
      expect.objectContaining({ file: ".fs/triage/project-b/busybox.yaml" }),
    ]);

    const host = createFakePluginHost({
      pluginId: `finite-state-vex-scope-${hosts.length}`,
    });
    hosts.push(host);
    const readScopes: Array<
      { projectId: string; projectVersionId: string | null } | undefined
    > = [];
    const adapter: EntityAdapter = {
      kind: "vexDecision",
      klass: "OVERLAY",
      serializer: createSerializer("vexDecision"),
      async *fetchRemote() {
        yield [];
      },
      async readWorking(worktreeRoot, readScope) {
        readScopes.push(readScope);
        return readVexWorking(worktreeRoot, readScope);
      },
    };
    const scopedDeps = {
      db: createPluginContext(host.bb).db(),
      adapters: [adapter],
      worktreeRoot: root,
    };
    const projectAScope = { projectId: "project-a", projectVersionId: "pv-a" };
    const plan = await computePlan(scopedDeps, projectAScope, ["vexDecision"]);
    expect(plan.items).toHaveLength(1);
    await status(scopedDeps, projectAScope, ["vexDecision"]);
    expect(readScopes).toEqual([projectAScope, projectAScope]);
    expect(projectA[0]?.payload["reason"]).toBe("project-a");

    const ambiguous = await readVexWorking(root).catch(
      (error: unknown) => error,
    );
    expect(ambiguous).toBeInstanceOf(VexWorkingReadError);
    expect(ambiguous).toMatchObject({
      issues: [
        expect.objectContaining({ file: ".fs/triage/project-b/busybox.yaml" }),
      ],
      partialWorking: [
        expect.objectContaining({ file: ".fs/triage/project-a/busybox.yaml" }),
      ],
    });

    await writeFile(
      join(root, ".fs", "triage", "project-a", "duplicate.yaml"),
      overlay("project-a"),
      "utf8",
    );
    const failure = await readVexWorking(root, {
      projectId: "project-a",
      projectVersionId: "pv-a",
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VexWorkingReadError);
    expect(failure).toMatchObject({
      issues: [
        expect.objectContaining({
          file: ".fs/triage/project-a/duplicate.yaml",
        }),
      ],
      partialWorking: [
        expect.objectContaining({ file: ".fs/triage/project-a/busybox.yaml" }),
      ],
    });
  });

  it("surfaces malformed YAML with valid entities from the other files preserved", async () => {
    const root = await worktree();
    await writeFile(
      join(root, ".fs", "triage", "broken.yaml"),
      "decisions:\n  CVE-1: [unterminated\n",
      "utf8",
    );
    await writeFile(
      join(root, ".fs", "triage", "valid.yaml"),
      `cve: CVE-2026-20000
purl: pkg:generic/valid@1
name: valid
version: "1"
status: IN_TRIAGE
justification: null
response: null
reason: null
`,
      "utf8",
    );
    const failure = await readVexWorking(root).catch((error: unknown) => error);
    expect(failure).toEqual(
      expect.objectContaining({
        name: "SerializeError",
        file: ".fs/triage/broken.yaml",
        issues: [expect.objectContaining({ file: ".fs/triage/broken.yaml" })],
        partialWorking: [
          expect.objectContaining({ file: ".fs/triage/valid.yaml" }),
        ],
      }),
    );
    expect(failure).toBeInstanceOf(SerializeError);
    expect(failure).toBeInstanceOf(VexWorkingReadError);
  });

  it("reports one broken file while fast-forwarding and statusing a well-formed peer", async () => {
    const root = await worktree();
    const directory = join(root, ".fs", "triage", "project");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "broken.yaml"),
      "decisions:\n  CVE-1: [unterminated\n",
      "utf8",
    );
    const validFile = join(directory, "valid.yaml");
    await writeFile(
      validFile,
      `schema: fs-triage/v1
project: project
component:
  purl: null
  name: eagle-component-001
  version: 1.0.0
decisions:
  CVE-2020-10000:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: local evidence
`,
      "utf8",
    );
    const remote = projectVexDecision(await firstFixtureFinding());
    if (remote === null) throw new Error("fixture has no VEX tuple");
    const adapter: EntityAdapter = {
      kind: "vexDecision",
      klass: "OVERLAY",
      serializer: createSerializer("vexDecision"),
      async *fetchRemote(_scope, progress) {
        progress({ page: 1, of: 1 });
        yield [remote];
      },
      readWorking: readVexWorking,
    };
    const host = createFakePluginHost({
      pluginId: "finite-state-vex-malformed-pull",
    });
    hosts.push(host);
    const deps = {
      db: createPluginContext(host.bb).db(),
      adapters: [adapter],
      worktreeRoot: root,
      isFileClean: async () => true,
      fastForwardWorking: ({
        worktreeRoot,
        files,
        baseRows,
      }: {
        worktreeRoot: string;
        files: readonly string[];
        baseRows: Parameters<typeof fastForwardVexWorking>[2];
      }) => fastForwardVexWorking(worktreeRoot, files, baseRows),
      createGenerationId: () => "generation-malformed-working",
      now: () => new Date("2026-08-12T21:00:00.000Z"),
    };
    await expect(
      pull(deps, { projectId: "project", projectVersionId: "version" }, [
        "vexDecision",
      ]),
    ).resolves.toMatchObject({
      kinds: { vexDecision: { fetched: 1, baseRows: 1, quarantined: 0 } },
      workingFastForwarded: false,
      divergence: ["vexDecision/.fs/triage/project/broken.yaml/read-error"],
    });
    expect(await readFile(validFile, "utf8")).toContain("base:");
    await expect(
      status(deps, { projectId: "project", projectVersionId: "version" }, [
        "vexDecision",
      ]),
    ).resolves.toMatchObject({
      local: [
        {
          kind: "vexDecision",
          key: remote.key,
          fields: expect.arrayContaining(["status"]),
        },
      ],
      upstream: [],
      conflicts: [],
      orphans: [],
    });
  });

  it("persists raw encoded key versions across migration and working read-back", async () => {
    const root = await worktree();
    const projectId = "project-encoded-version";
    const directory = join(root, ".fs", "triage", projectId);
    await mkdir(directory, { recursive: true });
    const file = join(directory, "libxml2.yaml");
    const rawVersion = "2.9.4%2Bdfsg1-2.2%2Bdeb9u2";
    const legacyCve = "legacy-vulnerability-id";
    await writeFile(
      file,
      `schema: fs-triage/v1
project: ${projectId}
component:
  purl: null
  name: libxml2
  group: debian
  version: ${rawVersion}
decisions:
  ${legacyCve}:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: reviewed evidence
`,
      "utf8",
    );
    const canonical = canonicalizeFindingIdentity({
      cve: "CVE-2016-4658",
      purl: null,
      name: "libxml2",
      group: "debian",
      version: rawVersion,
    });
    const legacyKey = ENTITIES.vexDecision.key({
      cve: legacyCve,
      purl: null,
      name: "libxml2",
      group: "debian",
      version: rawVersion,
    });

    await expect(
      migrateVexWorkingKeys(
        root,
        { projectId, projectVersionId: "version-encoded" },
        new Map([
          [
            legacyKey,
            { key: canonicalFindingStableKey(canonical), identity: canonical },
          ],
        ]),
      ),
    ).resolves.toBe(1);
    expect(await readFile(file, "utf8")).toContain(`version: ${rawVersion}`);
    await expect(
      readVexWorking(root, { projectId, projectVersionId: "version-encoded" }),
    ).resolves.toEqual([
      expect.objectContaining({ key: canonicalFindingStableKey(canonical) }),
    ]);
  });

  it("round-trips a purl-less multi-segment namespace without double encoding", async () => {
    const root = await worktree();
    const projectId = "project-multi-segment";
    const directory = join(root, ".fs", "triage", projectId);
    await mkdir(directory, { recursive: true });
    const row = {
      id: "finding-multi-segment",
      findingId: "CVE-2016-4658",
      component: { name: "a/b/c", version: "1.0%2B1" },
    } satisfies Record<string, Json>;
    const canonical = canonicalizeFindingIdentity({
      cve: "CVE-2016-4658",
      purl: null,
      name: "a/b/c",
      group: null,
      version: "1.0%2B1",
    });
    await writeFile(
      join(directory, "c.yaml"),
      `schema: fs-triage/v1
project: ${projectId}
component:
  purl: null
  name: ${canonical.name}
  group: ${canonical.group}
  version: ${canonical.keyVersion}
decisions:
  CVE-2016-4658:
    status: NOT_AFFECTED
    justification: null
    response: null
    reason: null
`,
      "utf8",
    );
    const expectedKey = projectVexDecisionKey(row);
    const first = await readVexWorking(root, {
      projectId,
      projectVersionId: "version-multi-segment",
    });
    const second = await readVexWorking(root, {
      projectId,
      projectVersionId: "version-multi-segment",
    });
    expect(first[0]?.key).toBe(expectedKey);
    expect(second[0]?.key).toBe(expectedKey);
    expect(canonical.group).toBe("a%2Fb");
  });

  it("migrates the opaque VEX key alias on the byte-frozen real specimen", async () => {
    const row = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../test/mock-remote/fixtures/platform/fs174-i491nax-distro-specimen.json",
        ),
        "utf8",
      ),
    ) as Record<string, Json>;
    const decided = { ...row, vexStatus: "NOT_AFFECTED" };
    const targetKey = projectVexDecisionKey(decided);
    const componentId = "e1a048dc-9890-5333-9e97-cd5d6f429fcd";
    const root = await worktree();
    const projectId = "cfe6fb97-ed49-5ace-b0fe-8121dba2c793";
    const projectVersionId = "b3df3633-ebd7-560e-a3b7-77953521b4e3";
    const directory = join(root, ".fs", "triage", projectId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "component.yaml"),
      `schema: fs-triage/v1
project: ${projectId}
component:
  purl: null
  name: ${componentId}
  group: null
  version: null
decisions:
  CVE-2016-4658:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: reviewed evidence
`,
      "utf8",
    );
    expect((await readVexWorking(root))[0]?.key).toBe(
      ENTITIES.vexDecision.key({
        cve: "CVE-2016-4658",
        purl: null,
        name: componentId,
        group: null,
        version: null,
      }),
    );
    const platform = {
      getFindings() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { items: [decided], total: 1, next: null };
          },
        };
      },
    };
    const host = createFakePluginHost({ pluginId: "fs173-opaque-alias" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    await pull(
      {
        db,
        adapters: [createVexDecisionAdapter(platform, db)],
        cachePullers: [],
        worktreeRoot: root,
        createGenerationId: () => "opaque-alias-1",
        now: () => new Date("2026-08-14T03:40:00.000Z"),
      },
      { projectId, projectVersionId },
      ["vexDecision"],
    );
    expect(
      (await readVexWorking(root, { projectId, projectVersionId }))[0]?.key,
    ).toBe(targetKey);
  });

  it("isolates a synthetic nameless decided row and retains its valid peer", async () => {
    const valid = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../test/mock-remote/fixtures/platform/fs174-i491nax-distro-specimen.json",
        ),
        "utf8",
      ),
    ) as Record<string, Json>;
    const nameless: Record<string, Json> = {
      id: "synthetic-nameless-decided",
      findingId: "CVE-2026-9999",
      component: { id: "opaque-only", version: "1.0" },
      vexStatus: "NOT_AFFECTED",
    };
    const validDecided: Record<string, Json> = {
      ...valid,
      vexStatus: "NOT_AFFECTED",
    };
    const advisories: VexRemoteRowAdvisory[] = [];
    const platform = {
      getFindings() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              items: [nameless, validDecided],
              total: 2,
              next: null,
            };
          },
        };
      },
    };
    const host = createFakePluginHost({ pluginId: "fs173-row-isolation" });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    const report = await pull(
      {
        db,
        adapters: [
          createVexDecisionAdapter(platform, db, (advisory) =>
            advisories.push(advisory),
          ),
        ],
        worktreeRoot: null,
        createGenerationId: () => "row-isolation-1",
        now: () => new Date("2026-08-14T03:40:00.000Z"),
      },
      {
        projectId: "cfe6fb97-ed49-5ace-b0fe-8121dba2c793",
        projectVersionId: "b3df3633-ebd7-560e-a3b7-77953521b4e3",
      },
      ["vexDecision"],
    );
    expect(report.kinds["vexDecision"]).toEqual({
      fetched: 1,
      baseRows: 1,
      quarantined: 1,
    });
    expect(report.advisories).toEqual([
      {
        kind: "vexDecision",
        code: "VEX_REMOTE_IDENTITY_MISSING",
        count: 1,
      },
    ]);
    expect(advisories).toEqual([
      {
        code: "VEX_REMOTE_IDENTITY_MISSING",
        findingId: "synthetic-nameless-decided",
        message: "Platform finding is missing canonical identity",
      },
    ]);
  });

  it("migrates a VEX-space legacy key through pull and keeps the new key stable", async () => {
    const specimen = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../test/mock-remote/fixtures/platform/fs174-cve-uuid-mapping-specimen.json",
        ),
        "utf8",
      ),
    ) as Record<string, Json>;
    const root = await worktree();
    const projectId = "5d78bed3-fa8e-59cf-b8a1-6046853ba785";
    const directory = join(root, ".fs", "triage", projectId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "broken.yaml"),
      "decisions:\n  CVE-1: [unterminated\n",
      "utf8",
    );
    const file = join(directory, "mbed-tls.yaml");
    await writeFile(
      file,
      `schema: fs-triage/v1
project: ${projectId}
component:
  purl: null
  name: Mbed TLS
  group: null
  version: null
decisions:
  CVE-2026-34877:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: reviewed evidence
`,
      "utf8",
    );
    const undecidedPeer: Record<string, Json> = {
      id: "undecided-unkeyable-peer",
      findingId: "GHSA-peer",
      vulnerabilityId: "peer-uuid",
    };
    const migrationRow: Record<string, Json> = {
      ...specimen,
      cve: "cbdc8dc1-66ad-5264-b81b-67b2eaf1257e",
      componentId: "df542a94-2571-5f0d-aaf9-3892e9d70ef5",
      componentFallbackIdentity: "Mbed TLS",
    };
    const client = {
      listComponents() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { items: [], total: 0, next: null };
          },
        };
      },
      getFindings() {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              items: [undecidedPeer, migrationRow],
              total: 2,
              next: null,
            };
          },
        };
      },
    };
    const host = createFakePluginHost({
      pluginId: "finite-state-vex-key-migration",
    });
    hosts.push(host);
    let generation = 0;
    const deps = {
      db: createPluginContext(host.bb).db(),
      adapters: [createVexDecisionAdapter(client)],
      worktreeRoot: root,
      createGenerationId: () => `migration-${++generation}`,
      now: () => new Date("2026-08-13T23:00:00.000Z"),
    };
    const scope = {
      projectId,
      projectVersionId: "89ad8a41-2185-5df0-968b-c250312c908b",
    };
    await pull(deps, scope, ["vexDecision"]);
    const migrated = await readFile(file, "utf8");
    expect(migrated).toContain("CVE-2026-34877:");
    expect(migrated).toContain("version: 3.0.0");
    const workingKeys = async () => {
      const result = await readVexWorking(root, scope).catch(
        (error: unknown) => error,
      );
      if (!(result instanceof VexWorkingReadError))
        throw new Error("expected isolated broken triage peer");
      return result.partialWorking.map((row) => row.key);
    };
    const firstKey = (await workingKeys())[0];
    await pull(deps, scope, ["vexDecision"]);
    expect((await workingKeys())[0]).toBe(firstKey);
  });

  it("migrates a persisted index key to the index-free real-specimen key and stays stable", async () => {
    const specimen = JSON.parse(
      await readFile(
        resolve(
          import.meta.dirname,
          "../../../test/mock-remote/fixtures/platform/fs174-i491nax-distro-specimen.json",
        ),
        "utf8",
      ),
    ) as Record<string, Json>;
    const root = await worktree();
    const projectId = "cfe6fb97-ed49-5ace-b0fe-8121dba2c793";
    const projectVersionId = "b3df3633-ebd7-560e-a3b7-77953521b4e3";
    const directory = join(root, ".fs", "triage", projectId);
    await mkdir(directory, { recursive: true });
    const rawVersion = "2.9.4%2Bdfsg1-2.2%2Bdeb9u2";
    const file = join(directory, "libxml2.yaml");
    const expectedKey = normalizeFinding(specimen).stableKey;
    const oldCacheKey = canonicalFindingStableKey(
      canonicalizeFindingIdentity({
        cve: "CVE-2016-4658",
        purl: null,
        name: "libxml2",
        group: "debian/stable/main",
        version: rawVersion,
      }),
    );
    expect(oldCacheKey).not.toBe(expectedKey);

    let componentIndexReads = 0;
    const platform = {
      listComponents() {
        componentIndexReads += 1;
        throw new Error("component index must not participate in identity");
      },
      getFindings() {
        return {
          async *[Symbol.asyncIterator]() {
            yield { items: [specimen], total: 1, next: null };
          },
        };
      },
    };
    const host = createFakePluginHost({
      pluginId: "finite-state-vex-cache-key-migration",
    });
    hosts.push(host);
    const db = createPluginContext(host.bb).db();
    let generation = 0;
    const deps = {
      db,
      adapters: [createVexDecisionAdapter(platform, db)],
      cachePullers: [
        {
          kind: "finding" as const,
          async pull(
            scope: {
              projectId: string;
              projectVersionId: string | null;
            },
            generationId: string,
          ) {
            const result = await pullFindings(
              { db, platform },
              scope,
              generationId,
              () => undefined,
            );
            return {
              fetched: result.fetched,
              baseRows: result.published,
              quarantined: result.quarantined,
            };
          },
        },
      ],
      worktreeRoot: root,
      createGenerationId: () => `wire-only-${++generation}`,
      now: () => new Date("2026-08-14T02:00:00.000Z"),
    };
    const scope = { projectId, projectVersionId };

    // Establish an accepted row, then model the exact key written by the old
    // index-joined cache implementation. Migration reads this key directly by
    // finding id; it never reconstructs identity from canonical cache fields.
    await pull(deps, scope, ["vexDecision", "finding"]);
    db.prepare(
      `UPDATE findings SET stable_key = ?
        WHERE project_id = ? AND project_version_id = ?`,
    ).run(oldCacheKey, projectId, projectVersionId);
    await writeFile(
      file,
      `schema: fs-triage/v1
project: ${projectId}
component:
  purl: null
  name: libxml2
  group: debian%2Fstable%2Fmain
  version: ${rawVersion}
decisions:
  CVE-2016-4658:
    status: NOT_AFFECTED
    justification: CODE_NOT_PRESENT
    response: null
    reason: reviewed evidence
`,
      "utf8",
    );
    expect((await readVexWorking(root, scope))[0]?.key).toBe(oldCacheKey);

    await pull(deps, scope, ["vexDecision", "finding"]);
    const afterMigration = (await readVexWorking(root, scope))[0]?.key;
    expect(afterMigration).toBe(expectedKey);
    expect(await readFile(file, "utf8")).toContain(`version: ${rawVersion}`);
    expect(await readFile(file, "utf8")).toContain("group: debian");

    // A registered second pull proves canonical ingest and authored read-back
    // are symmetric for the byte-frozen, purl-less tenant specimen.
    deps.adapters = [createVexDecisionAdapter(platform, db)];
    await pull(deps, scope, ["vexDecision", "finding"]);
    expect((await readVexWorking(root, scope))[0]?.key).toBe(afterMigration);
    expect(componentIndexReads).toBe(0);
    expect(
      (
        db
          .prepare(
            `SELECT stable_key AS stableKey
               FROM findings
              WHERE project_id = ? AND project_version_id = ?
              ORDER BY generation_id DESC`,
          )
          .get(projectId, projectVersionId) as { stableKey: string } | undefined
      )?.stableKey,
    ).toBe(expectedKey);
  });
});
