import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@bb/plugin-sdk";
import { z } from "zod";

import {
  publishCommentsChanged,
  registerHandlers,
  type TasksApiStore,
} from "../api";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  tasksRpcContract,
  type Folder,
  type Label,
  type Project,
  type Task,
  type TaskMutationResult,
} from "../shared/contract";
import {
  assertAllowed,
  CliError,
  option,
  options,
  parseArgs,
  requireOption,
  requirePositionals,
  type ParsedArgs,
} from "./args";
import { bytes, detail, json, table } from "./format";
import { seedDemo } from "./seed";

const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const TASK_KEY_PATTERN = /^([A-Z][A-Z0-9]{0,9})-(\d+)$/;
const ACTIVE_THREAD_STATUSES = new Set(["starting", "working"]);
const DEFAULT_PROJECT_COLOR = "blue";
const DEFAULT_LABEL_COLOR = "gray";

const ROOT_HELP = `Usage: bb tasks <command> [options]

Commands:
  status                         Show plugin status
  project create|list|show|update
  folder create|list|update
  create                         Create a task
  list                           List tasks
  show                           Show full task details
  update                         Update a task
  comment                        Add a task comment
  label create|list|delete

Run bb tasks <command> --help for command usage.`;

const PROJECT_HELP = `Usage:
  bb tasks project create --name <name> [--prefix X] [--folder <id-or-name>] [--link-bb-project <proj_id>] [--color <color>] [--json]
  bb tasks project list [--json]
  bb tasks project show <prefix-or-id> [--json]
  bb tasks project update <prefix-or-id> [--name <name>] [--color <color>] [--folder <id-or-name> | --no-folder] [--link-bb-project <proj_id> | --unlink-bb-project] [--rename-prefix X] [--json]`;

const FOLDER_HELP = `Usage:
  bb tasks folder create --name <name> [--parent <id-or-name>] [--json]
  bb tasks folder list [--json]
  bb tasks folder update <id-or-name> [--name <name>] [--parent <id-or-name> | --no-parent] [--json]`;

const CREATE_HELP =
  "Usage: bb tasks create [--project <prefix-or-id>] --title <title> [--description <markdown> | --description-file <path>] [--priority <priority>] [--label <name>]... [--due YYYY-MM-DD] [--parent <key-or-id>] [--json]";
const LIST_HELP =
  "Usage: bb tasks list [--project <prefix-or-id>] [--status <status>]... [--priority <priority>]... [--label <name>]... [--active] [--search <query>] [--json]";
const SHOW_HELP = "Usage: bb tasks show <key-or-id> [--json]";
const UPDATE_HELP =
  "Usage: bb tasks update <key-or-id> [--status <status>] [--priority <priority>] [--title <title>] [--description <markdown> | --description-file <path>] [--due YYYY-MM-DD | --no-due] [--add-label <name>]... [--remove-label <name>]... [--json]";
const COMMENT_HELP =
  "Usage: bb tasks comment <key-or-id> (--body <markdown> | --body-file <path>) [--author <name>] [--json]";
const LABEL_HELP = `Usage:
  bb tasks label create --project <prefix-or-id> --name <name> [--color <color>] [--json]
  bb tasks label list --project <prefix-or-id> [--json]
  bb tasks label delete --project <prefix-or-id> <name-or-id> [--json]`;

interface PluginStatus {
  name: string;
  version: string;
}

type TasksDomain = ReturnType<typeof registerHandlers>;

function normalizePrefix(value: string): string {
  return value.trim().toUpperCase();
}

function unwrapTask(result: TaskMutationResult): Task {
  if (!result.ok) throw new CliError(result.error.message);
  return result.task;
}

function readFileOption(
  args: ParsedArgs,
  ctx: PluginCliContext,
  inlineName: string,
  fileName: string,
): string | undefined {
  const inline = option(args, inlineName);
  const file = option(args, fileName);
  if (inline !== undefined && file !== undefined) {
    throw new CliError(`--${inlineName} and --${fileName} cannot be combined`);
  }
  if (file === undefined) return inline;
  const path = resolve(ctx.cwd ?? process.cwd(), file);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`could not read ${file}: ${message}`);
  }
}

function validateSingleFlagChoice(
  optionValue: string | undefined,
  flagSet: boolean,
  optionName: string,
  flagName: string,
): void {
  if (optionValue !== undefined && flagSet) {
    throw new CliError(`--${optionName} and --${flagName} cannot be combined`);
  }
}

