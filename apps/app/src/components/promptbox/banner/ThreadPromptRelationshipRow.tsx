import { NavLink } from "react-router-dom";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PROMPT_STACK_INLAY_SEGMENT_CLASS } from "./PromptStackCard";

export function ThreadPromptRelationshipRow({
  icon,
  label,
  threadTitle,
  href,
  title,
}: {
  icon: IconName;
  label: string;
  threadTitle: string;
  href: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
      )}
      title={title}
    >
      <Icon name={icon} className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">
        {label}{" "}
        <NavLink
          to={href}
          className="text-foreground/90 underline underline-offset-2"
        >
          {threadTitle}
        </NavLink>
      </span>
    </div>
  );
}
