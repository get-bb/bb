import type { registerHandlers } from "../api";
import { tasksRpcContract, type Task } from "../shared/contract";

type TasksDomain = ReturnType<typeof registerHandlers>;

export interface SeedDemoResult {
  foldersCreated: number;
  projectsCreated: number;
  labelsCreated: number;
  tasksCreated: number;
  commentsCreated: number;
  linkedBbProjectId: string | null;
  projects: Array<{ id: string; keyPrefix: string; name: string }>;
}

async function createTask(
  domain: TasksDomain,
  input: {
    projectId: string;
    title: string;
    description?: string;
    status?: Task["status"];
    priority?: Task["priority"];
    dueDate?: string | null;
    parentTaskId?: string | null;
    labelIds?: string[];
  },
): Promise<Task> {
  const parsed = tasksRpcContract.createTask.input.parse(input);
  const result = tasksRpcContract.createTask.output.parse(
    await domain.createTask(parsed),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.task;
}

function nextPrefix(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let number = 2; number < 10_000; number += 1) {
    const suffix = String(number);
    const candidate = `${base.slice(0, 10 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Could not allocate a demo prefix from ${base}`);
}

export async function seedDemo(
  domain: TasksDomain,
  linkedBbProjectId: string | undefined,
): Promise<SeedDemoResult> {
  const existing = tasksRpcContract.listProjects.output.parse(
    await domain.listProjects(tasksRpcContract.listProjects.input.parse({})),
  ).projects;
  const prefixes = new Set(existing.map((project) => project.prefix));

  const productFolder = tasksRpcContract.createFolder.output.parse(
    await domain.createFolder(
      tasksRpcContract.createFolder.input.parse({ name: "Product" }),
    ),
  ).folder;
  const lifeFolder = tasksRpcContract.createFolder.output.parse(
    await domain.createFolder(
      tasksRpcContract.createFolder.input.parse({ name: "Life" }),
    ),
  ).folder;

  const projects = [];
  for (const input of [
    {
      name: "Tasks Plugin",
      prefix: nextPrefix("TASKS", prefixes),
      color: "blue",
      folderId: productFolder.id,
      linkedBbProjectId: linkedBbProjectId ?? null,
    },
    {
      name: "Operations",
      prefix: nextPrefix("OPS", prefixes),
      color: "orange",
      folderId: productFolder.id,
      linkedBbProjectId: null,
    },
    {
      name: "Personal",
      prefix: nextPrefix("HOME", prefixes),
      color: "violet",
      folderId: lifeFolder.id,
      linkedBbProjectId: null,
    },
  ]) {
    projects.push(
      tasksRpcContract.createProject.output.parse(
        await domain.createProject(
          tasksRpcContract.createProject.input.parse(input),
        ),
      ).project,
    );
  }

  const labelSpecs = [
    [projects[0]!, "Backend", "blue"],
    [projects[0]!, "UX", "violet"],
    [projects[1]!, "Automation", "orange"],
    [projects[1]!, "Blocked", "red"],
    [projects[2]!, "Home", "green"],
    [projects[2]!, "Errand", "yellow"],
  ] as const;
  const labels = [];
  for (const [project, name, color] of labelSpecs) {
    labels.push(
      tasksRpcContract.createLabel.output.parse(
        await domain.createLabel(
          tasksRpcContract.createLabel.input.parse({
            projectId: project.id,
            name,
            color,
          }),
        ),
      ).label,
    );
  }

  const tasks: Task[] = [];
  const taskOne = await createTask(domain, {
    projectId: projects[0]!.id,
    title: "Polish the task detail panel",
    description: "Finish the detail view and verify markdown rendering.",
    status: "in_progress",
    priority: "urgent",
    dueDate: "2026-07-18",
    labelIds: [labels[1]!.id],
  });
  tasks.push(taskOne);
  tasks.push(
    await createTask(domain, {
      projectId: projects[0]!.id,
      title: "Add CLI smoke coverage",
      description: "Cover the canonical create, list, show, and update flow.",
      status: "in_review",
      priority: "high",
      labelIds: [labels[0]!.id],
    }),
  );
  tasks.push(
    await createTask(domain, {
      projectId: projects[0]!.id,
      title: "Document project linking",
      status: "todo",
      priority: "medium",
      parentTaskId: taskOne.id,
      labelIds: [labels[0]!.id, labels[1]!.id],
    }),
  );
  tasks.push(
    await createTask(domain, {
      projectId: projects[0]!.id,
      title: "Archive the old prototype notes",
      status: "done",
      priority: "low",
    }),
  );

  const opsParent = await createTask(domain, {
    projectId: projects[1]!.id,
    title: "Prepare the weekly release",
    description: "Coordinate checks, notes, and the rollout window.",
    status: "in_progress",
    priority: "high",
    dueDate: "2026-07-19",
    labelIds: [labels[2]!.id],
  });
  tasks.push(opsParent);
  tasks.push(
    await createTask(domain, {
      projectId: projects[1]!.id,
      title: "Confirm CI is green",
      status: "todo",
      priority: "urgent",
      parentTaskId: opsParent.id,
      labelIds: [labels[2]!.id],
    }),
  );
  tasks.push(
    await createTask(domain, {
      projectId: projects[1]!.id,
      title: "Rotate staging credentials",
      status: "backlog",
      priority: "medium",
      labelIds: [labels[3]!.id],
    }),
  );
  tasks.push(
    await createTask(domain, {
      projectId: projects[1]!.id,
      title: "Publish release notes",
      status: "done",
      priority: "low",
      labelIds: [labels[2]!.id],
    }),
  );

  const homeParent = await createTask(domain, {
    projectId: projects[2]!.id,
    title: "Plan the weekend reset",
    description: "A short list for getting the house back in shape.",
    status: "todo",
    priority: "medium",
    labelIds: [labels[4]!.id],
  });
  tasks.push(homeParent);
  tasks.push(
    await createTask(domain, {
      projectId: projects[2]!.id,
      title: "Pick up groceries",
      status: "todo",
      priority: "high",
      dueDate: "2026-07-17",
      parentTaskId: homeParent.id,
      labelIds: [labels[5]!.id],
    }),
  );
  tasks.push(
    await createTask(domain, {
      projectId: projects[2]!.id,
      title: "Repair the hallway shelf",
      status: "backlog",
      priority: "low",
      labelIds: [labels[4]!.id],
    }),
  );
  tasks.push(
    await createTask(domain, {
      projectId: projects[2]!.id,
      title: "Book a dentist appointment",
      status: "canceled",
      priority: "none",
      labelIds: [labels[5]!.id],
    }),
  );

  const comments = [
    [taskOne.id, "The main layout is ready for a final pass."],
    [tasks[1]!.id, "Keep JSON output stable for agent callers."],
    [opsParent.id, "Release window is tentatively Friday afternoon."],
    [homeParent.id, "Start with the kitchen and entryway."],
  ] as const;
  for (const [taskId, body] of comments) {
    await domain.createComment(
      tasksRpcContract.createComment.input.parse({
        taskId,
        body,
        notify: false,
      }),
    );
  }

  return {
    foldersCreated: 2,
    projectsCreated: projects.length,
    labelsCreated: labels.length,
    tasksCreated: tasks.length,
    commentsCreated: comments.length,
    linkedBbProjectId: linkedBbProjectId ?? null,
    projects: projects.map((project) => ({
      id: project.id,
      keyPrefix: project.prefix,
      name: project.name,
    })),
  };
}