function derivePrefix(name: string, projects: readonly Project[]): string {
  let base = name.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  if (!base || !/^[A-Z]/u.test(base)) base = `P${base}`;
  base = base.slice(0, 10);
  const used = new Set(projects.map((project) => project.prefix));
  if (!used.has(base)) return base;
  for (let number = 2; number < 10_000; number += 1) {
    const suffix = String(number);
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new CliError(`could not derive a unique prefix from ${name}`);
}

async function listProjects(domain: TasksDomain): Promise<Project[]> {
  return tasksRpcContract.listProjects.output.parse(
    await domain.listProjects(tasksRpcContract.listProjects.input.parse({})),
  ).projects;
}

async function resolveProject(
  domain: TasksDomain,
  address: string,
): Promise<Project> {
  const normalized = address.trim().toUpperCase();
  const projects = await listProjects(domain);
  const project = projects.find(
    (candidate) =>
      candidate.id === normalized || candidate.prefix === normalized,
  );
  if (!project) throw new CliError(`project not found: ${address}`);
  return project;
}

async function defaultProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  required: boolean,
): Promise<Project | undefined> {
  if (!ctx.projectId) {
    if (required) {
      throw new CliError(
        "missing --project and no BB project context is available",
      );
    }
    return undefined;
  }
  const matches = (await listProjects(domain)).filter(
    (project) => project.linkedBbProjectId === ctx.projectId,
  );
  if (matches.length === 0) {
    throw new CliError(
      `no tracker project is linked to BB project ${ctx.projectId}; pass --project or link one with bb tasks project update`,
    );
  }
  if (matches.length > 1) {
    throw new CliError(
      `multiple tracker projects are linked to BB project ${ctx.projectId}; pass --project explicitly`,
    );
  }
  return matches[0];
}

async function selectedProject(
  domain: TasksDomain,
  ctx: PluginCliContext,
  address: string | undefined,
  required: boolean,
): Promise<Project | undefined> {
  return address
    ? resolveProject(domain, address)
    : defaultProject(domain, ctx, required);
}

async function resolveFolder(
  domain: TasksDomain,
  address: string,
): Promise<Folder> {
  const folders = tasksRpcContract.listFolders.output.parse(
    await domain.listFolders(tasksRpcContract.listFolders.input.parse(null)),
  ).folders;
  const normalizedId = address.trim().toUpperCase();
  const byId = folders.find((folder) => folder.id === normalizedId);
  if (byId) return byId;
  const byName = folders.filter(
    (folder) => folder.name.toLowerCase() === address.trim().toLowerCase(),
  );
  if (byName.length === 0) throw new CliError(`folder not found: ${address}`);
  if (byName.length > 1) {
    throw new CliError(`folder name is ambiguous; use its id: ${address}`);
  }
  return byName[0]!;
}

async function resolveTask(
  domain: TasksDomain,
  address: string,
): Promise<Task> {
  const normalized = address.trim().toUpperCase();
  if (ULID_PATTERN.test(normalized)) {
    const result = tasksRpcContract.getTask.output.parse(
      await domain.getTask(
        tasksRpcContract.getTask.input.parse({ taskId: normalized }),
      ),
    );
    if (!result.task) throw new CliError(`task not found: ${address}`);
    return result.task;
  }
  if (!TASK_KEY_PATTERN.test(normalized)) {
    throw new CliError(`task not found: ${address}`);
  }
  const result = tasksRpcContract.listTasks.output.parse(
    await domain.listTasks(
      tasksRpcContract.listTasks.input.parse({ search: normalized }),
    ),
  );
  const task = result.tasks.find((candidate) => candidate.key === normalized);
  if (!task) throw new CliError(`task not found: ${address}`);
  return task;
}

async function projectLabels(
  domain: TasksDomain,
  projectId: string,
): Promise<Label[]> {
  return tasksRpcContract.listLabels.output.parse(
    await domain.listLabels(
      tasksRpcContract.listLabels.input.parse({ projectId }),
    ),
  ).labels;
}

function resolveLabel(labels: readonly Label[], address: string): Label {
  const normalizedId = address.trim().toUpperCase();
  const label = labels.find(
    (candidate) =>
      candidate.id === normalizedId ||
      candidate.name.toLowerCase() === address.trim().toLowerCase(),
  );
  if (!label) throw new CliError(`label not found: ${address}`);
  return label;
}

