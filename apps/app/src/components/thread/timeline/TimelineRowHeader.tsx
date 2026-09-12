import type { CSSProperties, ReactNode } from "react";
import {
  COLLAPSIBLE_HEADER_STATIC_TONE_CLASS,
  CollapsibleHeader,
} from "../../ui/disclosure.js";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { PluginCompactIconMask } from "../../plugin/PluginIcon.js";

export type TimelineRowHorizontalPadding = "default" | "flush";

export const TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME = "min-w-0 max-w-full";
const TIMELINE_ROW_HEADER_CONTROL_CLASS_NAME =
  "flex w-full max-w-full justify-start py-0 leading-5";

interface TimelineStaticRowHeaderProps {
  children: ReactNode;
  className?: string;
  horizontalPadding?: TimelineRowHorizontalPadding;
}

interface TimelineLeadingIconProps {
  icon: IconName | undefined;
  fallback?: IconName;
  iconUrl: string | undefined;
  style: CSSProperties | undefined;
}

export function TimelineLeadingIcon({
  icon,
  fallback,
  iconUrl,
  style,
}: TimelineLeadingIconProps) {
  if (iconUrl !== undefined) {
    return (
      <PluginCompactIconMask
        url={iconUrl}
        className="size-3.5 text-muted-foreground"
        style={style}
      />
    );
  }
  if (icon) {
    return (
      <Icon
        name={icon}
        fallback={fallback}
        className="size-3.5 shrink-0 text-muted-foreground"
        style={style}
        aria-hidden
      />
    );
  }
  return null;
}

export function timelineRowHorizontalPaddingClassName(
  horizontalPadding: TimelineRowHorizontalPadding,
): string {
  switch (horizontalPadding) {
    case "default":
      return "px-2";
    case "flush":
      return "px-0";
  }
}

export function timelineRowHeaderClassName(
  horizontalPadding: TimelineRowHorizontalPadding,
): string {
  return cn(
    timelineRowHorizontalPaddingClassName(horizontalPadding),
    TIMELINE_ROW_HEADER_CONTROL_CLASS_NAME,
  );
}

export function TimelineStaticRowHeader({
  children,
  className,
  horizontalPadding = "default",
}: TimelineStaticRowHeaderProps) {
  return (
    <div className={cn("w-full rounded-md text-muted-foreground", className)}>
      <CollapsibleHeader
        toneClassName={COLLAPSIBLE_HEADER_STATIC_TONE_CLASS}
        className={timelineRowHeaderClassName(horizontalPadding)}
        summaryClassName={TIMELINE_ROW_HEADER_CONTENT_CLASS_NAME}
        summaryContent={children}
      />
    </div>
  );
}
