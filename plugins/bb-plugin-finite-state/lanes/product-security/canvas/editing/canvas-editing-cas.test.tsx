import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { createFakePluginHost } from "@bb/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  casRemoveCanvasFile,
  createSdkCanvasFileStore,
  reclaimCanvasDeleteTombstones,
  serializeCanvasEntity,
  type CanvasProjectSource,
} from "./writer.js";
import { parseArchitectureEntity } from "./schema.js";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];
const source: CanvasProjectSource = { hostId: "host-1", path: "/workspace" };
const file = "product-security/architecture/components/gateway.yaml";
const absolute = `/workspace/${file}`;

afterEach(async () => {
  await Promise.all(
    hosts.splice(0).map((host) => host.harness.lifecycle.dispose()),
  );
});

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function missing(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

function fakeFiles(
  initial: Readonly<Record<string, string>>,
  afterFirstMove?: (files: Map<string, string>) => void,
): {
  host: ReturnType<typeof createFakePluginHost>;
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));
  let moves = 0;
  const host = createFakePluginHost({
    pluginId: `finite-state-cas-${hosts.length}`,
    sdk: {
      files: {
        list: ({ path }) => ({
          files: [...files.keys()]
            .filter((candidate) => dirname(candidate) === path)
            .map((candidate) => ({
              name: basename(candidate),
              path: candidate,
            })),
          truncated: false,
        }),
        read: ({ path }) => {
          const content = files.get(path);
          if (content === undefined) throw missing(path);
          return {
            content,
            contentEncoding: "utf8" as const,
            sha256: hash(content),
          };
        },
        move: ({ sourcePath, destinationPath }) => {
          const content = files.get(sourcePath);
          if (content === undefined) throw missing(sourcePath);
          if (files.has(destinationPath)) {
            throw Object.assign(new Error("path_exists"), {
              code: "path_exists",
            });
          }
          files.delete(sourcePath);
          files.set(destinationPath, content);
          moves += 1;
          if (moves === 1) afterFirstMove?.(files);
          return { ok: true as const };
        },
        remove: ({ path }) => {
          if (!files.delete(path)) throw missing(path);
          return { ok: true as const };
        },
      },
    },
  });
  hosts.push(host);
  return { host, files };
}

describe("WP-35 lane-local CAS delete", () => {
  it("commits a matching delete by unlinking the rename-aside tombstone", async () => {
    const expected = "slug: gateway\nname: Expected\n";
    const { host, files } = fakeFiles({ [absolute]: expected });
    const result = await casRemoveCanvasFile(
      host.bb,
      source,
      file,
      hash(expected),
      { now: 40_000, token: "match" },
    );
    expect(result).toEqual({ outcome: "removed" });
    expect(files.size).toBe(0);
  });

  it("atomically restores mismatched bytes and reports a conflict", async () => {
    const external = "slug: gateway\nname: External\n";
    const { host, files } = fakeFiles({ [absolute]: external });
    const result = await casRemoveCanvasFile(
      host.bb,
      source,
      file,
      hash("slug: gateway\nname: Expected\n"),
      { now: 50_000, token: "mismatch" },
    );
    expect(result).toEqual({
      outcome: "conflict",
      currentSha256: hash(external),
      preservedFile: null,
    });
    expect(files.get(absolute)).toBe(external);
    expect([...files.keys()]).toEqual([absolute]);
  });

  it("preserves both artifacts when a recreate races mismatch restoration", async () => {
    const moved = "slug: gateway\nname: External before rename\n";
    const recreated = "slug: gateway\nname: Recreated\n";
    const { host, files } = fakeFiles({ [absolute]: moved }, (state) =>
      state.set(absolute, recreated),
    );
    const result = await casRemoveCanvasFile(
      host.bb,
      source,
      file,
      hash("slug: gateway\nname: Expected\n"),
      { now: 60_000, token: "race" },
    );
    expect(result.outcome).toBe("conflict");
    if (result.outcome !== "conflict") throw new Error("expected conflict");
    expect(result.preservedFile).toContain(".fs-cas-remove.60000.race");
    expect(files.get(absolute)).toBe(recreated);
    expect([...files.entries()].find(([path]) => path !== absolute)?.[1]).toBe(
      moved,
    );
  });

  it("does not unlink expected bytes when a recreation appears after rename", async () => {
    const expected = "slug: gateway\nname: Expected\n";
    const recreated = "slug: gateway\nname: Recreated\n";
    const { host, files } = fakeFiles({ [absolute]: expected }, (state) =>
      state.set(absolute, recreated),
    );
    const result = await casRemoveCanvasFile(
      host.bb,
      source,
      file,
      hash(expected),
      { now: 70_000, token: "recreate" },
    );
    expect(result).toMatchObject({
      outcome: "conflict",
      currentSha256: hash(recreated),
    });
    expect(files.get(absolute)).toBe(recreated);
    expect([...files.values()]).toContain(expected);
  });

  it("reclaims a crash-stale tombstone after 30 seconds without an unlink race", async () => {
    const expected = "slug: gateway\nname: Expected\n";
    const tombstone = `${absolute}.fs-cas-remove.1000.crash`;
    const { host, files } = fakeFiles({ [tombstone]: expected });
    await reclaimCanvasDeleteTombstones(host.bb, source, file, 31_001);
    expect(files.get(absolute)).toBe(expected);
    expect(files.has(tombstone)).toBe(false);
  });

  it("renders active rename-aside bytes as in-progress instead of deleted", async () => {
    const content = serializeCanvasEntity(
      parseArchitectureEntity("component", {
        slug: "gateway",
        name: "Gateway",
        component_type: "software",
        criticality: "high",
        interfaces: [],
        technologies: [],
        is_entry_point: true,
        stores_data: false,
      }),
    );
    const tombstone = `${absolute}.fs-cas-remove.${Date.now()}.active`;
    const { host } = fakeFiles({ [tombstone]: content });
    const store = createSdkCanvasFileStore(host.bb, source);
    await expect(store.read(file)).resolves.toMatchObject({
      file,
      sha256: hash(content),
      entity: { slug: "gateway", name: "Gateway" },
    });
    await expect(store.list("component")).resolves.toHaveLength(1);
  });
});
