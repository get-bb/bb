import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { managerTemplateNameSchema } from "@bb/domain";
import type {
  HostDaemonCommandResult,
  ManagerTemplateSummary,
} from "@bb/host-daemon-contract";
import type { CommandOf } from "../command-dispatch-support.js";
import { isFsErrorWithCode } from "../fs-errors.js";

const MANAGER_TEMPLATE_DIR_NAME = "manager-templates";
const ACTIVE_MANAGER_TEMPLATE_FILE_NAME = "active";
const DEFAULT_MANAGER_TEMPLATE_NAME = "default";

interface ListManagerTemplatesArgs {
  dataDir: string;
}

async function readActiveTemplateNameRaw(rootPath: string): Promise<string> {
  let activeContent: string;
  try {
    activeContent = await readFile(
      path.join(rootPath, ACTIVE_MANAGER_TEMPLATE_FILE_NAME),
      "utf8",
    );
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return DEFAULT_MANAGER_TEMPLATE_NAME;
    }
    throw error;
  }
  const firstLine = activeContent.split(/\r?\n/u)[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return DEFAULT_MANAGER_TEMPLATE_NAME;
  }
  const parsed = managerTemplateNameSchema.safeParse(firstLine);
  if (!parsed.success) {
    return DEFAULT_MANAGER_TEMPLATE_NAME;
  }
  return parsed.data;
}

async function listTemplateDirectoryNames(rootPath: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const names: string[] = [];
  for (const entry of entries) {
    // Match the seeding code's notion of "a template": a top-level real
    // directory under manager-templates/ with a name that satisfies the
    // schema. An empty directory is still a valid template — it suppresses
    // the bundled fallback during seeding, so it must surface in the picker.
    // Symlinks are excluded because `Dirent.isDirectory()` is false for them.
    if (!entry.isDirectory()) {
      continue;
    }
    const parsed = managerTemplateNameSchema.safeParse(entry.name);
    if (!parsed.success) {
      continue;
    }
    names.push(parsed.data);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export async function listManagerTemplates(
  args: ListManagerTemplatesArgs,
): Promise<HostDaemonCommandResult<"host.list_manager_templates">> {
  const rootPath = path.join(args.dataDir, MANAGER_TEMPLATE_DIR_NAME);
  const [names, rawActiveName] = await Promise.all([
    listTemplateDirectoryNames(rootPath),
    readActiveTemplateNameRaw(rootPath),
  ]);
  const templates: ManagerTemplateSummary[] = names.map((name) => ({ name }));
  // Active normalization keeps the contract self-consistent: if the pointer
  // names a syntactically valid template that isn't on disk, fall back to
  // "default" — the same fallback used for a missing/empty/invalid pointer.
  const activeName = names.includes(rawActiveName)
    ? rawActiveName
    : DEFAULT_MANAGER_TEMPLATE_NAME;
  return { templates, activeName };
}

export async function listManagerTemplatesCommand(
  _command: CommandOf<"host.list_manager_templates">,
  options: { dataDir: string },
): Promise<HostDaemonCommandResult<"host.list_manager_templates">> {
  return listManagerTemplates({ dataDir: options.dataDir });
}
