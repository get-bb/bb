import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ThreadQueuedMessage } from "@bb/domain";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

function queuedMessage(
  overrides: Partial<ThreadQueuedMessage>,
): ThreadQueuedMessage {
  return {
    id: "queued-1",
    origin: null,
    originPluginId: null,
    initiator: "user",
    senderThreadId: null,
    threadId: "thread-1",
    content: [{ type: "text", text: "Follow up", mentions: [] }],
    model: "gpt-5",
    reasoningLevel: "medium",
    permissionMode: "auto",
    serviceTier: "default",
    groupWithNext: false,
    sendAt: null,
    waitingOn: null,
    failureReason: null,
    payload: { kind: "inline" },
    editable: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("bb thread organization commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("creates a named thread section", async () => {
    const create = vi.fn(async () => ({
      id: "section-review",
      name: "Review",
      createdAt: 1,
      updatedAt: 1,
    }));
    stubServerApi({ "v1.thread-sections.$post": create });

    await runCommand(["thread", "section", "create", "Review"], register);

    expect(create).toHaveBeenCalledWith({ json: { name: "Review" } });
  });

  it("creates an explicitly queued message", async () => {
    const create = vi.fn(async () => ({
      id: "queued-1",
      threadId: "thread-1",
      position: 1,
      groupBoundary: false,
      payload: {
        input: [{ type: "text", text: "next task", mentions: [] }],
      },
      createdAt: 1,
      updatedAt: 1,
    }));
    stubServerApi({ "v1.threads.:id.queued-messages.$post": create });

    await runCommand(
      ["thread", "queue", "create", "thread-1", "next task"],
      register,
    );

    expect(create).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      json: {
        input: [{ type: "text", text: "next task", mentions: [] }],
      },
    });
  });

  it("queues existing attachment tokens with text and a model without uploading", async () => {
    const create = vi.fn(async () => queuedMessage({}));
    stubServerApi({ "v1.threads.:id.queued-messages.$post": create });

    await runCommand(
      [
        "thread",
        "queue",
        "create",
        "thread-1",
        "review both",
        "--model",
        "gpt-5",
        "--file",
        "report.pdf",
        "--image",
        "one.png",
        "--image",
        "two.png",
      ],
      register,
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledExactlyOnceWith({
      param: { id: "thread-1" },
      json: {
        model: "gpt-5",
        input: [
          { type: "text", text: "review both", mentions: [] },
          { type: "localFile", path: "report.pdf" },
          { type: "localImage", path: "one.png" },
          { type: "localImage", path: "two.png" },
        ],
      },
    });
  });

  it.each([
    ["image", "localImage", "blue image.png", "image/png"],
    ["file", "localFile", "report.pdf", "application/pdf"],
  ] as const)(
    "uploads CLI-local %s bytes to the thread project before queueing",
    async (flag, type, filename, mimeType) => {
      const dir = await mkdtemp(join(tmpdir(), "bb-queue-attachment-"));
      try {
        const path = join(dir, filename);
        const bytes = new Uint8Array([137, 80, 78, 71]);
        await writeFile(path, bytes);
        const get = vi.fn(async () => ({ projectId: "remote-project" }));
        const create = vi.fn(async () => queuedMessage({}));
        stubServerApi({
          "v1.threads.:id.$get": get,
          "v1.threads.:id.queued-messages.$post": create,
        });
        vi.mocked(globalThis.fetch).mockResolvedValue(
          new Response(
            JSON.stringify({
              type,
              path: "durable-token",
              name: filename,
              mimeType,
              sizeBytes: bytes.byteLength,
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );

        await runCommand(
          [
            "thread",
            "queue",
            "create",
            "thread-1",
            "review this",
            "--" + flag,
            path,
            "--" + flag,
            pathToFileURL(path).href,
          ],
          register,
        );

        expect(get).toHaveBeenCalledExactlyOnceWith({
          param: { id: "thread-1" },
        });
        expect(globalThis.fetch).toHaveBeenCalledExactlyOnceWith(
          "http://server/api/v1/projects/remote-project/attachments",
          expect.objectContaining({
            method: "POST",
            body: expect.any(FormData),
          }),
        );
        const body = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body;
        if (!(body instanceof FormData)) throw new Error("Missing upload body");
        const file = body.get("file");
        if (!(file instanceof File)) throw new Error("Missing uploaded file");
        expect(file.name).toBe(filename);
        expect(file.type).toBe(mimeType);
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
        expect(create).toHaveBeenCalledExactlyOnceWith({
          param: { id: "thread-1" },
          json: {
            input: [
              { type: "text", text: "review this", mentions: [] },
              { type, path: "durable-token" },
              { type, path: "durable-token" },
            ],
          },
        });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );

  it("does not enqueue the text when an attachment upload fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-queue-rejected-"));
    try {
      const path = join(dir, "blue.png");
      await writeFile(path, new Uint8Array([137, 80, 78, 71]));
      const create = vi.fn(async () => queuedMessage({}));
      stubServerApi({
        "v1.threads.:id.$get": vi.fn(async () => ({
          projectId: "remote-project",
        })),
        "v1.threads.:id.queued-messages.$post": create,
      });
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(JSON.stringify({ error: "Upload rejected" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      );

      await expect(
        runCommand(
          [
            "thread",
            "queue",
            "create",
            "thread-1",
            "keep together",
            "--image",
            path,
          ],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(globalThis.fetch).toHaveBeenCalledOnce();
      expect(create).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("shows agent and system senders in queued message rows", async () => {
    const list = vi.fn(async () => [
      queuedMessage({ id: "queued-user" }),
      queuedMessage({
        id: "queued-agent",
        initiator: "agent",
        senderThreadId: "thr_sender",
      }),
      queuedMessage({ id: "queued-system", initiator: "system" }),
    ]);
    stubServerApi({ "v1.queued-messages.$get": list });

    await runCommand(["thread", "queue", "list"], register);

    const output = vi
      .mocked(console.log)
      .mock.calls.map((args) => args.join(" "))
      .join("\n");
    expect(output).toContain("Sender");
    expect(output).toContain("thr_sender");
    expect(output).toContain("System");
  });

  it.each([false, true])(
    "shows failures and recovery commands in queue list (scoped: %s)",
    async (scoped) => {
      const failureReason =
        "The provider bridge is unavailable while the plugin is still building";
      const list = vi.fn(async () => [
        queuedMessage({
          waitingOn: { kind: "host-offline", hostName: "Michael-M4" },
          failureReason,
        }),
      ]);
      stubServerApi({
        [scoped
          ? "v1.threads.:id.queued-messages.$get"
          : "v1.queued-messages.$get"]: list,
      });
      await runCommand(
        ["thread", "queue", "list", ...(scoped ? ["thread-1"] : [])],
        register,
      );
      const output = vi
        .mocked(console.log)
        .mock.calls.map((args) => args.join(" "))
        .join("\n");
      expect(output).toContain(`Failed queued-1: ${failureReason}`);
      expect(output).toContain("bb thread queue send thread-1 queued-1");
      expect(output).not.toContain("waiting for Michael-M4 to reconnect");
    },
  );

  it("updates a queued message in place", async () => {
    const list = vi.fn(async () => [
      { id: "queued-1", updatedAt: 42 },
      { id: "queued-2", updatedAt: 43 },
    ]);
    const update = vi.fn(async () => ({ id: "queued-1" }));
    stubServerApi({
      "v1.threads.:id.queued-messages.$get": list,
      "v1.threads.:id.queued-messages.:queuedMessageId.$patch": update,
    });

    await runCommand(
      [
        "thread",
        "queue",
        "update",
        "thread-1",
        "queued-1",
        "revised task",
        "--file",
        "uploaded-spec.md",
        "--file",
        "uploaded-data.json",
        "--image",
        "mock-uploaded.png",
        "--image",
        "detail-uploaded.png",
      ],
      register,
    );

    expect(list).toHaveBeenCalledWith({ param: { id: "thread-1" } });
    expect(update).toHaveBeenCalledWith({
      param: { id: "thread-1", queuedMessageId: "queued-1" },
      json: {
        expectedUpdatedAt: 42,
        input: [
          { type: "text", text: "revised task", mentions: [] },
          { type: "localFile", path: "uploaded-spec.md" },
          { type: "localFile", path: "uploaded-data.json" },
          { type: "localImage", path: "mock-uploaded.png" },
          { type: "localImage", path: "detail-uploaded.png" },
        ],
      },
    });
    expect(list.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
  });

  it("rejects an update when the queued message is absent", async () => {
    const list = vi.fn(async () => [{ id: "queued-2", updatedAt: 43 }]);
    const update = vi.fn();
    stubServerApi({
      "v1.threads.:id.queued-messages.$get": list,
      "v1.threads.:id.queued-messages.:queuedMessageId.$patch": update,
    });

    await expect(
      runCommand(
        ["thread", "queue", "update", "thread-1", "queued-1", "revised"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(console.error).toHaveBeenCalledWith(
      "Error: Queued message queued-1 not found on thread thread-1.",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("reports when sending a queued message leaves it waiting", async () => {
    const send = vi.fn(async () => ({
      ok: true,
      delivery: "queued",
      queuedMessage: {
        waitingOn: { kind: "provisioning" },
        sendAt: null,
      },
    }));
    stubServerApi({
      "v1.threads.:id.queued-messages.:queuedMessageId.send.$post": send,
    });

    await runCommand(
      ["thread", "queue", "send", "thread-1", "queued-1", "--mode", "steer"],
      register,
    );

    expect(send).toHaveBeenCalledWith({
      param: { id: "thread-1", queuedMessageId: "queued-1" },
      json: { mode: "steer" },
    });
    expect(console.log).toHaveBeenCalledWith(
      "Queued message queued-1 is still queued (waiting for the workspace)",
    );
  });

  it("reorders pinned threads with explicit neighbors", async () => {
    const reorder = vi.fn(async () => []);
    stubServerApi({ "v1.threads.:id.pin-order.$patch": reorder });

    await runCommand(
      [
        "thread",
        "reorder-pinned",
        "thread-2",
        "--after",
        "thread-1",
        "--before",
        "thread-3",
      ],
      register,
    );

    expect(reorder).toHaveBeenCalledWith({
      param: { id: "thread-2" },
      json: {
        previousThreadId: "thread-1",
        nextThreadId: "thread-3",
      },
    });
  });
});
