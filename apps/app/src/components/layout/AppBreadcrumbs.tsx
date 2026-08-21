import { Link } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { MACOS_WINDOW_NO_DRAG_CLASS } from "@/lib/bb-desktop";

interface AppBreadcrumbSegment {
  label: string;
  to?: string;
}

export function AppBreadcrumbs({
  breadcrumbs,
  usesDesktopChrome,
}: {
  breadcrumbs: readonly AppBreadcrumbSegment[];
  usesDesktopChrome: boolean;
}) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        {breadcrumbs.map((segment, index) => {
          const isLast = index === breadcrumbs.length - 1;
          return (
            <li
              key={`${segment.label}-${index}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              {index > 0 ? (
                <Icon
                  name="ChevronRight"
                  className="size-3.5 shrink-0 text-subtle-foreground"
                />
              ) : null}
              {!isLast && segment.to ? (
                <Link
                  to={segment.to}
                  className={cn(
                    "-mx-2 inline-flex min-h-7 shrink-0 cursor-pointer items-center rounded-md px-2 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
                  )}
                >
                  {segment.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={
                    isLast
                      ? "min-w-0 truncate"
                      : "shrink-0 text-muted-foreground"
                  }
                >
                  {segment.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