function projectTable(
  projects: readonly Project[],
  folders: readonly Folder[],
) {
  const folderNames = new Map(
    folders.map((folder) => [folder.id, folder.name]),
  );
  return table(
    ["PREFIX", "NAME", "FOLDER", "BB PROJECT", "ID"],
    projects.map((project) => [
      project.prefix,
      project.name,
      project.folderId
        ? (folderNames.get(project.folderId) ?? project.folderId)
        : "-",
      project.linkedBbProjectId ?? "-",
      project.id,
    ]),
    "No projects.",
  );
}

function taskAuthor(ctx: PluginCliContext): string {
  return ctx.threadId ? `agent (${ctx.threadId})` : "cli";
}

async function runProject(
  domain: TasksDomain,
  argv: string[],
): Promise<string> {
  const [action, ...rest] = argv;
  if (!action || action === "--help") return PROJECT_HELP;
  const args = parseArgs(rest);
  if (args.flags.has("help")) return PROJECT_HELP;

  if (action === "create") {
    assertAllowed(args, [
      "name",
      "prefix",
      "folder",
      "link-bb-project",
      "color",
    ]);
    requirePositionals(args, 0, PROJECT_HELP.split("\n")[1]!.trim());
    const name = requireOption(args, "name");
    const projects = await listProjects(domain);
    const folderAddress = option(args, "folder");
    const folder = folderAddress
      ? await resolveFolder(domain, folderAddress)
      : undefined;
    const result = tasksRpcContract.createProject.output.parse(
      await domain.createProject(
        tasksRpcContract.createProject.input.parse({
          name,
          prefix: option(args, "prefix")
            ? normalizePrefix(requireOption(args, "prefix"))
            : derivePrefix(name, projects),
          color: option(args, "color") ?? DEFAULT_PROJECT_COLOR,
          folderId: folder?.id ?? null,
          linkedBbProjectId: option(args, "link-bb-project") ?? null,
        }),
      ),
    );
    return args.flags.has("json")
      ? json(result)
      : `Created project ${result.project.prefix}  ${result.project.name}`;
  }

  if (action === "list") {
    assertAllowed(args, []);
    requirePositionals(args, 0, "bb tasks project list [--json]");
    const projects = await listProjects(domain);
    const folders = tasksRpcContract.listFolders.output.parse(
      await domain.listFolders(tasksRpcContract.listFolders.input.parse(null)),
    ).folders;
    return args.flags.has("json")
      ? json({ projects })
      : projectTable(projects, folders);
  }

  if (action === "show") {
    assertAllowed(args, []);
    const [address] = requirePositionals(
      args,
      1,
      "bb tasks project show <prefix-or-id> [--json]",
    );
    const project = await resolveProject(domain, address!);
    const folder = project.folderId
      ? await resolveFolder(domain, project.folderId)
      : null;
    if (args.flags.has("json")) return json({ project, folder });
    return detail([
      ["Project", `${project.prefix} — ${project.name}`],
      ["ID", project.id],
      ["Color", project.color],
      ["Folder", folder?.name ?? "-"],
      ["BB project", project.linkedBbProjectId ?? "-"],
      ["Next task", `${project.prefix}-${project.nextTaskNumber}`],
      ["Created", project.createdAt],
    ]);
  }

  if (action === "update") {
    assertAllowed(
      args,
      ["name", "color", "folder", "link-bb-project", "rename-prefix"],
      ["no-folder", "unlink-bb-project"],
    );
    const [address] = requirePositionals(
      args,
      1,
      "bb tasks project update <prefix-or-id> [options] [--json]",
    );
    const project = await resolveProject(domain, address!);
    const folderAddress = option(args, "folder");
    const linkedBbProjectId = option(args, "link-bb-project");
    validateSingleFlagChoice(
      folderAddress,
      args.flags.has("no-folder"),
      "folder",
      "no-folder",
    );
    validateSingleFlagChoice(
      linkedBbProjectId,
      args.flags.has("unlink-bb-project"),
      "link-bb-project",
      "unlink-bb-project",
    );
    const folder = folderAddress
      ? await resolveFolder(domain, folderAddress)
      : undefined;
    const changes = {
      name: option(args, "name"),
      color: option(args, "color"),
      folderId: args.flags.has("no-folder") ? null : folder?.id,
      linkedBbProjectId: args.flags.has("unlink-bb-project")
        ? null
        : linkedBbProjectId,
    };
    const renamePrefix = option(args, "rename-prefix");
    if (
      renamePrefix === undefined &&
      changes.name === undefined &&
      changes.color === undefined &&
      changes.folderId === undefined &&
      changes.linkedBbProjectId === undefined
    ) {
      throw new CliError("no project changes were provided");
    }
    let updated = project;
    if (renamePrefix !== undefined) {
      updated = unwrapTaskProject(
        tasksRpcContract.renameProjectPrefix.output.parse(
          await domain.renameProjectPrefix(
            tasksRpcContract.renameProjectPrefix.input.parse({
              projectId: project.id,
              prefix: normalizePrefix(renamePrefix),
            }),
          ),
        ),
      );
    }
    if (
      changes.name !== undefined ||
      changes.color !== undefined ||
      changes.folderId !== undefined ||
      changes.linkedBbProjectId !== undefined
    ) {
      updated = tasksRpcContract.updateProject.output.parse(
        await domain.updateProject(
          tasksRpcContract.updateProject.input.parse({
            projectId: project.id,
            ...changes,
          }),
        ),
      ).project;
    }
    return args.flags.has("json")
      ? json({ project: updated })
      : `Updated project ${updated.prefix}  ${updated.name}`;
  }

  throw new CliError(`unknown project subcommand: ${action}`);
}

