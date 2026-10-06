import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createPiDeltaTranslator } from "./delta-translation.js";

const workspace = resolve("/workspace");

const imageBlock = {
  type: "image",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVZkAAAAASUVORK5CYII=",
  mimeType: "image/png",
};

function createHarness() {
  const translator = createPiDeltaTranslator({
    resolveModelContextWindow: () => null,
  });
  const assembler = createDeltaAssembler({
    providerId: "pi",
    entropyPrefix: "image-read",
    textDeltaFlushMs: 0,
  });
  return (event: unknown, threadId = "thread-a", cwd?: string) =>
    assembler.assemble({
      threadId,
      deltas: translator.translate(event, {
        threadId,
        ...(cwd === undefined ? {} : { cwd }),
      }),
    });
}

describe("Pi native image read completion", () => {
  it.each([
    {
      name: "successful image read",
      args: { path: join(workspace, "asset.png") },
      result: { content: [imageBlock] },
      imagePath: join(workspace, "asset.png"),
    },
    {
      name: "mixed text and image",
      args: { path: join(workspace, "asset.PNG") },
      result: { content: [{ type: "text", text: "scaled" }, imageBlock] },
      imagePath: join(workspace, "asset.PNG"),
    },
    {
      name: "cwd-relative image path",
      args: { path: "shots/../shots/asset.jpg" },
      result: { content: [imageBlock] },
      imagePath: join(workspace, "shots", "asset.jpg"),
    },
    {
      name: "at-prefixed image path",
      args: { path: "@shots/asset.webp" },
      result: { content: [imageBlock] },
      imagePath: join(workspace, "shots", "asset.webp"),
    },
    {
      name: "home-relative image path",
      args: { path: "~/asset.gif" },
      result: { content: [imageBlock] },
      imagePath: join(homedir(), "asset.gif"),
    },
    ...[
      {
        name: "text at an image path",
        result: { content: [{ type: "text", text: "source" }] },
      },
      {
        name: "failed image read",
        result: { content: [imageBlock] },
        isError: true,
      },
      {
        name: "unrelated image tool",
        result: { content: [imageBlock] },
        toolName: "inspect",
        opensAtStart: true,
      },
      {
        name: "image content without an image extension",
        result: { content: [imageBlock] },
        args: { path: join(workspace, "asset") },
        opensAtStart: true,
      },
      {
        name: "relative path without a session cwd",
        result: { content: [imageBlock] },
        args: { path: "asset.png" },
        cwd: undefined,
        opensAtStart: true,
      },
      {
        name: "URL path",
        result: { content: [imageBlock] },
        args: { path: "file:///workspace/asset.png" },
        opensAtStart: true,
      },
      {
        name: "missing path",
        result: { content: [imageBlock] },
        args: {},
        opensAtStart: true,
      },
      {
        name: "non-string path",
        result: { content: [imageBlock] },
        args: { path: 123 },
        opensAtStart: true,
      },
      {
        name: "whitespace path",
        result: { content: [imageBlock] },
        args: { path: " " },
        opensAtStart: true,
      },
      {
        name: "missing image data",
        result: { content: [{ type: "image", mimeType: "image/png" }] },
      },
      {
        name: "empty image data",
        result: { content: [{ ...imageBlock, data: "" }] },
      },
      {
        name: "invalid image MIME",
        result: { content: [{ ...imageBlock, mimeType: "text/plain" }] },
      },
      { name: "malformed content", result: { content: "image" } },
      { name: "null block", result: { content: [null] } },
    ].map((control) => ({
      args: { path: join(workspace, "asset.png") },
      imagePath: null,
      ...control,
    })),
  ])("settles $name once with the correct item shape", (scenario) => {
    const toolName = "toolName" in scenario ? scenario.toolName : "read";
    const isError = "isError" in scenario ? scenario.isError : false;
    const cwd = "cwd" in scenario ? scenario.cwd : workspace;
    const translate = createHarness();
    translate({ type: "agent_start" });
    const startEvents = translate(
      {
        type: "tool_execution_start",
        toolCallId: "read-1",
        toolName,
        args: scenario.args,
      },
      "thread-a",
      cwd,
    );
    const endEvents = translate(
      {
        type: "tool_execution_end",
        toolCallId: "read-1",
        toolName,
        result: scenario.result,
        isError,
      },
      "thread-a",
      cwd,
    );
    const events = [...startEvents, ...endEvents];
    const started = events.filter((event) => event.type === "item/started");
    const completed = events.filter((event) => event.type === "item/completed");
    expect(started).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(startEvents.some((event) => event.type === "item/started")).toBe(
      "opensAtStart" in scenario,
    );
    const id = started[0]?.item.id;
    if (scenario.imagePath !== null) {
      expect(started[0]?.item).toEqual({
        type: "imageView",
        id,
        path: scenario.imagePath,
      });
      expect(completed[0]?.item).toEqual(started[0]?.item);
    } else {
      expect(completed[0]?.item).toMatchObject({
        type: "toolCall",
        id,
        tool: toolName,
        status: isError ? "failed" : "completed",
      });
    }
  });

  it("does not reuse another thread's path for overlapping tool IDs", () => {
    const translate = createHarness();
    for (const threadId of ["thread-a", "thread-b"]) {
      translate({ type: "agent_start" }, threadId);
      translate(
        {
          type: "tool_execution_start",
          toolCallId: "shared-read",
          toolName: "read",
          args: { path: "asset.png" },
        },
        threadId,
        join(workspace, threadId),
      );
    }
    for (const threadId of ["thread-b", "thread-a"]) {
      const completed = translate(
        {
          type: "tool_execution_end",
          toolCallId: "shared-read",
          toolName: "read",
          result: { content: [imageBlock] },
          isError: false,
        },
        threadId,
        join(workspace, threadId),
      ).filter((event) => event.type === "item/completed");
      expect(completed).toHaveLength(1);
      expect(completed[0]?.item).toMatchObject({
        type: "imageView",
        path: join(workspace, threadId, "asset.png"),
      });
    }
  });

  it("keeps an image-bearing close without a start generic", () => {
    const translate = createHarness();
    translate({ type: "agent_start" });
    const completed = translate({
      type: "tool_execution_end",
      toolCallId: "unseen-read",
      toolName: "read",
      result: { content: [imageBlock] },
      isError: false,
    }).filter((event) => event.type === "item/completed");
    expect(completed).toHaveLength(1);
    expect(completed[0]?.item).toMatchObject({
      type: "toolCall",
      tool: "read",
      status: "completed",
    });
  });
});
