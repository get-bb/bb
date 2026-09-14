import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "./PromptStackCard";

export function ProviderRequirementBanner({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <PromptStackCard ariaLabel={title} className="@container overflow-hidden">
      <div
        role="alert"
        className="flex flex-col gap-2 px-3 py-2.5 @md:flex-row @md:items-center @md:gap-3"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon
            name="AlertTriangle"
            className="mt-0.5 size-3.5 shrink-0 text-warning-text"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">{title}</p>
            <p className="mt-0.5 text-xs leading-snug text-subtle-foreground">
              {description}
            </p>
          </div>
        </div>
        {action ? (
          <div className="min-w-0 shrink-0 [&>button]:w-full [&>button]:max-w-full [&>button]:truncate @md:[&>button]:w-auto">
            {action}
          </div>
        ) : null}
      </div>
    </PromptStackCard>
  );
}
