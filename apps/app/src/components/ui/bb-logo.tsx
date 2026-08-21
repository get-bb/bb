import { cn } from "@bb/shared-ui/lib/utils";
import bbLogoUrl from "../../../../../assets/bb-logo.svg";

/**
 * bb's own mark, for rows where bb is one listed thing among others — beside a
 * provider's logo in Updates, or beside a provider's skills in the tools list.
 * Decorative in every one of those places: the row already names it.
 */
export function BbLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src={bbLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}
