import { useState, type ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import {
  ResourceDefinitionSection,
  ResourceDetailCollection,
  ResourceDetailIncludesSection,
  ResourceDetailPage,
  ResourceDetailPanel,
  ResourceDetailStack,
} from "@bb/shared-ui/resource-list";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { FilePreview } from "@/components/secondary-panel/FilePreview.js";
import { appToast } from "@/components/ui/app-toast";
import { ProvenancePill } from "@/components/tools/ProvenancePill";

export type SkillDetailTitleBadge = {
  label: string;
  tooltip: ReactNode;
  accessibleLabel?: string;
};

export type SkillDetailContentState =
  | { kind: "loading" }
  | { kind: "error"; message: string; onRetry: () => void }
  | { kind: "ready"; content: string };

export interface SkillDetailViewProps {
  leading?: ReactNode;
  title: string;
  path: string;
  pathHref?: string;
  titleBadge?: SkillDetailTitleBadge;
  /** Extra contextual actions displayed at the trailing edge of the header. */
  headerActions?: ReactNode;
  overflowMenu?: ReactNode;
  files: readonly string[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
  contentState: SkillDetailContentState;
  contentActions?: ReactNode;
  editor?: ReactNode;
  footer?: ReactNode;
}

export function SkillOwnershipBadge({
  label,
  tooltip,
  accessibleLabel,
}: {
  label: string;
  tooltip: ReactNode;
  accessibleLabel?: string;
}) {
  return (
    <ProvenancePill
      label={label}
      accessibleLabel={accessibleLabel}
      tooltip={tooltip}
    />
  );
}

function SkillPath({ path, href }: { path: string; href?: string }) {
  const [copied, setCopied] = useState(false);
  const displayPath = formatHomePathForDisplay(path);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      appToast.error("Failed to copy path.");
    }
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${path} in a new tab`}
              className="group -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="truncate font-mono">{displayPath}</span>
              <Icon
                name="ExternalLink"
                className="size-3 shrink-0"
                aria-hidden
              />
            </a>
          ) : (
            <button
              type="button"
              aria-label={`Copy skill path: ${path}`}
              onClick={copyPath}
              className="group -ml-1.5 inline-flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-xs text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="truncate font-mono">{displayPath}</span>
              <Icon
                name={copied ? "Check" : "Copy"}
                className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                aria-hidden
              />
            </button>
          )}
        </TooltipTrigger>
        <TooltipContent>
          {href ? "Open on skills.sh" : copied ? "Copied" : "Copy path"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function getSkillDirectoryPath(path: string): string {
  return path.replace(/[\\/]SKILL\.md$/i, "");
}

function SkillFileList({
  files,
  selectedPath,
  onSelectFile,
}: {
  files: readonly string[];
  selectedPath: string;
  onSelectFile: (path: string) => void;
}) {
  return (
    <ResourceDetailCollection className="max-h-48 overflow-auto">
      {files.map((path) => (
        <button
          key={path}
          type="button"
          aria-pressed={path === selectedPath}
          onClick={() => onSelectFile(path)}
          className="flex w-full min-w-0 items-center px-3 py-2 text-left font-mono text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground aria-pressed:bg-surface-recessed/45 aria-pressed:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="min-w-0 truncate">
            {formatHomePathForDisplay(path)}
          </span>
        </button>
      ))}
    </ResourceDetailCollection>
  );
}

export function SkillDetailView({
  leading,
  title,
  path,
  pathHref,
  titleBadge,
  headerActions,
  overflowMenu,
  files,
  selectedPath,
  onSelectFile,
  contentState,
  contentActions,
  editor,
  footer,
}: SkillDetailViewProps) {
  const directoryPath = getSkillDirectoryPath(path);
  const selectedDisplayPath = formatHomePathForDisplay(selectedPath);
  const selectedFileIsMarkdown = selectedPath.toLowerCase().endsWith(".md");
  const titleMeta =
    titleBadge === undefined ? undefined : (
      <SkillOwnershipBadge
        label={titleBadge.label}
        tooltip={titleBadge.tooltip}
        accessibleLabel={titleBadge.accessibleLabel}
      />
    );
  return (
    <ResourceDetailPage
      leading={leading}
      title={title}
      titleMeta={titleMeta}
      metadata={<SkillPath path={directoryPath} href={pathHref} />}
      overflowMenu={overflowMenu}
      actions={headerActions}
    >
      <ResourceDetailStack>
        {files.length > 1 && editor === undefined ? (
          <ResourceDetailIncludesSection label="Files">
            <SkillFileList
              files={files}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          </ResourceDetailIncludesSection>
        ) : null}

        <ResourceDefinitionSection
          label={selectedDisplayPath}
          actions={contentActions}
        >
          {editor ??
            (contentState.kind === "loading" ? (
              <ResourceDetailPanel
                surface="recessed"
                className="px-3 py-10 text-center text-sm text-muted-foreground"
              >
                Loading {selectedDisplayPath}…
              </ResourceDetailPanel>
            ) : contentState.kind === "error" ? (
              <ResourceDetailPanel
                surface="recessed"
                className="px-3 py-10 text-center text-sm"
              >
                <div
                  role="alert"
                  className="flex items-start justify-center gap-2 text-foreground"
                >
                  <Icon
                    name="CircleX"
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden
                  />
                  <p>{contentState.message}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={contentState.onRetry}
                >
                  Retry
                </Button>
              </ResourceDetailPanel>
            ) : (
              <ResourceDetailPanel
                surface="recessed"
                className={
                  selectedFileIsMarkdown
                    ? "shadow-none"
                    : "max-h-[60dvh] overflow-auto shadow-none"
                }
              >
                <FilePreview
                  path={selectedPath}
                  headerMode="none"
                  state={{
                    kind: "ready",
                    file: {
                      name: selectedPath.split("/").at(-1) ?? selectedPath,
                      contents: contentState.content,
                    },
                    lineRange: null,
                    textPreviewKind: selectedFileIsMarkdown ? "markdown" : null,
                  }}
                />
              </ResourceDetailPanel>
            ))}
        </ResourceDefinitionSection>
      </ResourceDetailStack>
      {footer}
    </ResourceDetailPage>
  );
}
