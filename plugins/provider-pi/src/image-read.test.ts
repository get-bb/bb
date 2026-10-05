import { describe, expect, it } from "vitest";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { createPiDeltaTranslator } from "./delta-translation.js";

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
  return (event: unknown, threadId = "thread-a") =>
    assembler.assemble({
      threadId,
      deltas: translator.translate(event, { threadId }),
    });
}

describe("Pi native image read completion", () => {
  it.each([
    {
      name: "successful image read",
      args: { path: "/workspace/asset.png" },
      result: { content: [imageBlock] },
      toolName: "read",
      isError: false,
      imagePath: "/workspace/asset.png",
    },
    {
      name: "mixed text and image without an image extension",
      args: { path: "/workspace/asset" },
      result: { content: [{ type: "text", text: "scaled" }, imageBlock] },
      toolName: "read",
      isError: false,
      imagePath: "/workspace/asset",
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
      },
      { name: "missing path", result: { content: [imageBlock] }, args: {} },
      {
        name: "non-string path",
        result: { content: [imageBlock] },
        args: { path: 123 },
      },
      {
        name: "empty path",
        result: { content: [imageBlock] },
        args: { path: "" },
      },
      {
        name: "whitespace path",
        result: { content: [imageBlock] },
        args: { path: " " },
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
      toolName: "read",
      args: { path: "/workspace/asset.png" },
      isError: false,
      imagePath: null,
      ...control,
    })),
  ])("preserves the correct item shape for $name", (scenario) => {
    const translate = createHarness();
    translate({ type: "agent_start" });
    const started = translate({
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: scenario.toolName,
      args: scenario.args,
    }).find((event) => event.type === "item/started");
    expect(started).toMatchObject({
      item: { type: "toolCall", tool: scenario.toolName, status: "pending" },
    });
    const completed = translate({
      type: "tool_execution_end",
      toolCallId: "read-1",
      toolName: scenario.toolName,
      result: scenario.result,
      isError: scenario.isError,
    })
      .filter((event) => event.type === "item/completed")
      .at(-1);
    expect(completed?.item.id).toBe(started?.item.id);
    if (scenario.imagePath !== null) {
      expect(completed?.item).toEqual({
        type: "imageView",
        id: started?.item.id,
        path: scenario.imagePath,
      });
    } else {
      expect(completed?.item).toMatchObject({
        type: "toolCall",
        tool: scenario.toolName,
        status: scenario.isError ? "failed" : "completed",
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
          args: { path: `/workspace/${threadId}.png` },
        },
        threadId,
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
      )
        .filter((event) => event.type === "item/completed")
        .at(-1);
      expect(completed?.item).toMatchObject({
        type: "imageView",
        path: `/workspace/${threadId}.png`,
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
    })
      .filter((event) => event.type === "item/completed")
      .at(-1);
    expect(completed?.item).toMatchObject({
      type: "toolCall",
      tool: "read",
      status: "completed",
    });
  });
});
