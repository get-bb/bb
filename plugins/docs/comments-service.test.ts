import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createCommentsService } from "./comments-service.js";
import { commentsFileSchema, makeAnchor } from "./comments.js";
import { visibleMarkdown } from "./comment-text.js";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});
const hash = (content: string) =>
  createHash("sha256").update(content).digest("hex");
function setup() {
  const files = new Map([
    ["/vault/plan.md", "# Plan\n\nShip on November 12.\n"],
  ]);
  let beforeWrite: (() => void) | null = null;
  const sent: string[] = [];
  const host = createFakePluginHost({
    pluginId: "simple-notes",
    sdk: {
      threads: {
        send: async (args) => {
          for (const item of args.input)
            if (item.type === "text") sent.push(item.text);
          throw new Error("delivery captured");
        },
      },
      files: {
        read: async ({ path }) => {
          const content = files.get(path);
          if (content === undefined) throw new Error("ENOENT");
          return {
            path,
            content,
            contentEncoding: "utf8",
            sizeBytes: Buffer.byteLength(content),
            sha256: hash(content),
          };
        },
        write: async ({ path, content, expectedSha256 }) => {
          beforeWrite?.();
          const current = files.get(path);
          const currentSha256 = current === undefined ? null : hash(current);
          if (expectedSha256 !== currentSha256)
            return { outcome: "conflict", currentSha256 };
          files.set(path, content);
          return {
            outcome: "written",
            sha256: hash(content),
            sizeBytes: Buffer.byteLength(content),
          };
        },
      },
    },
  });
  disposers.push(() => host.harness.lifecycle.dispose());
  const service = createCommentsService(host.bb, async () => ({
    path: "/vault/plan.md",
    rootPath: "/vault",
    hostId: null,
  }));
  return {
    service,
    files,
    host,
    sent,
    race: (callback: (() => void) | null) => {
      beforeWrite = callback;
    },
  };
}
const target = { vaultId: "plans", path: "plan.md" };
const sidecar = "/vault/.bb-comments/plan.md.json";
describe("comment sidecar mutations", () => {
  it("merges competing creates without changing document bytes", async () => {
    const { service, files } = setup();
    const original = files.get("/vault/plan.md");
    await Promise.all([
      service.add(
        { ...target, quote: "November 12", body: "One" },
        service.user,
      ),
      service.add(
        { ...target, quote: "November 12", body: "Two" },
        service.user,
      ),
    ]);
    expect(
      (await service.list(target)).threads
        .map((thread) => thread.messages[0].body)
        .sort(),
    ).toEqual(["One", "Two"]);
    expect(files.get("/vault/plan.md")).toBe(original);
  });
  it("does not resurrect a deleted root when a concurrent reply retries", async () => {
    const { service, files, race } = setup();
    const added = await service.add(
      {
        ...target,
        quote: "November 12",
        body: "Question",
      },
      service.user,
    );
    race(() => {
      files.set(sidecar, JSON.stringify({ version: 1, threads: [] }));
      race(null);
    });
    await expect(
      service.reply(
        {
          ...target,
          commentId: added.threads[0].id,
          body: "Late answer",
        },
        service.user,
      ),
    ).rejects.toThrow("deleted");
    expect((await service.list(target)).threads).toHaveLength(0);
  });
  it("reads malformed sidecars as empty and fails closed on mutation", async () => {
    const { service, files } = setup();
    files.set(sidecar, "broken JSON");
    expect(await service.list(target)).toMatchObject({
      threads: [],
      notice: expect.stringContaining("malformed"),
    });
    await expect(
      service.add(
        { ...target, quote: "November 12", body: "Question" },
        service.user,
      ),
    ).rejects.toThrow("malformed");
    expect(files.get(sidecar)).toBe("broken JSON");
  });
  it("bounds CAS retries and returns the conflict exit code", async () => {
    const { service, files, race } = setup();
    let writes = 0;
    race(() => {
      writes++;
      files.set(
        sidecar,
        JSON.stringify({ version: 1, threads: [] }) + " ".repeat(writes),
      );
    });
    await expect(
      service.add(
        { ...target, quote: "November 12", body: "Question" },
        service.user,
      ),
    ).rejects.toMatchObject({ code: "conflict", exitCode: 3 });
    expect(writes).toBe(4);
  });
  it("keeps agent attribution and prevents user editing or deleting agent replies", async () => {
    const { service, files } = setup();
    const added = await service.add(
      {
        ...target,
        quote: "November 12",
        body: "Question",
      },
      service.user,
    );
    const commentId = added.threads[0].id;
    const replied = await service.reply(
      { ...target, commentId, body: "Answer" },
      { kind: "agent", threadId: "thr_agent", name: "Planner" },
    );
    const messageId = replied.threads[0].messages[1].id;
    await expect(
      service.edit({ ...target, commentId, messageId, body: "Changed" }),
    ).rejects.toThrow("author");
    await expect(
      service.delete({ ...target, commentId, messageId }),
    ).rejects.toThrow("author");
    expect(
      commentsFileSchema.parse(JSON.parse(files.get(sidecar)!)).threads[0]
        .messages[1].author,
    ).toMatchObject({ kind: "agent", threadId: "thr_agent" });
  });
  it("preserves orphan discussions through resolve and reopen", async () => {
    const { service, files } = setup();
    const added = await service.add(
      {
        ...target,
        quote: "November 12",
        body: "Question",
      },
      service.user,
    );
    const commentId = added.threads[0].id;
    files.set("/vault/plan.md", "# Replacement\n\nNew date.\n");
    expect(await service.list(target)).toMatchObject({
      threads: [],
      outsideChange: 1,
    });
    expect((await service.keep(target)).threads[0].anchor.state).toBe(
      "orphaned",
    );
    await service.status(
      { ...target, commentId, resolved: true },
      service.user,
    );
    await service.status(
      { ...target, commentId, resolved: false },
      service.user,
    );
    expect((await service.list(target)).threads[0]).toMatchObject({
      status: "open",
      anchor: { state: "orphaned", quote: "November 12" },
    });
  });
  it("never persists a refreshed anchor onto another sentence after a live external edit", async () => {
    const { service, files } = setup();
    const original =
      "# Plan\n\nIntro.\n\n---\n\nAfter dash rule target sentence.\n\n***\n\nAfter star rule target sentence.\n";
    files.set("/vault/plan.md", original);
    await service.add(
      { ...target, quote: "After dash rule target sentence.", body: "Dash" },
      service.user,
    );
    const star = await service.add(
      { ...target, quote: "After star rule target sentence.", body: "Star" },
      service.user,
    );
    const starId = star.threads.find(
      (thread) => thread.messages[0].body === "Star",
    )!.id;
    const edited = original
      .replace("Intro.", "Intro.\n\nInserted externally.")
      .replace(
        "After star rule target sentence.",
        "After star rule rewritten sentence.",
      );
    files.set("/vault/plan.md", edited);
    const text = visibleMarkdown(edited).text;
    const rewrittenStart = text.indexOf("After star rule rewritten sentence.");
    const refreshed = {
      ...target,
      documentSha256: hash(edited),
      anchors: [
        {
          id: starId,
          anchor: makeAnchor(
            text,
            rewrittenStart,
            rewrittenStart + "After star rule rewritten sentence.".length,
            hash(edited),
          ),
        },
      ],
    };
    await expect(service.refresh(refreshed)).rejects.toThrow("outside Docs");
    await service.keep(target);
    await service.refresh(refreshed);
    await service.reply(
      { ...target, commentId: starId, body: "Later reply" },
      service.user,
    );
    const stored = commentsFileSchema
      .parse(JSON.parse(files.get(sidecar)!))
      .threads.find((thread) => thread.id === starId)!;
    expect(stored.anchor.quote).toBe("After star rule target sentence.");
    expect(
      (await service.list(target)).threads.find(
        (thread) => thread.id === starId,
      )!.anchor.state,
    ).toBe("orphaned");
  });
  it("rejects comment IDs Docs did not generate", async () => {
    const { service, files } = setup();
    files.set(
      sidecar,
      JSON.stringify({
        version: 1,
        threads: [
          {
            id: "c_x'; touch /tmp/pwned; '",
            anchor: makeAnchor("Plan", 0, 4, "sha"),
            resolvedAt: null,
            resolvedBy: null,
            messages: [
              {
                id: "c_x'; touch /tmp/pwned; '",
                author: { kind: "user", name: "You" },
                body: "Injected",
                createdAt: "2026-10-19T00:00:00.000Z",
                editedAt: null,
                sentTo: [],
              },
            ],
          },
        ],
      }),
    );
    expect(await service.list(target)).toMatchObject({
      threads: [],
      notice: expect.stringContaining("malformed"),
    });
  });
  it.skipIf(process.platform === "win32")(
    "quotes every value in the generated reply command",
    async () => {
      const { service, sent } = setup();
      const path = "notes/it's; $(printf INJECTED) `printf TICK`.md";
      await service.add(
        {
          vaultId: "pl'ans; printf VAULT",
          path,
          quote: "November 12",
          body: "Please check @[Planner](thread:thr_planner)",
        },
        service.user,
      );
      const command = sent[0]!.match(/Reply with: (.*) '<your reply>'\./)![1]!;
      const output = execFileSync("sh", [
        "-c",
        `bb() { printf '%s\\n' "$@"; }; ${command} 'the reply'`,
      ]).toString();
      expect(output.split("\n").slice(0, -1)).toEqual([
        "docs",
        "comments",
        "reply",
        path,
        expect.stringMatching(/^c_[0-9a-f-]{36}$/),
        "--vault",
        "pl'ans; printf VAULT",
        "--body",
        "the reply",
      ]);
    },
  );
});