function unwrapTaskProject(
  result: ReturnType<typeof tasksRpcContract.renameProjectPrefix.output.parse>,
): Project {
  if (!result.ok) throw new CliError(result.error.message);
  return result.project;
}

async function runFolder(domain: TasksDomain, argv: string[]): Promise<string> {
  const [action, ...rest] = argv;
  if (!action || action === "--help") return FOLDER_HELP;
  const args = parseArgs(rest);
  if (args.flags.has("help")) return FOLDER_HELP;

  if (action === "create") {
    assertAllowed(args, ["name", "parent"]);
    requirePositionals(
      args,
      0,
      "bb tasks folder create --name <name> [options]",
    );
    const parentAddress = option(args, "parent");
    const parent = parentAddress
      ? await resolveFolder(domain, parentAddress)
      : undefined;
    const result = tasksRpcContract.createFolder.output.parse(
      await domain.createFolder(
        tasksRpcContract.createFolder.input.parse({
          name: requireOption(args, "name"),
          parentFolderId: parent?.id ?? null,
        }),
      ),
    );
    return args.flags.has("json")
      ? json(result)
      : `Created folder ${result.folder.name}  ${result.folder.id}`;
  }

  if (action === "list") {
    assertAllowed(args, []);
    requirePositionals(args, 0, "bb tasks folder list [--json]");
    const result = tasksRpcContract.listFolders.output.parse(
      await domain.listFolders(tasksRpcContract.listFolders.input.parse(null)),
    );
    const names = new Map(
      result.folders.map((folder) => [folder.id, folder.name]),
    );
    return args.flags.has("json")
      ? json(result)
      : table(
          ["NAME", "PARENT", "ID"],
          result.folders.map((folder) => [
            folder.name,
            folder.parentFolderId
              ? (names.get(folder.parentFolderId) ?? folder.parentFolderId)
              : "-",
            folder.id,
          ]),
          "No folders.",
        );
  }

  if (action === "update") {
    assertAllowed(args, ["name", "parent"], ["no-parent"]);
    const [address] = requirePositionals(
      args,
      1,
      "bb tasks folder update <id-or-name> [options] [--json]",
    );
    const folder = await resolveFolder(domain, address!);
    const parentAddress = option(args, "parent");
    validateSingleFlagChoice(
      parentAddress,
      args.flags.has("no-parent"),
      "parent",
      "no-parent",
    );
    if (
      option(args, "name") === undefined &&
      parentAddress === undefined &&
      !args.flags.has("no-parent")
    ) {
      throw new CliError("no folder changes were provided");
    }
    let updated = folder;
    const name = option(args, "name");
    if (name !== undefined) {
      updated = tasksRpcContract.renameFolder.output.parse(
        await domain.renameFolder(
          tasksRpcContract.renameFolder.input.parse({
            folderId: folder.id,
            name,
          }),
        ),
      ).folder;
    }
    if (parentAddress !== undefined || args.flags.has("no-parent")) {
      const parent = parentAddress
        ? await resolveFolder(domain, parentAddress)
        : null;
      updated = tasksRpcContract.moveFolder.output.parse(
        await domain.moveFolder(
          tasksRpcContract.moveFolder.input.parse({
            folderId: folder.id,
            parentFolderId: parent?.id ?? null,
          }),
        ),
      ).folder;
    }
    return args.flags.has("json")
      ? json({ folder: updated })
      : `Updated folder ${updated.name}  ${updated.id}`;
  }

  throw new CliError(`unknown folder subcommand: ${action}`);
}

