import path from "node:path";
import { randomUUID } from "node:crypto";
import { PluginCliError, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  commentAnchorSchema,
  commentIdSchema,
  commentMentions,
  commentsFileSchema,
  commentsListSchema,
  exactOccurrences,
  makeAnchor,
  resolveAnchor,
  type CommentAuthor,
  type CommentThread,
  type CommentsFile,
  type CommentsList,
} from "./comments.js";
import { visibleMarkdown } from "./comment-text.js";

export const commentSourceSchema = z
  .object({
    kind: z.enum(["workspace", "host", "thread-storage"]),
    threadId: z.string().nullable(),
    environmentId: z.string().nullable(),
    projectId: z.string().nullable(),
    experimental_hostId: z.string().min(1).optional(),
  })
  .strict();
export const commentTargetSchema = z
  .object({
    path: z.string().min(1),
    vaultId: z.string().min(1).optional(),
    source: commentSourceSchema.optional(),
  })
  .strict();
const threadInput = commentTargetSchema.extend({
  commentId: commentIdSchema,
});
const bodySchema = z.string().trim().min(1).max(50_000);
export const commentsContract = {
  listComments: {
    input: commentTargetSchema.extend({
      status: z.enum(["open", "resolved", "all"]).default("all"),
    }),
    output: commentsListSchema,
  },
  addComment: {
    input: commentTargetSchema.extend({
      quote: z.string().min(1),
      occurrence: z.number().int().positive().optional(),
      body: bodySchema,
    }),
    output: commentsListSchema,
  },
  replyComment: {
    input: threadInput.extend({ body: bodySchema }),
    output: commentsListSchema,
  },
  setCommentStatus: {
    input: threadInput.extend({ resolved: z.boolean() }),
    output: commentsListSchema,
  },
  editCommentMessage: {
    input: threadInput.extend({
      messageId: commentIdSchema,
      body: bodySchema,
    }),
    output: commentsListSchema,
  },
  deleteCommentMessage: {
    input: threadInput.extend({ messageId: commentIdSchema }),
    output: commentsListSchema,
  },
  refreshCommentAnchors: {
    input: commentTargetSchema.extend({
      documentSha256: z.string().min(1),
      anchors: z.array(
        z.object({ id: z.string().min(1), anchor: commentAnchorSchema }),
      ),
    }),
    output: commentsListSchema,
  },
  commentProjects: {
    input: z.object({}).strict(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  startCommentAgent: {
    input: threadInput.extend({ projectId: z.string().min(1) }),
    output: commentsListSchema,
  },
  commentThreads: {
    input: z.object({ query: z.string().max(200) }).strict(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
};
export type CommentTarget = z.infer<typeof commentTargetSchema>;
export type CommentFileTarget = {
  path: string;
  rootPath: string;
  hostId: string | null;
};
function pathApi(file: string): typeof path.posix | typeof path.win32 {
  return path.win32.isAbsolute(file) && !path.posix.isAbsolute(file)
    ? path.win32
    : path.posix;
}
export function commentSidecar(file: string): string {
  const api = pathApi(file);
  return api.join(
    api.dirname(file),
    ".bb-comments",
    `${api.basename(file)}.json`,
  );
}
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
function isMissing(error: unknown): boolean {
  return /\bENOENT\b|path does not exist|not found/i.test(String(error));
}
function emptyComments(): CommentsFile {
  return { version: 1, threads: [] };
}
function bound(data: CommentsFile, documentSha256: string): boolean {
  return !data.threads.length || data.document?.sha256 === documentSha256;
}
function fail(code: string, message: string): never {
  throw new PluginCliError(message, {
    code,
    exitCode: code === "conflict" ? 3 : 1,
  });
}
export function createCommentsService(
  bb: BbPluginApi,
  resolve: (input: CommentTarget) => Promise<CommentFileTarget>,
  serialize: <T>(input: CommentTarget, work: () => Promise<T>) => Promise<T> = (
    _input,
    work,
  ) => work(),
) {
  const user: CommentAuthor = { kind: "user", name: "You" };
  const fileArgs = (target: CommentFileTarget) => ({
    path: target.path,
    rootPath: target.rootPath,
    ...(target.hostId ? { hostId: target.hostId } : {}),
  });
  async function read(target: CommentFileTarget) {
    let file;
    try {
      file = await bb.sdk.files.read({
        ...fileArgs(target),
        path: commentSidecar(target.path),
      });
    } catch (error) {
      if (isMissing(error))
        return {
          data: emptyComments(),
          sha256: null,
          notice: null,
        };
      throw error;
    }
    try {
      return {
        data: commentsFileSchema.parse(JSON.parse(file.content)),
        sha256: file.sha256,
        notice: null,
      };
    } catch {
      return {
        data: emptyComments(),
        sha256: file.sha256,
        notice:
          "Comments couldn’t be read. The sidecar is malformed and has not been changed.",
      };
    }
  }
  async function list(
    input: CommentTarget & { status?: "open" | "resolved" | "all" },
    document?: { content: string; sha256: string },
  ): Promise<CommentsList> {
    const target = await resolve(input);
    const [saved, file] = await Promise.all([
      read(target),
      document ?? bb.sdk.files.read(fileArgs(target)),
    ]);
    const doc = visibleMarkdown(file.content);
    if (!bound(saved.data, file.sha256))
      return {
        sidecarSha256: saved.sha256,
        notice: saved.notice,
        threads: [],
        outsideChange: saved.data.threads.length,
        documentSha256: file.sha256,
      };
    return {
      sidecarSha256: saved.sha256,
      notice: saved.notice,
      outsideChange: 0,
      documentSha256: file.sha256,
      threads: saved.data.threads
        .map((thread) => ({
          ...thread,
          status: thread.resolvedAt ? ("resolved" as const) : ("open" as const),
          anchor: resolveAnchor(doc, file.sha256, thread.anchor),
        }))
        .filter(
          (thread) =>
            !input.status ||
            input.status === "all" ||
            input.status === thread.status,
        ),
    };
  }
  async function mutate(
    input: CommentTarget,
    operation: (data: CommentsFile, content: string, sha256: string) => void,
    keep = false,
  ) {
    return serialize(input, async () => {
      const target = await resolve(input);
      for (let attempt = 0; attempt < 4; attempt++) {
        const [saved, file] = await Promise.all([
          read(target),
          bb.sdk.files.read(fileArgs(target)),
        ]);
        if (saved.notice) fail("invalid_sidecar", saved.notice);
        if (!keep && !bound(saved.data, file.sha256))
          fail(
            "outside_change",
            "This document changed outside Docs. Keep or leave its comments first.",
          );
        const doc = visibleMarkdown(file.content);
        for (const thread of saved.data.threads) {
          const located = resolveAnchor(doc, file.sha256, thread.anchor);
          if (located.start !== null && located.end !== null)
            thread.anchor = makeAnchor(
              doc.text,
              located.start,
              located.end,
              file.sha256,
            );
        }
        operation(saved.data, file.content, file.sha256);
        saved.data.document = { sha256: file.sha256 };
        const result = await bb.sdk.files.write({
          ...fileArgs(target),
          path: commentSidecar(target.path),
          content: JSON.stringify(saved.data, null, 2) + "\n",
          contentEncoding: "utf8",
          createParents: true,
          expectedSha256: saved.sha256,
        });
        if (result.outcome === "conflict") continue;
        bb.realtime.publish("comments-changed", {
          vaultId: input.vaultId ?? null,
          path: input.path,
          source: input.source ?? null,
        });
        return list(input);
      }
      return fail(
        "conflict",
        "Comments changed concurrently. Try the operation again.",
      );
    });
  }
  async function rebind(
    input: CommentTarget,
    previousSha256: string | null,
    documentSha256: string,
  ) {
    if (previousSha256 === null || previousSha256 === documentSha256) return;
    await rebindFile(
      await resolve(input),
      input,
      previousSha256,
      documentSha256,
    );
  }
  async function rebindFile(
    target: CommentFileTarget,
    input: CommentTarget,
    previousSha256: string | null,
    documentSha256: string,
  ) {
    if (previousSha256 === null || previousSha256 === documentSha256) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const saved = await read(target);
      if (
        saved.sha256 === null ||
        saved.notice ||
        saved.data.document?.sha256 !== previousSha256
      )
        return;
      saved.data.document = { sha256: documentSha256 };
      const result = await bb.sdk.files.write({
        ...fileArgs(target),
        path: commentSidecar(target.path),
        content: JSON.stringify(saved.data, null, 2) + "\n",
        contentEncoding: "utf8",
        expectedSha256: saved.sha256,
      });
      if (result.outcome === "written") {
        bb.realtime.publish("comments-changed", {
          vaultId: input.vaultId ?? null,
          path: input.path,
          source: input.source ?? null,
        });
        return;
      }
    }
  }
  function thread(data: CommentsFile, id: string): CommentThread {
    return (
      data.threads.find((item) => item.id === id) ??
      fail(
        "comment_not_found",
        "This comment thread was deleted. Reload comments.",
      )
    );
  }
  function anchor(
    content: string,
    sha256: string,
    quote: string,
    occurrence?: number,
  ) {
    const doc = visibleMarkdown(content);
    const matches = exactOccurrences(doc.text, quote);
    if (!matches.length)
      fail(
        "quote_not_found",
        "The quote was not found in the saved document’s visible text.",
      );
    if (matches.length > 1 && occurrence === undefined)
      fail(
        "ambiguous_quote",
        `The quote occurs more than once. Pass --occurrence N: ${matches.map((start, i) => `${i + 1}: line ${doc.lines[start]}`).join(", ")}`,
      );
    const start = matches[(occurrence ?? 1) - 1];
    if (start === undefined)
      fail("quote_not_found", "That occurrence does not exist.");
    return makeAnchor(doc.text, start, start + quote.length, sha256);
  }
  async function author(threadId?: string): Promise<CommentAuthor> {
    if (!threadId) return user;
    const item = await bb.sdk.threads.get({ threadId });
    return {
      kind: "agent",
      threadId,
      name: item.title ?? item.titleFallback ?? threadId,
    };
  }
  function context(
    input: CommentTarget,
    id: string,
    quote: string,
    body: string,
    by: CommentAuthor,
  ) {
    const command = [
      "bb",
      "docs",
      "comments",
      "reply",
      input.path,
      id,
      ...(input.source
        ? ["--source", JSON.stringify(input.source)]
        : ["--vault", input.vaultId ?? "personal"]),
      "--body",
    ]
      .map(shellQuote)
      .join(" ");
    return `Docs comment by ${by.name}${by.kind === "agent" ? ` (thread:${by.threadId})` : ""}\nDocument: ${input.path}\n${input.source ? `Source: ${JSON.stringify(input.source)}` : `Vault: ${input.vaultId ?? "personal"}`}\nComment ID: ${id}\nQuote: ${quote}\n\n${body}\n\nReply with: ${command} '<your reply>'. Use bb docs propose for document changes; reply and resolve clear requests after proposing. Never edit .bb-comments directly.`;
  }
  async function deliver(
    input: CommentTarget,
    id: string,
    quote: string,
    body: string,
    by: CommentAuthor,
    result: CommentsList,
    messageId: string,
  ) {
    const failures: string[] = [];
    const sentTo: { id: string; name: string }[] = [];
    for (const mention of commentMentions(body)) {
      try {
        await bb.sdk.threads.send({
          threadId: mention.id,
          input: [
            {
              type: "text",
              text: context(input, id, quote, body, by),
              mentions: [],
            },
          ],
          mode: "queue-if-active",
          ...(by.kind === "agent" ? { senderThreadId: by.threadId } : {}),
        });
        sentTo.push(mention);
      } catch {
        failures.push(mention.name);
      }
    }
    if (sentTo.length)
      result = await mutate(input, (data) => {
        const item = data.threads
          .find((item) => item.id === id)
          ?.messages.find((item) => item.id === messageId);
        if (item) item.sentTo.push(...sentTo);
      });
    return failures.length
      ? {
          ...result,
          notice: `Comment saved, but could not send to ${failures.join(", ")}.`,
        }
      : result;
  }
  return {
    list,
    rebind,
    rebindFile,
    keep: (input: CommentTarget) => mutate(input, () => {}, true),
    author,
    user,
    async add(
      input: z.infer<typeof commentsContract.addComment.input>,
      by: CommentAuthor,
    ) {
      const id = `c_${randomUUID()}`;
      const message = {
        id,
        author: by,
        body: input.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        sentTo: [],
      };
      const result = await mutate(input, (data, content, sha256) => {
        data.threads.push({
          id,
          anchor: anchor(content, sha256, input.quote, input.occurrence),
          resolvedAt: null,
          resolvedBy: null,
          messages: [message],
        });
      });
      return deliver(
        input,
        id,
        input.quote,
        input.body,
        by,
        result,
        message.id,
      );
    },
    async reply(
      input: z.infer<typeof commentsContract.replyComment.input>,
      by: CommentAuthor,
    ) {
      const message = {
        id: `m_${randomUUID()}`,
        author: by,
        body: input.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        sentTo: [],
      };
      let quote = "";
      const result = await mutate(input, (data) => {
        const item = thread(data, input.commentId);
        quote = item.anchor.quote;
        item.messages.push(message);
      });
      return deliver(
        input,
        input.commentId,
        quote,
        input.body,
        by,
        result,
        message.id,
      );
    },
    status: (
      input: z.infer<typeof commentsContract.setCommentStatus.input>,
      by: CommentAuthor,
    ) =>
      mutate(input, (data) => {
        const item = thread(data, input.commentId);
        item.resolvedAt = input.resolved ? new Date().toISOString() : null;
        item.resolvedBy = input.resolved ? by : null;
      }),
    edit: (input: z.infer<typeof commentsContract.editCommentMessage.input>) =>
      mutate(input, (data) => {
        const message = thread(data, input.commentId).messages.find(
          (item) => item.id === input.messageId,
        );
        if (!message) fail("message_not_found", "This message was deleted.");
        if (message.author.kind !== "user")
          fail("not_author", "Only the author can edit a comment.");
        message.body = input.body;
        message.editedAt = new Date().toISOString();
      }),
    delete: (
      input: z.infer<typeof commentsContract.deleteCommentMessage.input>,
    ) =>
      mutate(input, (data) => {
        const item = thread(data, input.commentId);
        const message = item.messages.find(
          (candidate) => candidate.id === input.messageId,
        );
        if (!message) fail("message_not_found", "This message was deleted.");
        if (message.author.kind !== "user")
          fail("not_author", "Only the author can delete a comment.");
        if (item.messages[0].id === message.id)
          data.threads = data.threads.filter(
            (candidate) => candidate.id !== item.id,
          );
        else
          item.messages = item.messages.filter(
            (candidate) => candidate.id !== message.id,
          );
      }),
    refresh: (
      input: z.infer<typeof commentsContract.refreshCommentAnchors.input>,
    ) =>
      mutate(input, (data, content, sha256) => {
        if (sha256 !== input.documentSha256)
          fail(
            "conflict",
            "The document changed before its anchors could be refreshed.",
          );
        const doc = visibleMarkdown(content);
        for (const updated of input.anchors) {
          const item = data.threads.find(
            (candidate) => candidate.id === updated.id,
          );
          if (
            item &&
            updated.anchor.quote === item.anchor.quote &&
            updated.anchor.documentSha256 === sha256 &&
            doc.text.slice(updated.anchor.start, updated.anchor.end) ===
              updated.anchor.quote
          )
            item.anchor = updated.anchor;
        }
      }),
    async projects() {
      return (await bb.sdk.projects.list({ includePersonal: true })).map(
        (project) => ({ id: project.id, name: project.name }),
      );
    },
    async startAgent(
      input: z.infer<typeof commentsContract.startCommentAgent.input>,
    ) {
      const result = await list(input);
      const item = result.threads.find((item) => item.id === input.commentId);
      if (!item) fail("comment_not_found", "This comment thread was deleted.");
      const message = item.messages.at(-1)!;
      const agent = await bb.sdk.threads.spawn({
        projectId: input.projectId,
        environment: { type: "project-default" },
        title: `Feedback on ${path.basename(input.path)}`,
        prompt: context(
          input,
          item.id,
          item.anchor.quote,
          message.body,
          message.author,
        ),
        origin: "plugin",
        originPluginId: "simple-notes",
      });
      return mutate(input, (data) => {
        const saved = data.threads
          .find((candidate) => candidate.id === item.id)
          ?.messages.find((candidate) => candidate.id === message.id);
        if (saved)
          saved.sentTo.push({
            id: agent.id,
            name: agent.title ?? agent.titleFallback ?? agent.id,
          });
      });
    },
    async suggestions(query: string) {
      const items =
        query.trim().length < 2
          ? await bb.sdk.threads.list({ archived: false, limit: 10 })
          : (
              await bb.sdk.threads.search({ query, limitPerGroup: "10" })
            ).active.results.map((result) => result.thread);
      return items.map((item) => ({
        id: item.id,
        name: item.title ?? item.titleFallback ?? item.id,
      }));
    },
  };
}
