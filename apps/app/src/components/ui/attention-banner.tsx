import type { ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";

export function AttentionBanner({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 space-y-2 rounded-lg border border-warning-text/30 bg-warning-text/5 p-3 text-sm [overflow-wrap:anywhere]"
    >
      <h2 className="flex items-start gap-2 font-medium text-warning-text">
        <Icon
          name="AlertTriangle"
          className="mt-0.5 size-4 shrink-0"
          aria-hidden
        />
        {title}
      </h2>
      {children}
    </section>
  );
}
