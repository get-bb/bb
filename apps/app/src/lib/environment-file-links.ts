import type {
  ExperimentalFileLocation,
  ExperimentalFileOpenOptions,
} from "@get-bb/plugin-sdk";
import type { FilePreviewLineRange } from "@bb/client-core";
import { getRelativeHostPath } from "@bb/domain";
import type { MarkdownPreviewLocalFileLink } from "@/components/ui/markdown-local-file-link";

interface EnvironmentFileLinkArgs {
  environment: { hostId: string; id: string; path: string | null };
  link: MarkdownPreviewLocalFileLink;
}

export function toFileOpenLocation(
  lineRange: FilePreviewLineRange | null,
): ExperimentalFileLocation | null {
  return lineRange === null
    ? null
    : {
        kind: "range",
        startLine: lineRange.startLineNumber,
        endLine: lineRange.endLineNumber,
      };
}

export function environmentFileLinkOpenOptions({
  environment,
  link,
}: EnvironmentFileLinkArgs): ExperimentalFileOpenOptions {
  const relativePath =
    environment.path === null
      ? null
      : getRelativeHostPath({
          rootPath: environment.path,
          candidatePath: link.path,
        });
  return {
    target:
      relativePath === null || relativePath === ""
        ? { kind: "host", hostId: environment.hostId, path: link.path }
        : {
            kind: "workspace",
            environmentId: environment.id,
            path: relativePath,
          },
    location: toFileOpenLocation(link.lineRange),
  };
}
