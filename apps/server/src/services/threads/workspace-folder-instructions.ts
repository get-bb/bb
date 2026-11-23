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
): string | null {
  const [mainFolder, ...additionalFolders] = folders;
  if (mainFolder === undefined || additionalFolders.length === 0) {
    return null;
  }
  return [
    "You are working across these folders:",
    `- Main folder (your working directory): ${mainFolder.path} (${describeFolder(mainFolder)})`,
    ...additionalFolders.map(
      (folder) =>
        `- Additional folder: ${folder.path} (${describeFolder(folder)})`,
    ),
    "You can read and write files in every folder listed here that is not missing. Run git commands from inside the repository you mean to change.",
  ].join("\n");
}
