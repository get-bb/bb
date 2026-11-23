export interface WorkspaceFolderStatus {
  isGitRepo: boolean;
  path: string;
}

function describeRepository(folder: WorkspaceFolderStatus): string {
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
    `- Main folder (your working directory): ${mainFolder.path} (${describeRepository(mainFolder)})`,
    ...additionalFolders.map(
      (folder) =>
        `- Additional folder: ${folder.path} (${describeRepository(folder)})`,
    ),
    "You can read and write files in every folder listed here. Run git commands from inside the repository you mean to change.",
  ].join("\n");
}