async function runCreate(
  domain: TasksDomain,
  ctx: PluginCliContext,
  argv: string[],
): Promise<string> {
  const args = parseArgs(argv);
  if (args.flags.has("help")) return CREATE_HELP;
  assertAllowed(args, [
    "project",
    "title",
    "description",
    "description-file",
    "priority",
    "label",
    "due",
    "parent",
  ]);
  requirePositionals(args, 0, CREATE_HELP);
  const project = await selectedProject(
    domain,
    ctx,
    option(args, "project"),
    true,
  );
  if (!project) throw new CliError("project is required");
  const labels = await projectLabels(domain, project.id);
  const labelIds = options(args, "label").map(
    (name) => resolveLabel(labels, name).id,
  );
  const parentAddress = option(args, "parent");
  const parent = parentAddress
    ? await resolveTask(domain, parentAddress)
    : undefined;
  const input = tasksRpcContract.createTask.input.parse({
    projectId: project.id,
    title: requireOption(args, "title"),
    description:
      readFileOption(args, ctx, "description", "description-file") ?? "",
    priority: option(args, "priority") ?? "none",
    dueDate: option(args, "due") ?? null,
    parentTaskId: parent?.id ?? null,
    labelIds,
  });
  const task = unwrapTask(
    tasksRpcContract.createTask.output.parse(await domain.createTask(input)),
  );
  return args.flags.has("json")
    ? json({ task })
    : `Created ${task.key}  ${task.title}`;
}

async function labelsForTaskList(
  domain: TasksDomain,
  projects: readonly Project[],
): Promise<Map<string, Label>> {
  const labels = new Map<string, Label>();
  for (const project of projects) {
    for (const label of await projectLabels(domain, project.id)) {
      labels.set(label.id, label);
    }
  }
  return labels;
}

