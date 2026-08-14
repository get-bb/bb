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
  readVexWorking,
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
    const flat = projectVexDecision({
      ...finding,
      component: null,
      componentId: String(component["id"]),
    });
    expect(projected?.key).not.toBe(flat?.key);
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
      kinds: { vexDecision: { fetched: 1, baseRows: 1 } },
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
  cbdc8dc1-66ad-5264-b81b-67b2eaf1257e:
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
      component: null,
      componentId: "df542a94-2571-5f0d-aaf9-3892e9d70ef5",
      componentFallbackIdentity: "Mbed TLS",
    };
    const client = {
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
    expect(migrated).not.toContain("cbdc8dc1-66ad-5264-b81b-67b2eaf1257e:");
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
});
