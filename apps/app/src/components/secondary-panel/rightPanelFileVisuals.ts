import type { IconName } from "@bb/shared-ui/icon";

interface GetFileNameFromPathArgs {
  path: string;
}

interface HasPathDirectorySegmentArgs {
  path: string;
  segment: string;
}

interface GetFileExtensionArgs {
  path: string;
}

export function getFileNameFromPath({ path }: GetFileNameFromPathArgs): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function getFileExtension({ path }: GetFileExtensionArgs): string {
  const name = getFileNameFromPath({ path });
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

function hasPathDirectorySegment({
  path,
  segment,
}: HasPathDirectorySegmentArgs): boolean {
  return path.toLowerCase().split("/").slice(0, -1).includes(segment);
}

export function resolveRightPanelFileIconName(path: string): IconName {
  const extension = getFileExtension({ path });
  const inReports = hasPathDirectorySegment({ path, segment: "reports" });
  const isMarkdown = extension === "md" || extension === "markdown";
  const isHtml = extension === "html" || extension === "htm";

  if (inReports && (isMarkdown || isHtml)) {
    return "ChartColumn";
  }
  if (isMarkdown) {
    return "File";
  }
  if (isHtml) {
    return "AppWindow";
  }
  return "Code";
}
