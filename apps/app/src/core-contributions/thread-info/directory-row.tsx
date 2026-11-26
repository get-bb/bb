import { useCallback } from "react";
import { toast } from "sonner";
import type { ExperimentalThreadInfoProps } from "@get-bb/plugin-sdk";
import {
  experimental_copyToClipboard as copyToClipboard,
  experimental_DetailRow as DetailRow,
  experimental_useEnvironment as useEnvironment,
} from "@get-bb/plugin-sdk/app";
import {
  CopyableInlineLabelView,
  useCopiedFeedback,
} from "@bb/shared-ui/copy-button";
import { formatHomePathForDisplay } from "@bb/shared-ui/lib/utils";
import { useFittedPathMiddle } from "@bb/shared-ui/truncate-path-middle";

function measureCopyIconWidth(container: HTMLElement): number {
  const label = container.querySelector("button");
  const icon = label?.querySelector("svg");
  if (!label || !icon) return 0;
  const gap = Number.parseFloat(getComputedStyle(label).columnGap);
  return icon.getBoundingClientRect().width + (Number.isNaN(gap) ? 0 : gap);
}

function DirectoryValue({ path }: { path: string }) {
  const { containerRef, fitted } = useFittedPathMiddle<HTMLDivElement>(
    formatHomePathForDisplay(path),
    measureCopyIconWidth,
  );
  const { copied, markCopied } = useCopiedFeedback();
  const copy = useCallback(async () => {
    if (copied) return;
    if (await copyToClipboard({ text: path })) {
      toast.success("Directory copied");
      markCopied();
    } else {
      toast.error("Failed to copy directory");
    }
  }, [copied, markCopied, path]);
  return (
    <DetailRow icon="FolderOpen" label="Directory">
      <div ref={containerRef} className="min-w-0">
        <CopyableInlineLabelView
          text={path}
          label="Copy directory"
          title={path}
          copied={copied}
          onCopy={() => {
            void copy();
          }}
        >
          <span className="text-muted-foreground">{fitted}</span>
        </CopyableInlineLabelView>
      </div>
    </DetailRow>
  );
}

export default function DirectoryRow({
  environment: threadEnvironment,
}: ExperimentalThreadInfoProps) {
  const { environment } = useEnvironment(threadEnvironment?.id ?? "");
  if (environment?.path == null) return null;
  return <DirectoryValue path={environment.path} />;
}
