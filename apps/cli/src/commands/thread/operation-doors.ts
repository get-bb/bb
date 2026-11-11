import { JSON_FLAG_DESCRIPTION, arg, flag } from "../../cli-door.js";
import { clientCommand, publicCommand } from "../../operation-doors.js";
import { prependErrorContext } from "../helpers.js";

const SELF_DESCRIPTION = "Target the current thread (from BB_THREAD_ID)";

export const SELF_FLAG = flag("--self", SELF_DESCRIPTION);

export const SELF_TARGET = {
  self: flag("--self", SELF_DESCRIPTION, {
    context: { field: "id", from: "threadId" },
  }),
};

export const JSON_FLAG = flag("--json", JSON_FLAG_DESCRIPTION);

export const OPTIONAL_THREAD_ID = { id: arg("[id]") };

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export const threadSectionCommands = [
  publicCommand("threadSections.list", {
    path: ["thread", "section", "list"],
    summary: "List thread sections",
    print: (sections) => {
      if (sections.length === 0) return "No thread sections found";
      return sections.map((item) => `${item.id}\t${item.name}`).join("\n");
    },
  }),
  publicCommand("threadSections.create", {
    path: ["thread", "section", "create"],
    summary: "Create a thread section",
    positionals: { name: arg("<name>") },
    print: (result) => `Thread section ${result.id} created: ${result.name}`,
  }),
  publicCommand("threadSections.update", {
    path: ["thread", "section", "rename"],
    summary: "Rename a thread section",
    positionals: { id: arg("<id>"), name: arg("<name>") },
    print: (result) => `Thread section ${result.id} renamed: ${result.name}`,
  }),
];

export const threadArchiveCommands = [
  clientCommand({
    path: ["thread", "archive"],
    summary: "Archive a thread",
    positionals: OPTIONAL_THREAD_ID,
    options: { self: SELF_FLAG },
    run: async ({ positionals, options }, client) => {
      const threadId = client.threadId(positionals.id, options.self);
      let archivedThreadIds: string[];
      try {
        archivedThreadIds = (
          await client.call("threads.archiveAll", { id: threadId })
        ).archivedThreadIds;
      } catch (error: unknown) {
        throw prependErrorContext(`Failed to archive thread ${threadId}`, error);
      }
      const { archivedAt } = await client.call("threads.get", {
        id: threadId,
      });
      return {
        ok: true,
        threadId,
        alreadyArchived: !archivedThreadIds.includes(threadId),
        archivedAt,
        archivedThreadIds,
      };
    },
    print: ({ threadId, alreadyArchived, archivedAt, archivedThreadIds }) => {
      const headline = !alreadyArchived
        ? `Thread ${threadId} archived`
        : archivedAt === null
          ? `Thread ${threadId} was already archived`
          : `Thread ${threadId} was already archived at ${new Date(archivedAt).toLocaleString()}`;
      const cascaded = archivedThreadIds.filter(
        (archivedId) => archivedId !== threadId,
      ).length;
      if (cascaded === 0) return headline;
      return `${headline} (${plural(cascaded, "related thread")} ${alreadyArchived ? "" : "also "}archived)`;
    },
  }),
  publicCommand("threads.unarchive", {
    path: ["thread", "unarchive"],
    summary: "Unarchive a thread",
    positionals: OPTIONAL_THREAD_ID,
    options: SELF_TARGET,
    json: (_result, input) => ({ ok: true, threadId: input.id }),
    print: (_result, input) => `Thread ${input.id} unarchived`,
  }),
];

export const threadReadCommands = [
  publicCommand("threads.read", {
    path: ["thread", "read"],
    summary: "Mark a thread read",
    positionals: OPTIONAL_THREAD_ID,
    options: SELF_TARGET,
    print: (_result, input) => `Thread ${input.id} marked read`,
  }),
  publicCommand("threads.unread", {
    path: ["thread", "unread"],
    summary: "Mark a thread unread",
    positionals: OPTIONAL_THREAD_ID,
    options: SELF_TARGET,
    print: (_result, input) => `Thread ${input.id} marked unread`,
  }),
];
