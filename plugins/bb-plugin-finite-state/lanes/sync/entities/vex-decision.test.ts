import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { createPluginContext } from "../../../lib/context.js";
import type { Json } from "../../../lib/remote/types.js";
import { ENTITIES } from "../../../lib/sync/registry.js";
import { pull } from "../engine/pull.js";
import { status } from "../engine/status.js";
import type { EntityAdapter } from "../engine/adapter.js";
import { createSerializer } from "../serialize/serializer.js";
import { SerializeError } from "../serialize/yaml.js";
import {
  fastForwardVexWorking,
  projectVexDecision,
  readVexWorking,
  VexWorkingReadError,
} from "./vex-decision.js";

const FIXTURE = resolve(import.meta.dirname, "../../../test/mock-remote/fixtures/platform/findings.jsonl");
const roots: string[] = [];
const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fs-wp17-vex-"));
  roots.push(root);
  await mkdir(join(root, ".fs", "triage"), { recursive: true });
  return root;
}

describe("vexDecision adapter", () => {
  it("projects frozen Platform fixture bytes to the canonical tuple and stable key", async () => {
    const first = (await readFile(FIXTURE, "utf8")).split("\n", 1)[0];
    if (first === undefined) throw new Error("fixture is empty");
    const row = JSON.parse(first) as Record<string, Json>;
    const projected = projectVexDecision(row);
    expect(projected).toEqual({
      key: ENTITIES.vexDecision.key({
        cve: "CVE-2020-10000",
        purl: "pkg:generic/eagle-component-001@1.0.0",
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
  });

  it("parses aggregate .fs/triage YAML into one working entity per decision", async () => {
    const root = await worktree();
    await writeFile(join(root, ".fs", "triage", "busybox.yaml"), `schema: fs-triage/v1
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
`, "utf8");

    const working = await readVexWorking(root);
    expect(working).toHaveLength(2);
    expect(working[0]?.file).toBe(".fs/triage/busybox.yaml");
    expect(working.map((item) => item.payload)).toEqual([
      { status: "NOT_AFFECTED", justification: "CODE_NOT_PRESENT", response: null, reason: "not compiled" },
      { status: "IN_TRIAGE", justification: null, response: null, reason: null },
    ]);
  });

  it("surfaces malformed YAML with valid entities from the other files preserved", async () => {
    const root = await worktree();
    await writeFile(join(root, ".fs", "triage", "broken.yaml"), "decisions:\n  CVE-1: [unterminated\n", "utf8");
    await writeFile(join(root, ".fs", "triage", "valid.yaml"), `cve: CVE-2026-20000
purl: pkg:generic/valid@1
name: valid
version: "1"
status: IN_TRIAGE
justification: null
response: null
reason: null
`, "utf8");
    const failure = await readVexWorking(root).catch((error: unknown) => error);
    expect(failure).toEqual(expect.objectContaining({
      name: "SerializeError",
      file: ".fs/triage/broken.yaml",
      issues: [expect.objectContaining({ file: ".fs/triage/broken.yaml" })],
      partialWorking: [expect.objectContaining({ file: ".fs/triage/valid.yaml" })],
    }));
    expect(failure).toBeInstanceOf(SerializeError);
    expect(failure).toBeInstanceOf(VexWorkingReadError);
  });

  it("reports one broken file while fast-forwarding and statusing a well-formed peer", async () => {
    const root = await worktree();
    await writeFile(join(root, ".fs", "triage", "broken.yaml"), "decisions:\n  CVE-1: [unterminated\n", "utf8");
    const validFile = join(root, ".fs", "triage", "valid.yaml");
    await writeFile(validFile, `cve: CVE-2020-10000
purl: pkg:generic/eagle-component-001@1.0.0
name: eagle-component-001
version: 1.0.0
status: NOT_AFFECTED
justification: CODE_NOT_PRESENT
response: null
reason: local evidence
`, "utf8");
    const remote = projectVexDecision(JSON.parse(
      (await readFile(FIXTURE, "utf8")).split("\n", 1)[0] ?? "{}",
    ) as Record<string, Json>);
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
    const host = createFakePluginHost({ pluginId: "finite-state-vex-malformed-pull" });
    hosts.push(host);
    const deps = {
      db: createPluginContext(host.bb).db(),
      adapters: [adapter],
      worktreeRoot: root,
      isFileClean: async () => true,
      fastForwardWorking: ({ worktreeRoot, files, baseRows }: {
        worktreeRoot: string;
        files: readonly string[];
        baseRows: Parameters<typeof fastForwardVexWorking>[2];
      }) => fastForwardVexWorking(worktreeRoot, files, baseRows),
      createGenerationId: () => "generation-malformed-working",
      now: () => new Date("2026-08-12T21:00:00.000Z"),
    };
    await expect(pull(deps, { projectId: "project", projectVersionId: "version" }, ["vexDecision"]))
      .resolves.toMatchObject({
        kinds: { vexDecision: { fetched: 1, baseRows: 1 } },
        workingFastForwarded: false,
        divergence: ["vexDecision/.fs/triage/broken.yaml/read-error"],
      });
    expect(await readFile(validFile, "utf8")).toContain("base:");
    await expect(status(
      deps,
      { projectId: "project", projectVersionId: "version" },
      ["vexDecision"],
    )).resolves.toMatchObject({
      local: [{ kind: "vexDecision", key: remote.key, fields: expect.arrayContaining(["status"]) }],
      upstream: [],
      conflicts: [],
      orphans: [],
    });
  });
});
