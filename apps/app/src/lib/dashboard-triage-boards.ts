export const TRIAGE_BOARD_FILE_QUERY = "triage-board";

const TRIAGE_BOARD_FILE_PATTERN = /^triage-board-(\d{4}-\d{2}-\d{2})\.html$/;

export interface TriageBoardFile {
  date: string;
  name: string;
  path: string;
}

interface ListedFile {
  name: string;
  path: string;
}

export function parseTriageBoardFiles(
  files: readonly ListedFile[],
): TriageBoardFile[] {
  return files
    .flatMap((file) => {
      const match = TRIAGE_BOARD_FILE_PATTERN.exec(file.name);
      return match?.[1]
        ? [{ date: match[1], name: file.name, path: file.path }]
        : [];
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function buildFilePreviewUrl(args: {
  baseUrl: string;
  filePath: string;
  origin: string;
}): string {
  const encodedPath = args.filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return new URL(`${args.baseUrl}/${encodedPath}`, args.origin).toString();
}
