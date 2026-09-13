import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const source = {
  kind: "thread-storage",
  threadId: "thread-editor-test",
  environmentId: "environment-editor-test",
  projectId: null,
};
const storageRootPath = "/remote-storage/thread-editor-test";
const hostId = "remote-editor-host";

async function setup() {
  const storageLocation = vi.fn(() => ({ hostId, storageRootPath }));
  const read = vi.fn(() => ({
    content: "saved text",
    contentEncoding: "utf8",
    sizeBytes: 10,
    sha256: "original",
  }));
  const listPaths = vi.fn(() => ({
    paths: [{ path: "notes/document.txt", kind: "file" }],
    truncated: false,
  }));
  const write = vi.fn(() => ({ outcome: "written", sha256: "updated" }));
  const { bb, harness } = createFakePluginHost({
    pluginId: "monaco-editor",
    sdk: {
      system: { config: () => ({ dataDir: "/server-data" }) },
      threads: { storageLocation },
      files: { read, listPaths, write },
    },
  });
  await plugin(bb);
  return { harness, storageLocation, read, listPaths, write };
}

describe("thread storage host routing", () => {
  it("reads from the thread's storage host and root", async () => {
    const { harness, read, storageLocation } = await setup();
    const result = await harness.callRpc("read", {
      source,
      path: "notes/document.txt",
    });
    expect(read).toHaveBeenCalledWith({
      hostId,
      rootPath: storageRootPath,
      path: `${storageRootPath}/notes/document.txt`,
    });
    expect(storageLocation).toHaveBeenCalledWith({ threadId: source.threadId });
    expect(result).toMatchObject({
      kind: "text",
      content: "saved text",
      absolutePath: `${storageRootPath}/notes/document.txt`,
    });
  });

  it("lists the thread's storage host and root", async () => {
    const { harness, listPaths } = await setup();
    const result = await harness.callRpc("tree", { source });
    expect(listPaths).toHaveBeenCalledWith({
      hostId,
      path: storageRootPath,
      includeFiles: true,
      includeDirectories: true,
      includeHidden: true,
      limit: 10_000,
    });
    expect(result).toEqual({
      root: storageRootPath,
      entries: [{ path: "notes/document.txt", kind: "file" }],
      truncated: false,
    });
  });

  it("saves to the thread's storage host with the expected version", async () => {
    const { harness, write } = await setup();
    const result = await harness.callRpc("write", {
      source,
      path: "notes/document.txt",
      content: "edited text",
      expectedSha256: "original",
    });
    expect(write).toHaveBeenCalledWith({
      hostId,
      rootPath: storageRootPath,
      path: `${storageRootPath}/notes/document.txt`,
      content: "edited text",
      contentEncoding: "utf8",
      expectedSha256: "original",
    });
    expect(result).toEqual({ outcome: "written", sha256: "updated" });
  });
});
