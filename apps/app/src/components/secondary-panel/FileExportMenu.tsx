import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { appToast } from "@/components/ui/app-toast";
import {
  buildWordExport,
  downloadBlob,
  downloadTextFile,
  fileBaseName,
  printHtmlDocument,
  requestDocumentExport,
  type DocumentExportSourceKind,
} from "@/lib/document-export";

export interface FileExportTarget {
  baseHref: string | null;
  content: string;
  fileName: string;
  sourceKind: DocumentExportSourceKind;
}

export interface FileExportMenuProps {
  className?: string;
  target: FileExportTarget;
}

function reportError(error: unknown): void {
  appToast.error(error instanceof Error ? error.message : String(error));
}

export function FileExportMenu({ className, target }: FileExportMenuProps) {
  const baseName = fileBaseName(target.fileName);
  const sourceLabel = target.sourceKind === "markdown" ? "Markdown" : "HTML";
  const sourceExtension = target.sourceKind === "markdown" ? "md" : "html";
  const sourceMimeType =
    target.sourceKind === "markdown" ? "text/markdown" : "text/html";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          aria-label="Export file"
        >
          <Icon name="Download" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            downloadTextFile(
              target.content,
              sourceMimeType,
              `${baseName}.${sourceExtension}`,
            );
          }}
        >
          Save {sourceLabel}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void buildWordExport({
              baseHref: target.baseHref,
              content: target.content,
              filename: target.fileName,
              sourceKind: target.sourceKind,
            })
              .then((blob) => {
                downloadBlob(blob, `${baseName}.docx`);
              })
              .catch(reportError);
          }}
        >
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void requestDocumentExport({
              baseHref: target.baseHref,
              content: target.content,
              filename: target.fileName,
              format: "print",
              sourceKind: target.sourceKind,
            })
              .then(async (blob) => {
                printHtmlDocument(await blob.text());
              })
              .catch(reportError);
          }}
        >
          Печать
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
