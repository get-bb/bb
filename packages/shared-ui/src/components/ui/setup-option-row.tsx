import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Icon, type IconName } from "./icon";

export const SETUP_GUIDE_CONTAINER_CLASS = "@container/onboarding";
export const SETUP_OPTION_ICON_GUTTER_CLASS = "pl-8";
export const SETUP_OPTION_ICON_OUTDENT_CLASS = "-ml-8 mr-3 w-5";

export function SetupOptionRow({
  icon,
  title,
  description,
  action,
  actionStaysInline = false,
  panel,
  children,
  footer,
}: {
  icon: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  actionStaysInline?: boolean;
  panel?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <li>
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-3">
        <span className="row-start-1 flex h-6 items-center">
          <Icon
            name={icon}
            aria-hidden
            className="size-5 shrink-0 text-subtle-foreground"
          />
        </span>
        <span className="col-start-2 row-start-1 text-sm font-medium leading-6 text-foreground">
          {title}
        </span>
        {description === undefined ? null : (
          <div className="col-start-2 row-start-2 mt-1 text-xs text-muted-foreground">
            {description}
          </div>
        )}
        {action === undefined || action === null ? null : (
          <span
            className={cn(
              "col-start-3 row-span-2 row-start-1 flex items-center justify-end self-center",
              actionStaysInline
                ? "@max-xl/onboarding:row-span-1 @max-xl/onboarding:h-6 @max-xl/onboarding:self-start"
                : "@max-xl/onboarding:col-start-2 @max-xl/onboarding:row-span-1 @max-xl/onboarding:row-start-3 @max-xl/onboarding:mt-3 @max-xl/onboarding:justify-start",
            )}
          >
            {action}
          </span>
        )}
        {panel === undefined || panel === null ? null : (
          <div className="col-start-1 col-end-4 row-start-4 mt-3">{panel}</div>
        )}
        {children === undefined || children === null ? null : (
          <div className="col-start-2 col-end-4 row-start-5 mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
            {children}
          </div>
        )}
      </div>
      {footer}
    </li>
  );
}

export function SetupOptionGroup({
  label,
  labelHidden = false,
  children,
}: {
  label: string;
  labelHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h2
        className={cn(
          "px-3 text-xs font-medium text-subtle-foreground",
          labelHidden && "sr-only",
        )}
      >
        {label}
      </h2>
      <ul className="overflow-hidden rounded-lg border border-border">
        {children}
      </ul>
    </section>
  );
}
