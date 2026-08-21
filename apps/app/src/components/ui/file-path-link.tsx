import { cn } from "@bb/shared-ui/lib/utils";
import { TruncateStart } from "./truncate-start.js";

interface FilePathLinkProps {
  path: string;
  /** Override the displayed text. Defaults to `path`. The `path` value is always used for the title tooltip. */
  displayName?: string;
  onClick?: () => void;
  className?: string;
}

export function FilePathLink({
  path,
  displayName,
  onClick,
  className,
}: FilePathLinkProps) {
  const baseClassName = "min-w-0 text-left text-xs leading-5";
  const text = displayName ?? path;

  if (!onClick) {
    return (
      <TruncateStart className={cn(baseClassName, className)} title={path}>
        {text}
      </TruncateStart>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        baseClassName,
        "inline-flex items-center gap-1 underline-offset-2 hover:underline",
        className,
      )}
      title={path}
      onClick={onClick}
    >
      <TruncateStart>{text}</TruncateStart>
    </button>
  );
}
