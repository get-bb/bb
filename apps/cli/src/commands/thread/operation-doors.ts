import {
  JSON_FLAG_DESCRIPTION,
  type CliDoorOption,
  type CliDoorSelf,
  flag,
} from "@bb/operations";
import { publicCommand } from "../../operation-doors.js";

export const SELF_OPTION: CliDoorOption = flag(
  "--self",
  "Target the current thread (from BB_THREAD_ID)",
);

export const JSON_OPTION: CliDoorOption = flag("--json", JSON_FLAG_DESCRIPTION);

export const OPTIONAL_THREAD_ID = { name: "id", required: false } as const;

export function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

const SELF_THREAD: CliDoorSelf = {
  field: "id",
  from: "threadId",
  flag: "self",
  description: "Target the current thread (from BB_THREAD_ID)",
};

const THREAD_ID_POSITIONAL = {
  name: "id",
  field: "id",
  required: false,
} as const;

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
    positionals: [{ name: "name", field: "name" }],
    print: (result) => `Thread section ${result.id} created: ${result.name}`,
  }),
  publicCommand("threadSections.update", {
    path: ["thread", "section", "rename"],
    summary: "Rename a thread section",
    positionals: [
      { name: "id", field: "id" },
      { name: "name", field: "name" },
    ],
    print: (result) => `Thread section ${result.id} renamed: ${result.name}`,
  }),
];

export const threadArchiveCommands = [
  publicCommand("threads.archiveAll", {
    path: ["thread", "archive"],
    summary: "Archive a thread",
    positionals: [THREAD_ID_POSITIONAL],
    self: SELF_THREAD,
    json: (result, input) => ({
      ok: true,
      threadId: input.id,
      archivedThreadIds: result.archivedThreadIds,
    }),
    print: (result, input) => {
      const threadId = input.id;
      const cascaded = result.archivedThreadIds.filter(
        (archivedId) => archivedId !== threadId,
      ).length;
      if (cascaded === 0) return `Thread ${threadId} archived`;
      return `Thread ${threadId} archived (${plural(cascaded, "related thread")} also archived)`;
    },
    failure: (input) => `Failed to archive thread ${input.id}`,
  }),
  publicCommand("threads.unarchive", {
    path: ["thread", "unarchive"],
    summary: "Unarchive a thread",
    positionals: [THREAD_ID_POSITIONAL],
    self: SELF_THREAD,
    json: (_result, input) => ({ ok: true, threadId: input.id }),
    print: (_result, input) => `Thread ${input.id} unarchived`,
  }),
];

export const threadReadCommands = [
  publicCommand("threads.read", {
    path: ["thread", "read"],
    summary: "Mark a thread read",
    positionals: [THREAD_ID_POSITIONAL],
    self: SELF_THREAD,
    print: (_result, input) => `Thread ${input.id} marked read`,
  }),
  publicCommand("threads.unread", {
    path: ["thread", "unread"],
    summary: "Mark a thread unread",
    positionals: [THREAD_ID_POSITIONAL],
    self: SELF_THREAD,
    print: (_result, input) => `Thread ${input.id} marked unread`,
  }),
];
