import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { toast } from "sonner";
import {
  buildTypstPrintHtml,
  downloadBlob,
  printHtmlDocument,
  typstDocumentBaseName,
} from "../lib/typst-export.js";
import { splitTypstPages } from "../lib/typst-pages.js";

export interface TypstArtifactActionsProps {
  fileName: string;
  loadDocx?: () => Promise<Blob>;
  loadPdf: () => Promise<Uint8Array>;
  loadPngs: () => Promise<readonly Blob[]>;
  markdown?: string;
  svg: string;
}

function reportError(error: unknown): void {
  toast.error(error instanceof Error ? error.message : String(error));
}

export function TypstArtifactActions({
  fileName,
  loadDocx,
  loadPdf,
  loadPngs,
  markdown,
  svg,
}: TypstArtifactActionsProps) {
  const [busy, setBusy] = useState(false);
  const baseName = typstDocumentBaseName(fileName);

  const run = (task: () => Promise<void>): void => {
    setBusy(true);
    void task()
      .catch(reportError)
      .finally(() => {
        setBusy(false);
      });
  };

  const saveMarkdown = () =>
    run(async () => {
      if (markdown === undefined) return;
      downloadBlob(
        new Blob([markdown], { type: "text/markdown" }),
        `${baseName}.md`,
      );
    });

  const saveWord = () =>
    run(async () => {
      if (loadDocx === undefined) return;
      downloadBlob(await loadDocx(), `${baseName}.docx`);
    });

  const savePdf = () =>
    run(async () => {
      const pdf = await loadPdf();
      downloadBlob(
        new Blob([pdf.slice().buffer], { type: "application/pdf" }),
        `${baseName}.pdf`,
      );
    });

  const saveSvg = () =>
    run(async () => {
      downloadBlob(
        new Blob([svg], { type: "image/svg+xml" }),
        `${baseName}.svg`,
      );
    });

  const savePng = () =>
    run(async () => {
      const pages = await loadPngs();
      pages.forEach((blob, index) => {
        downloadBlob(
          blob,
          pages.length === 1
            ? `${baseName}.png`
            : `${baseName}-${index + 1}.png`,
        );
      });
    });

  const print = () =>
    run(async () => {
      printHtmlDocument(
        buildTypstPrintHtml(splitTypstPages(svg), fileName),
      );
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={busy}
          aria-label={`Export ${fileName}`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name="Download" aria-hidden className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {markdown === undefined ? null : (
          <DropdownMenuItem onSelect={saveMarkdown}>
            Save Markdown
          </DropdownMenuItem>
        )}
        {loadDocx === undefined ? null : (
          <DropdownMenuItem onSelect={saveWord}>
            Word (.docx)
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={savePdf}>Save PDF</DropdownMenuItem>
        <DropdownMenuItem onSelect={saveSvg}>Save SVG</DropdownMenuItem>
        <DropdownMenuItem onSelect={savePng}>Save PNG</DropdownMenuItem>
        <DropdownMenuItem onSelect={print}>Печать</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
