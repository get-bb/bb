import type { IconName } from "@bb/shared-ui/icon";

export interface RightPanelFileVisual {
  iconName: IconName;
  label: string;
}

export interface ResolveRightPanelFileVisualArgs {
  path: string;
}

export interface GetFileNameFromPathArgs {
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

export function resolveRightPanelFileVisual({
  path,
}: ResolveRightPanelFileVisualArgs): RightPanelFileVisual {
  const extension = getFileExtension({ path });
  const inReports = hasPathDirectorySegment({ path, segment: "reports" });
  const inPlans = hasPathDirectorySegment({ path, segment: "plans" });
  const isMarkdown = extension === "md" || extension === "markdown";
  const isHtml = extension === "html" || extension === "htm";

  if (inReports && (isMarkdown || isHtml)) {
    return { iconName: "ChartColumn", label: "Report" };
  }
  if (isMarkdown) {
    return { iconName: "File", label: inPlans ? "Plan" : "Doc" };
  }
  if (isHtml) {
    return { iconName: "AppWindow", label: inPlans ? "Mockup" : "Preview" };
  }
  return { iconName: "Code", label: "Source" };
}
