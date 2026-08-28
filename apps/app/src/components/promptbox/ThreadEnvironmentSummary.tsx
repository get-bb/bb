import { memo } from "react";
import { OptionDisplay } from "@bb/shared-ui/option-display";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";

const CHECKOUT_CHIP_BASE_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground";
const CHECKOUT_CHIP_BUTTON_CLASS_NAME = `${CHECKOUT_CHIP_BASE_CLASS_NAME} cursor-pointer transition-colors hover:bg-state-hover hover:text-foreground`;

interface ThreadEnvironmentSummaryProps {
  projectName?: string;
  environmentLabel?: string;
  environmentCompactLabel?: string;
  environmentIcon?: IconName;
  environmentCheckout?: WorkspaceCheckoutDisplay;
  onCreateNewThreadInWorktree?: () => void;
}

export const ThreadEnvironmentSummary = memo(function ThreadEnvironmentSummary({
  projectName,
  environmentLabel,
  environmentCompactLabel,
  environmentIcon,
  environmentCheckout,
  onCreateNewThreadInWorktree,
}: ThreadEnvironmentSummaryProps) {
  if (!environmentLabel) {
    return null;
  }

  const checkoutCopyValue = environmentCheckout?.copyValue ?? null;
  return (
    <div className="flex min-w-0 max-w-full items-center gap-2 pr-1.5">
      {projectName ? (
        <OptionDisplay
          label="Project"
          value={projectName}
          compactValue={projectName}
          leading={<Icon name="Folder" className="size-4 shrink-0" />}
          className="h-6 max-w-[10rem] shrink-0"
          title={`Project: ${projectName}`}
          muted
        />
      ) : null}
      <OptionDisplay
        label="Environment"
        value={environmentLabel}
        compactValue={environmentCompactLabel}
        leading={
          environmentIcon ? (
            <Icon name={environmentIcon} className="size-4 shrink-0" />
          ) : null
        }
        className="h-6 max-w-[10rem] shrink-0"
        title={`Environment: ${environmentLabel}`}
        muted
      />
      {environmentCheckout && checkoutCopyValue !== null ? (
        <button
          type="button"
          data-promptbox-hide-branch-compact=""
          className={CHECKOUT_CHIP_BUTTON_CLASS_NAME}
          title={environmentCheckout.title}
          onClick={() => {
            void copyToClipboardWithToast(checkoutCopyValue, {
              successMessage:
                environmentCheckout.copySuccessMessage ?? "Value copied",
              errorMessage:
                environmentCheckout.copyErrorMessage ?? "Failed to copy value",
            });
          }}
        >
          <Icon name="GitBranch" className="size-3.5 shrink-0" />
          <span className="truncate">{environmentCheckout.label}</span>
        </button>
      ) : environmentCheckout ? (
        <span
          data-promptbox-hide-branch-compact=""
          className={CHECKOUT_CHIP_BASE_CLASS_NAME}
          title={environmentCheckout.title}
        >
          <Icon name="GitBranch" className="size-3.5 shrink-0" />
          <span className="truncate">{environmentCheckout.label}</span>
        </span>
      ) : null}
      {onCreateNewThreadInWorktree ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Create new thread in this worktree"
              onClick={onCreateNewThreadInWorktree}
              className="-ml-1 inline-flex cursor-pointer shrink-0 items-center justify-center rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <Icon name="MessageSquarePlus" className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Create new thread in this worktree</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
});
