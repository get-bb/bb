import type { ExperimentalThreadContextCardRowProps } from "@get-bb/plugin-sdk";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

const ACTION_REVEAL_CLASS =
  "relative hover:[&_[data-thread-context-card-row-trailing]]:invisible has-[:focus-visible]:[&_[data-thread-context-card-row-trailing]]:invisible has-[[data-state=open]]:[&_[data-thread-context-card-row-trailing]]:invisible hover:[&_[data-thread-context-card-row-action]]:opacity-100 has-[:focus-visible]:[&_[data-thread-context-card-row-action]]:opacity-100 has-[[data-state=open]]:[&_[data-thread-context-card-row-action]]:opacity-100";

const MAIN_CLASS =
  "flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-xs";

export function ThreadContextCardRow({
  icon,
  leading,
  label,
  trailing,
  title,
  disabled,
  action,
  onClick,
}: ExperimentalThreadContextCardRowProps) {
  const content = (
    <>
      {leading !== undefined ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground max-md:pointer-coarse:size-4 [&>*]:max-h-full [&>*]:max-w-full">
          {leading}
        </span>
      ) : icon !== undefined ? (
        <Icon
          name={icon}
          className="size-3.5 shrink-0 text-muted-foreground max-md:pointer-coarse:size-4"
          aria-hidden
        />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing === undefined ? null : (
        <span
          data-thread-context-card-row-trailing=""
          className="ml-auto flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground"
        >
          {trailing}
        </span>
      )}
    </>
  );
  const interactive = onClick !== undefined && !disabled;
  return (
    <div
      data-thread-context-card-row-frame=""
      className={cn(
        "flex h-6.5 w-full min-w-0 items-center rounded-md max-md:pointer-coarse:h-9",
        (interactive || action !== undefined) &&
          "hover:bg-state-hover has-[:focus-visible]:bg-state-hover",
        action !== undefined && ACTION_REVEAL_CLASS,
      )}
    >
      {onClick !== undefined ? (
        <button
          type="button"
          data-thread-context-card-row=""
          title={title}
          disabled={disabled}
          onClick={() => onClick()}
          className={cn(
            MAIN_CLASS,
            "cursor-pointer text-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {content}
        </button>
      ) : (
        <div
          data-thread-context-card-row=""
          title={title}
          className={cn(MAIN_CLASS, "text-muted-foreground")}
        >
          {content}
        </div>
      )}
      {action === undefined ? null : (
        <span
          data-thread-context-card-row-action=""
          className="absolute inset-y-0 right-0 flex items-center px-1 opacity-0 pointer-coarse:static pointer-coarse:opacity-100"
        >
          {action}
        </span>
      )}
    </div>
  );
}