async function runList(
  domain: TasksDomain,
  ctx: PluginCliContext,
  argv: string[],
): Promise<string> {
  const args = parseArgs(argv);
  if (args.flags.has("help")) return LIST_HELP;
  assertAllowed(
    args,
    ["project", "status", "priority", "label", "search"],
    ["active"],
  );
  requirePositionals(args, 0, LIST_HELP);
  const project = await selectedProject(
    domain,
    ctx,
    option(args, "project"),
    false,
  );
  const projects = project ? [project] : await listProjects(domain);
  const labelById = await labelsForTaskList(domain, projects);
  const requestedLabels = options(args, "label");
  const labelIds = requestedLabels.map((name) => {
    const matches = [...labelById.values()].filter(
      (label) => label.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (matches.length === 0) throw new CliError(`label not found: ${name}`);
    if (matches.length > 1 && !project) {
      throw new CliError(
        `label name exists in multiple projects; pass --project: ${name}`,
      );
    }
    return matches[0]!.id;
  });
  const result = tasksRpcContract.listTasks.output.parse(
    await domain.listTasks(
      tasksRpcContract.listTasks.input.parse({
        projectId: project?.id,
        statuses:
          options(args, "status").length > 0
            ? options(args, "status")
            : undefined,
        priorities:
          options(args, "priority").length > 0
            ? options(args, "priority")
            : undefined,
        labelIds: labelIds.length > 0 ? labelIds : undefined,
        activeOnly: args.flags.has("active"),
        search: option(args, "search"),
      }),
    ),
  );
  const tasks = [];
  for (const task of result.tasks) {
    const threadResult = tasksRpcContract.listTaskThreads.output.parse(
      await domain.listTaskThreads(
        tasksRpcContract.listTaskThreads.input.parse({ taskId: task.id }),
      ),
    );
    tasks.push({
      ...task,
      labels: task.labelIds.map((id) => labelById.get(id)?.name ?? id),
      agentsWorking: threadResult.taskThreads.filter((thread) =>
        ACTIVE_THREAD_STATUSES.has(thread.liveStatus),
      ).length,
    });
  }
  return args.flags.has("json")
    ? json({ tasks })
    : table(
        ["KEY", "STATUS", "PRIORITY", "TITLE", "LABELS", "AGENTS"],
        tasks.map((task) => [
          task.key,
          task.status,
          task.priority,
          task.title,
          task.labels.join(", ") || "-",
          task.agentsWorking,
        ]),
        "No tasks.",
      );
}

async function runShow(domain: TasksDomain, argv: string[]): Promise<string> {
  const args = parseArgs(argv);
  if (args.flags.has("help")) return SHOW_HELP;
  assertAllowed(args, []);
  const [address] = requirePositionals(args, 1, SHOW_HELP);
  const task = await resolveTask(domain, address!);
  const project = await resolveProject(domain, task.projectId);
  const allLabels = await projectLabels(domain, project.id);
  const labelById = new Map(allLabels.map((label) => [label.id, label]));
  const labels = task.labelIds.map((id) => labelById.get(id)!).filter(Boolean);
  const subtasks = tasksRpcContract.listTasks.output.parse(
    await domain.listTasks(
      tasksRpcContract.listTasks.input.parse({ parentTaskId: task.id }),
    ),
  ).tasks;
  const comments = tasksRpcContract.listComments.output.parse(
    await domain.listComments(
      tasksRpcContract.listComments.input.parse({ taskId: task.id }),
    ),
  ).comments;
  const directAttachments = tasksRpcContract.listAttachments.output.parse(
    await domain.listAttachments(
      tasksRpcContract.listAttachments.input.parse({ taskId: task.id }),
    ),
  ).attachments;
  const commentAttachments = [];
  for (const comment of comments) {
    commentAttachments.push(
      ...tasksRpcContract.listAttachments.output.parse(
        await domain.listAttachments(
          tasksRpcContract.listAttachments.input.parse({
            commentId: comment.id,
          }),
        ),
      ).attachments,
    );
  }
  const attachments = [...directAttachments, ...commentAttachments];
  const taskThreads = tasksRpcContract.listTaskThreads.output.parse(
    await domain.listTaskThreads(
      tasksRpcContract.listTaskThreads.input.parse({ taskId: task.id }),
    ),
  ).taskThreads;
  const payload = {
    task,
    project,
    labels,
    subtasks,
    attachments,
    taskThreads,
    comments,
  };
  if (args.flags.has("json")) return json(payload);

  const sections = [
    detail([
      ["Task", `${task.key} — ${task.title}`],
      ["ID", task.id],
      ["Project", `${project.prefix} — ${project.name}`],
      ["Status", task.status],
      ["Priority", task.priority],
      ["Due", task.dueDate ?? "-"],
      ["Parent", task.parentTaskId ?? "-"],
      ["Labels", labels.map((label) => label.name).join(", ") || "-"],
      ["Created", task.createdAt],
      ["Updated", task.updatedAt],
    ]),
    `Description\n${task.description || "(none)"}`,
    `Sub-tasks\n${table(
      ["KEY", "STATUS", "PRIORITY", "TITLE"],
      subtasks.map((subtask) => [
        subtask.key,
        subtask.status,
        subtask.priority,
        subtask.title,
      ]),
      "(none)",
    )}`,
    `Attachments\n${table(
      ["ID", "NAME", "SIZE"],
      attachments.map((attachment) => [
        attachment.id,
        attachment.fileName,
        bytes(attachment.sizeBytes),
      ]),
      "(none)",
    )}`,
    `Attached threads\n${table(
      ["THREAD", "STATUS", "PRESET", "TITLE"],
      taskThreads.map((thread) => [
        thread.threadId,
        thread.liveStatus,
        thread.presetName,
        thread.title,
      ]),
      "(none)",
    )}`,
    `Comments\n${table(
      ["TIME", "KIND", "AUTHOR", "BODY"],
      comments.map((comment) => [
        comment.createdAt,
        comment.kind,
        comment.authorName,
        comment.body,
      ]),
      "(none)",
    )}`,
  ];
  return sections.join("\n\n");
}

async function runUpdate(
  domain: TasksDomain,
  ctx: PluginCliContext,
  argv: string[],
): Promise<string> {
  const args = parseArgs(argv);
  if (args.flags.has("help")) return UPDATE_HELP;
  assertAllowed(
    args,
    [
      "status",
      "priority",
      "title",
      "description",
      "description-file",
      "due",
      "add-label",
      "remove-label",
    ],
    ["no-due"],
  );
  const [address] = requirePositionals(args, 1, UPDATE_HELP);
  const task = await resolveTask(domain, address!);
  const dueDate = option(args, "due");
  validateSingleFlagChoice(dueDate, args.flags.has("no-due"), "due", "no-due");
  const description = readFileOption(
    args,
    ctx,
    "description",
    "description-file",
  );
  const labels = await projectLabels(domain, task.projectId);
  const nextLabels = new Set(task.labelIds);
  for (const name of options(args, "add-label")) {
    nextLabels.add(resolveLabel(labels, name).id);
  }
  for (const name of options(args, "remove-label")) {
    nextLabels.delete(resolveLabel(labels, name).id);
  }
  const labelsChanged =
    options(args, "add-label").length > 0 ||
    options(args, "remove-label").length > 0;
  if (
    option(args, "status") === undefined &&
    option(args, "priority") === undefined &&
    option(args, "title") === undefined &&
    description === undefined &&
    dueDate === undefined &&
    !args.flags.has("no-due") &&
    !labelsChanged
  ) {
    throw new CliError("no task changes were provided");
  }
  const result = tasksRpcContract.updateTask.output.parse(
    await domain.updateTask(
      tasksRpcContract.updateTask.input.parse({
        taskId: task.id,
        status: option(args, "status"),
        priority: option(args, "priority"),
        title: option(args, "title"),
        description,
        dueDate: args.flags.has("no-due") ? null : dueDate,
        labelIds: labelsChanged ? [...nextLabels] : undefined,
        authorName: taskAuthor(ctx),
      }),
    ),
  );
  const updated = unwrapTask(result);
  return args.flags.has("json")
    ? json({ task: updated })
    : `Updated ${updated.key}  ${updated.title}`;
}

async function runComment(
  bb: BbPluginApi,
  store: TasksApiStore,
  domain: TasksDomain,
  ctx: PluginCliContext,
  argv: string[],
): Promise<string> {
  const args = parseArgs(argv);
  if (args.flags.has("help")) return COMMENT_HELP;
  assertAllowed(args, ["body", "body-file", "author"]);
  const [address] = requirePositionals(args, 1, COMMENT_HELP);
  const task = await resolveTask(domain, address!);
  const body = readFileOption(args, ctx, "body", "body-file");
  if (body === undefined)
    throw new CliError("missing required --body or --body-file");
  if (!body.trim()) throw new CliError("comment body must not be blank");
  const comment = store.tasks.createComment({
    taskId: task.id,
    kind: ctx.threadId ? "agent" : "user",
    authorName: option(args, "author") ?? taskAuthor(ctx),
    threadId: ctx.threadId ?? null,
    body,
    notifiedCount: 0,
  });
  publishCommentsChanged(bb, task.id);
  return args.flags.has("json")
    ? json({ comment })
    : `Commented on ${task.key}  ${comment.id}`;
}

async function runLabel(domain: TasksDomain, argv: string[]): Promise<string> {
  const [action, ...rest] = argv;
  if (!action || action === "--help") return LABEL_HELP;
  const args = parseArgs(rest);
  if (args.flags.has("help")) return LABEL_HELP;

  if (action === "create") {
    assertAllowed(args, ["project", "name", "color"]);
    requirePositionals(
      args,
      0,
      "bb tasks label create --project <project> --name <name>",
    );
    const project = await resolveProject(
      domain,
      requireOption(args, "project"),
    );
    const result = tasksRpcContract.createLabel.output.parse(
      await domain.createLabel(
        tasksRpcContract.createLabel.input.parse({
          projectId: project.id,
          name: requireOption(args, "name"),
          color: option(args, "color") ?? DEFAULT_LABEL_COLOR,
        }),
      ),
    );
    return args.flags.has("json")
      ? json(result)
      : `Created label ${result.label.name}  ${result.label.id}`;
  }

  if (action === "list") {
    assertAllowed(args, ["project"]);
    requirePositionals(args, 0, "bb tasks label list --project <project>");
    const project = await resolveProject(
      domain,
      requireOption(args, "project"),
    );
    const labels = await projectLabels(domain, project.id);
    return args.flags.has("json")
      ? json({ labels })
      : table(
          ["NAME", "COLOR", "ID"],
          labels.map((label) => [label.name, label.color, label.id]),
          "No labels.",
        );
  }

  if (action === "delete") {
    assertAllowed(args, ["project"]);
    const [address] = requirePositionals(
      args,
      1,
      "bb tasks label delete --project <project> <name-or-id>",
    );
    const project = await resolveProject(
      domain,
      requireOption(args, "project"),
    );
    const label = resolveLabel(
      await projectLabels(domain, project.id),
      address!,
    );
    const result = tasksRpcContract.deleteLabel.output.parse(
      await domain.deleteLabel(
        tasksRpcContract.deleteLabel.input.parse({ labelId: label.id }),
      ),
    );
    return args.flags.has("json")
      ? json({ ...result, label })
      : `Deleted label ${label.name}`;
  }

  throw new CliError(`unknown label subcommand: ${action}`);
}

function friendlyError(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return `${path}${issue?.message ?? "invalid input"}`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed: projects.prefix")) {
    return "project prefix is already in use";
  }
  if (
    message.includes("UNIQUE constraint failed: labels.project_id, labels.name")
  ) {
    return "label name is already in use in this project";
  }
  return message;
}

