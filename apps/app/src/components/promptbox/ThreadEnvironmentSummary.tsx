import { memo } from "react";
import { OptionDisplay } from "@/components/pickers/OptionPicker";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { Icon, type IconName } from "@/components/ui/icon.js";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";

const CHECKOUT_CHIP_BASE_CLASS_NAME =
  "flex min-w-0 flex-1 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground";
const CHECKOUT_CHIP_BUTTON_CLASS_NAME = `${CHECKOUT_CHIP_BASE_CLASS_NAME} cursor-pointer transition-colors hover:bg-state-hover hover:text-foreground`;

export interface ThreadEnvironmentSummaryProps {
  /** Display name of the thread's project, shown alongside the environment. */
  projectName?: string;
  /** Full mode label used for the title (e.g. "Working locally" / "Worktree"). */
  environmentLabel?: string;
  /** Visible label used in the promptbox footer. */
  environmentCompactLabel?: string;
  /** Icon for the environment (e.g. monitor / git branch). */
  environmentIcon?: IconName;
  /** Live checkout label for this environment. Branch checkouts are copyable. */
  environmentCheckout?: WorkspaceCheckoutDisplay;
  /** When set, render a "new thread in this worktree" affordance beside the
   * environment label. Caller is responsible for only providing this when the
   * environment is a provisioned worktree. */
  onCreateNewThreadInWorktree?: () => void;
}

/**
 * Inline strip shown in the follow-up composer that describes the thread's
 * current environment: label and (when on a worktree) a copy-branch button.
 * Read-only — environment editing happens elsewhere.
 *
 * Responsive behavior:
 * - The visible environment label always uses the compact display string.
 * - The summary can shrink inside the follow-up strip so permission/context
 *   controls stay pinned and text truncates instead of wrapping.
 * - Branch chip hides only in very narrow promptbox shells and truncates
 *   within its available space above that breakpoint.
 */
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
  const visibleEnvironmentLabel = environmentCompactLabel ?? environmentLabel;

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
        value={visibleEnvironmentLabel}
        compactValue={visibleEnvironmentLabel}
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
        <button
          type="button"
          aria-label="Create new thread in this worktree"
          onClick={onCreateNewThreadInWorktree}
          className="-ml-1 inline-flex cursor-pointer shrink-0 items-center justify-center rounded-md px-1 py-0.5 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="MessageSquarePlus" className="size-4" />
        </button>
      ) : null}
    </div>
  );
});
