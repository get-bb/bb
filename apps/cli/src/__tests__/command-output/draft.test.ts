import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Command } from "commander";
import { draftSchema } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { makeThread } from "../helpers/command-output-fixtures.js";
import { registerDraftCommands } from "../../commands/draft.js";

const draft = draftSchema.parse({
  id: "drf_cli_roundtrip",
  revision: 4,
  createdAt: 1,
  updatedAt: 2,
  content: {
    projectId: "proj_saved",
    sectionId: "section_saved",
    prompt: {
      text: "Original text",
      attachments: [
        {
          type: "localFile",
          path: "/uploads/notes.txt",
          name: "notes.txt",
          sizeBytes: 10,
        },
      ],
    },
    options: {
      providerId: "codex",
      model: "saved-model",
      reasoningLevel: "high",
      permissionMode: "auto",
      environment: { type: "reuse", environmentId: "env_saved" },
    },
  },
});

describe("bb draft commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerDraftCommands(program, () => "http://server");

  it("prints complete generated and caller-supplied identities for reuse", async () => {
    const ids = [
      "drf_c4f849da-569e-4822-bb8d-b143438b20b7",
      `drf_${"a".repeat(128)}`,
    ];
    stubServerApi({
      "v1.drafts.$get": vi.fn(async () => ({
        drafts: ids.map((id) => ({ ...draft, id })),
        nextOffset: null,
      })),
    });
    await runCommand(["draft", "list"], register);
    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    for (const id of ids) expect(output).toContain(id);
  });

  it("creates a retryable identity from a content file without losing composer choices", async () => {
    const post = vi.fn(async () => ({ id: draft.id, draft }));
    stubServerApi({ "v1.drafts.$post": post });
    const directory = await mkdtemp(join(process.cwd(), ".draft-command-"));
    try {
      const file = join(directory, "content.json");
      await writeFile(file, JSON.stringify(draft.content));
      await runCommand(
        ["draft", "create", "--id", draft.id, "--content-file", file, "--json"],
        register,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(post).toHaveBeenCalledWith({
      json: { id: draft.id, content: draft.content },
    });
    expect(JSON.parse(collectLogLines(vi.mocked(console.log))[0]!)).toEqual({
      id: draft.id,
      draft,
    });
  });

  it("acknowledges consumed identities without reporting that a draft was saved", async () => {
    const post = vi.fn(async () => ({ id: draft.id, draft: null }));
    stubServerApi({ "v1.drafts.$post": post });
    await runCommand(
      ["draft", "create", "--id", draft.id, "--text", "Retry"],
      register,
    );
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      `${draft.id} was already consumed or deleted.`,
    ]);
  });

  it("requires revisions before any mutation can run", async () => {
    for (const command of ["update", "delete", "submit"]) {
      const program = new Command();
      program.exitOverride();
      program.configureOutput({ writeErr: vi.fn() });
      register(program);
      await expect(
        program.parseAsync(["node", "bb", "draft", command, draft.id]),
      ).rejects.toMatchObject({
        code: "commander.missingMandatoryOptionValue",
      });
    }
  });

  it("preserves attachments, destination and options when replacing plain text", async () => {
    const content = {
      ...draft.content,
      prompt: { ...draft.content.prompt, text: "Replacement\ntext" },
    };
    const get = vi.fn(async () => draft);
    const patch = vi.fn(async () => ({ ...draft, revision: 5, content }));
    stubServerApi({ "v1.drafts.:id.$get": get, "v1.drafts.:id.$patch": patch });
    vi.stubEnv("BB_PROJECT_ID", "proj_unrelated");

    await runCommand(
      [
        "draft",
        "update",
        draft.id,
        "--expected-revision",
        "4",
        "--text",
        "Replacement\ntext",
        "--json",
      ],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: draft.id },
      json: { expectedRevision: 4, content },
    });
  });

  it("refuses a stale text edit before it can overwrite unseen draft content", async () => {
    const patch = vi.fn();
    stubServerApi({
      "v1.drafts.:id.$get": vi.fn(async () => ({ ...draft, revision: 5 })),
      "v1.drafts.:id.$patch": patch,
    });
    await expect(
      runCommand(
        [
          "draft",
          "update",
          draft.id,
          "--expected-revision",
          "4",
          "--text",
          "Unseen edit",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(patch).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Draft changed to revision 5",
    );
  });

  it("refuses to silently discard or misplace mentions during text-only edits", async () => {
    const patch = vi.fn();
    stubServerApi({
      "v1.drafts.:id.$get": vi.fn(async () => ({
        ...draft,
        content: {
          ...draft.content,
          prompt: {
            ...draft.content.prompt,
            mentions: [
              {
                start: 0,
                end: 8,
                resource: {
                  kind: "thread",
                  threadId: "thr_original",
                  label: "Original",
                },
              },
            ],
          },
        },
      })),
      "v1.drafts.:id.$patch": patch,
    });
    await expect(
      runCommand(
        [
          "draft",
          "update",
          draft.id,
          "--expected-revision",
          "4",
          "--text",
          "Replacement",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(patch).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "--content-file",
    );
  });

  it("uses complete replacement files without merging stale server state", async () => {
    const content = { ...draft.content, projectId: null, sectionId: null };
    const get = vi.fn();
    const patch = vi.fn(async () => ({ ...draft, revision: 5, content }));
    stubServerApi({ "v1.drafts.:id.$get": get, "v1.drafts.:id.$patch": patch });
    const directory = await mkdtemp(join(process.cwd(), ".draft-command-"));
    try {
      const file = join(directory, "content.json");
      await writeFile(file, JSON.stringify(content));
      await runCommand(
        [
          "draft",
          "update",
          draft.id,
          "--expected-revision",
          "4",
          "--content-file",
          file,
        ],
        register,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(get).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith({
      param: { id: draft.id },
      json: { expectedRevision: 4, content },
    });
  });

  it("keeps the server revision guard after the text-edit read", async () => {
    const patch = vi.fn(async () =>
      Response.json({ message: "Draft changed" }, { status: 409 }),
    );
    stubServerApi({
      "v1.drafts.:id.$get": vi.fn(async () => draft),
      "v1.drafts.:id.$patch": patch,
    });
    await expect(
      runCommand(
        [
          "draft",
          "update",
          draft.id,
          "--expected-revision",
          "4",
          "--text",
          "Replacement",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "HTTP 409",
    );
  });

  it("passes discovery filters and pagination without using thread context", async () => {
    const get = vi.fn(async () => ({ drafts: [draft], nextOffset: 12 }));
    stubServerApi({ "v1.drafts.$get": get });
    await runCommand(
      [
        "draft",
        "list",
        "--project",
        "proj_saved",
        "--query",
        "Original",
        "--include-empty",
        "--limit",
        "2",
        "--offset",
        "10",
        "--json",
      ],
      register,
    );
    expect(get).toHaveBeenCalledWith({
      query: {
        projectId: "proj_saved",
        query: "Original",
        includeEmpty: "true",
        limit: "2",
        offset: "10",
      },
    });
    expect(JSON.parse(collectLogLines(vi.mocked(console.log))[0]!)).toEqual({
      drafts: [draft],
      nextOffset: 12,
    });
  });

  it.each(["0", "-1", "1.5", "2x", "9007199254740992"])(
    "rejects invalid expected revision %s without calling the server",
    async (revision) => {
      const post = vi.fn();
      stubServerApi({ "v1.drafts.:id.submit.$post": post });
      await expect(
        runCommand(
          ["draft", "submit", draft.id, "--expected-revision", revision],
          register,
        ),
      ).rejects.toThrow("process.exit:1");
      expect(post).not.toHaveBeenCalled();
    },
  );

  it("submits as the CLI and retains newer edits in JSON output", async () => {
    const thread = {
      ...makeThread({
        id: "thr_submitted",
        projectId: "proj_saved",
        providerId: "codex",
      }),
      runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    };
    const newer = { ...draft, revision: 5 };
    const post = vi.fn(async () => ({ thread, draft: newer }));
    stubServerApi({ "v1.drafts.:id.submit.$post": post });
    await runCommand(
      ["draft", "submit", draft.id, "--expected-revision", "4", "--json"],
      register,
    );
    expect(post).toHaveBeenCalledWith({
      param: { id: draft.id },
      json: { expectedRevision: 4, origin: "cli" },
    });
    expect(JSON.parse(collectLogLines(vi.mocked(console.log))[0]!)).toEqual({
      thread,
      draft: newer,
    });
  });

  it("deletes only the requested revision with explicit noninteractive confirmation", async () => {
    const remove = vi.fn(async () => ({ id: draft.id, revision: 5 }));
    stubServerApi({ "v1.drafts.:id.$delete": remove });
    await runCommand(
      [
        "draft",
        "delete",
        draft.id,
        "--expected-revision",
        "4",
        "--yes",
        "--json",
      ],
      register,
    );
    expect(remove).toHaveBeenCalledWith({
      param: { id: draft.id },
      json: { expectedRevision: 4 },
    });
  });
});