function singleLine(value: string): string {
  return value
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function registerTasksCli(
  bb: BbPluginApi,
  store: TasksApiStore,
  status: PluginStatus,
): void {
  const domain = registerHandlers(bb, store);
  bb.cli.register({
    name: "tasks",
    summary:
      "Create and manage task-tracker projects, tasks, labels, and comments",
    commands: [
      {
        name: "status",
        summary: "Show the Tasks plugin name and version",
        usage: "bb tasks status [--json]",
      },
      {
        name: "project",
        summary: "Create, list, show, or update tracker projects",
        usage: PROJECT_HELP,
      },
      {
        name: "folder",
        summary: "Create, list, or update project folders",
        usage: FOLDER_HELP,
      },
      {
        name: "create",
        summary: "Create a task",
        usage: CREATE_HELP,
      },
      {
        name: "list",
        summary: "List and filter tasks",
        usage: LIST_HELP,
      },
      {
        name: "show",
        summary: "Show full task details",
        usage: SHOW_HELP,
      },
      {
        name: "update",
        summary: "Update task fields and labels",
        usage: UPDATE_HELP,
      },
      {
        name: "comment",
        summary: "Add a markdown comment to a task",
        usage: COMMENT_HELP,
      },
      {
        name: "label",
        summary: "Create, list, or delete project labels",
        usage: LABEL_HELP,
      },
    ],
    async run(argv, ctx): Promise<PluginCliResult> {
      try {
        const [command, ...rest] = argv;
        if (!command || command === "--help" || command === "help") {
          return { exitCode: 0, stdout: ROOT_HELP };
        }
        let stdout: string;
        switch (command) {
          case "status": {
            const args = parseArgs(rest);
            assertAllowed(args, []);
            requirePositionals(args, 0, "bb tasks status [--json]");
            stdout = args.flags.has("json")
              ? JSON.stringify(status)
              : `${status.name} ${status.version}`;
            break;
          }
          case "project":
            stdout = await runProject(domain, rest);
            break;
          case "folder":
            stdout = await runFolder(domain, rest);
            break;
          case "create":
            stdout = await runCreate(domain, ctx, rest);
            break;
          case "list":
            stdout = await runList(domain, ctx, rest);
            break;
          case "show":
            stdout = await runShow(domain, rest);
            break;
          case "update":
            stdout = await runUpdate(domain, ctx, rest);
            break;
          case "comment":
            stdout = await runComment(bb, store, domain, ctx, rest);
            break;
          case "label":
            stdout = await runLabel(domain, rest);
            break;
          case "seed-demo": {
            const args = parseArgs(rest);
            assertAllowed(args, [], ["yes"]);
            requirePositionals(args, 0, "bb tasks seed-demo --yes [--json]");
            if (!args.flags.has("yes")) {
              throw new CliError(
                "seed-demo creates sample data; re-run with --yes",
              );
            }
            const result = await seedDemo(domain, ctx.projectId);
            stdout = args.flags.has("json")
              ? json(result)
              : detail([
                  ["Folders", result.foldersCreated],
                  ["Projects", result.projectsCreated],
                  ["Labels", result.labelsCreated],
                  ["Tasks", result.tasksCreated],
                  ["Comments", result.commentsCreated],
                  ["BB project", result.linkedBbProjectId ?? "-"],
                ]);
            break;
          }
          default:
            throw new CliError(
              `unknown command: ${command}; run bb tasks --help`,
            );
        }
        return { exitCode: 0, stdout };
      } catch (error) {
        return { exitCode: 1, stderr: singleLine(friendlyError(error)) };
      }
    },
  });
}

export { TASK_PRIORITIES, TASK_STATUSES };
