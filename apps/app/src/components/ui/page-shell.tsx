import type { ReactNode } from "react";
import { BottomAnchoredScrollBody } from "./bottom-anchored-scroll-body.js";
import { PAGE_SHELL_CONTENT_STYLE } from "./page-shell-content-style.js";
import { cn } from "@bb/shared-ui/lib/utils";
import { OverflowFade } from "@bb/shared-ui/overflow-fade";
import { TitleBarScrollFade } from "./title-bar-scroll-fade.js";

type PageShellScrollBehavior = "bottom-anchor" | "static";

interface PageShellBaseProps {
  children: ReactNode;
  footer?: ReactNode;
  scrollOverlay?: ReactNode;
  shellClassName?: string;
  scrollAreaClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
  maxWidthClassName?: string;
}

interface PageShellProps extends PageShellBaseProps {
  scrollBehavior?: PageShellScrollBehavior;
  scrollAnchorThreadId?: string;
  scrollContentInsetEndPx?: number;
}

interface FooterRenderOptions {
  maxWidthClassName: string;
  bottomPaddingClassName: string;
  footerClassName?: string;
}

const SHELL_BLEED_CLASS =
  "-mx-4 -mt-4 flex h-full min-h-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mt-5";
const STATIC_SHELL_BOTTOM_BLEED_CLASS =
  "-mb-[calc(1rem+var(--bb-content-bottom-inset,0px))] md:-mb-[calc(1.25rem+var(--bb-content-bottom-inset,0px))]";
const STATIC_CONTENT_BOTTOM_PADDING_CLASS =
  "pb-[calc(2rem+var(--bb-content-bottom-inset,0px))] md:pb-[calc(2.25rem+var(--bb-content-bottom-inset,0px))]";
const STATIC_FOOTER_BOTTOM_PADDING_CLASS =
  "pb-[calc(1rem+max(1rem,var(--bb-content-bottom-inset,0px)))] md:pb-[calc(1.25rem+max(1rem,var(--bb-content-bottom-inset,0px)))]";
const ANCHORED_FOOTER_BOTTOM_PADDING_CLASS =
  "pb-[max(0px,calc(1rem-var(--bb-content-bottom-inset,0px)))]";
const DEFAULT_MAX_WIDTH_CLASS = "max-w-[760px]";

function renderStaticFooter(
  footer: ReactNode,
  {
    maxWidthClassName,
    bottomPaddingClassName,
    footerClassName,
  }: FooterRenderOptions,
) {
  if (!footer) return null;
  return (
    <div className="relative shrink-0 bg-background">
      <OverflowFade placement="above" tone="background" />
      <div
        className={cn(
          "mx-auto w-full px-4",
          bottomPaddingClassName,
          maxWidthClassName,
          footerClassName,
        )}
      >
        {footer}
      </div>
    </div>
  );
}

export function PageShell({
  children,
  footer,
  scrollOverlay,
  shellClassName,
  scrollAreaClassName,
  contentClassName,
  footerClassName,
  maxWidthClassName = DEFAULT_MAX_WIDTH_CLASS,
  scrollBehavior = "static",
  scrollAnchorThreadId,
  scrollContentInsetEndPx,
}: PageShellProps) {
  if (scrollBehavior === "bottom-anchor") {
    const staticFooter = renderStaticFooter(footer, {
      maxWidthClassName,
      bottomPaddingClassName: ANCHORED_FOOTER_BOTTOM_PADDING_CLASS,
      footerClassName,
    });
    return (
      <div className={cn(SHELL_BLEED_CLASS, shellClassName)}>
        <BottomAnchoredScrollBody
          scrollAreaClassName={scrollAreaClassName}
          contentClassName={contentClassName}
          maxWidthClassName={maxWidthClassName}
          footer={staticFooter}
          scrollOverlay={scrollOverlay}
          scrollAnchorThreadId={scrollAnchorThreadId}
          contentInsetEndPx={scrollContentInsetEndPx}
        >
          {children}
        </BottomAnchoredScrollBody>
      </div>
    );
  }

  const staticFooter = renderStaticFooter(footer, {
    maxWidthClassName,
    bottomPaddingClassName: STATIC_FOOTER_BOTTOM_PADDING_CLASS,
    footerClassName,
  });
  return (
    <div
      className={cn(
        SHELL_BLEED_CLASS,
        STATIC_SHELL_BOTTOM_BLEED_CLASS,
        shellClassName,
      )}
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <TitleBarScrollFade tone="background" />
        <div
          data-page-scroll-viewport=""
          className={cn(
            "@container/page min-h-0 flex-1 overflow-y-auto",
            scrollAreaClassName,
          )}
        >
          <div
            className={cn(
              "mx-auto flex w-full flex-col px-4 pt-2",
              staticFooter ? "pb-4" : STATIC_CONTENT_BOTTOM_PADDING_CLASS,
              maxWidthClassName,
              contentClassName,
            )}
            style={PAGE_SHELL_CONTENT_STYLE}
          >
            {children}
          </div>
        </div>
        {staticFooter}
      </div>
    </div>
  );
}
