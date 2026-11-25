import { isHostPathWithin } from "@bb/domain";

export interface WorkspaceFolderStatus {
  exists: boolean;
  isGitRepo: boolean;
  path: string;
}

function describeFolder(folder: WorkspaceFolderStatus): string {
  if (!folder.exists) {
    return "missing on this machine, so you cannot use it this session";
  }
  return folder.isGitRepo ? "git repository" : "not a git repository";
}

export function renderWorkspaceFolderInstructions(
  folders: readonly WorkspaceFolderStatus[],
  reposInside: readonly string[],
): string | null {
  const [mainFolder, ...additionalFolders] = folders;
  if (
    mainFolder === undefined ||
    (additionalFolders.length === 0 && reposInside.length === 0)
  ) {
    return null;
  }
  const folderLines = (folder: WorkspaceFolderStatus, label: string) => [
    `- ${label}: ${folder.path} (${describeFolder(folder)})`,
    ...reposInside
      .filter((repoPath) =>
        isHostPathWithin({ rootPath: folder.path, candidatePath: repoPath }),
      )
      .map((repoPath) => `  - Git repository inside it: ${repoPath}`),
  ];
  return [
    "You are working across these folders:",
    ...folderLines(mainFolder, "Main folder (your working directory)"),
    ...additionalFolders.flatMap((folder) =>
      folderLines(folder, "Additional folder"),
    ),
    "You can read and write files in every folder listed here that is not missing. Run git commands from inside the repository you mean to change.",
  ].join("\n");
}
