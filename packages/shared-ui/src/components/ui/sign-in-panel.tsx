import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";

const INLINE_TEXT_LINK_CLASS =
  "rounded-sm text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CodeDisplay({
  code,
  label,
  copyLabel,
  className,
  onCopy,
}: {
  code: string;
  label: string;
  copyLabel: string;
  className?: string;
  onCopy: (code: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-3",
        className,
      )}
    >
      <span
        aria-label={label}
        className="select-all font-mono text-xl font-semibold tracking-widest text-foreground"
      >
        {code}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={copyLabel}
        onClick={() => onCopy(code)}
      >
        <Icon name="Copy" aria-hidden />
      </Button>
    </div>
  );
}

function isPlainPrimaryClick(event: ReactMouseEvent<HTMLAnchorElement>) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey
  );
}

export function InlineTextLink({
  href,
  children,
  onOpen,
}: {
  href: string;
  children: ReactNode;
  onOpen?: (href: string) => boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={INLINE_TEXT_LINK_CLASS}
      onClick={(event) => {
        if (onOpen === undefined || !isPlainPrimaryClick(event)) return;
        if (onOpen(href)) event.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

export function InlineTextButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={INLINE_TEXT_LINK_CLASS}>
      {children}
    </button>
  );
}

export function QuietTextAction({
  icon,
  children,
  onClick,
}: {
  icon?: IconName;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {icon === undefined ? null : (
        <Icon name={icon} aria-hidden className="size-3.5" />
      )}
      <span className="underline underline-offset-2">{children}</span>
    </button>
  );
}

export function DisclosureToggle({
  expanded,
  leading,
  children,
  onToggle,
}: {
  expanded: boolean;
  leading?: ReactNode;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        expanded && "bg-state-hover",
      )}
    >
      {leading}
      <span className="underline underline-offset-2">{children}</span>
      <Icon
        name="ChevronDown"
        aria-hidden
        className={cn(
          "size-3.5 text-subtle-foreground transition-transform",
          expanded && "rotate-180",
        )}
      />
    </button>
  );
}

export function InlinePanel({
  children,
  toggles,
  expanded,
}: {
  children: ReactNode;
  toggles?: ReactNode;
  expanded?: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-surface-recessed text-xs text-muted-foreground">
      <div className="flex flex-col gap-3 p-3">{children}</div>
      {toggles === undefined ? null : (
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 border-t border-border-hairline px-2 py-1.5">
          {toggles}
        </div>
      )}
      {expanded === undefined || expanded === null ? null : (
        <div className="border-t border-border-hairline">{expanded}</div>
      )}
    </div>
  );
}

export type SignInPanelVariant =
  | {
      kind: "code";
      code: string;
      label: string;
      onCopyCode: (code: string) => void;
    }
  | {
      kind: "paste";
      label: string;
      value: string;
      onChange: (value: string) => void;
      onSubmit: () => void;
    }
  | { kind: "waiting" };

export function SignInPanel({
  status,
  instruction,
  variant,
  toggles,
  expanded,
}: {
  status: string;
  instruction?: ReactNode;
  variant: SignInPanelVariant;
  toggles?: ReactNode;
  expanded?: ReactNode;
}) {
  return (
    <InlinePanel toggles={toggles} expanded={expanded}>
      <p role="status" className="flex items-center gap-2">
        <Icon
          name="Spinner"
          aria-hidden
          className="size-3.5 shrink-0 animate-spin text-subtle-foreground"
        />
        {status}
      </p>
      {instruction === undefined ? null : (
        <p className="text-foreground">{instruction}</p>
      )}
      {variant.kind === "code" ? (
        <CodeDisplay
          code={variant.code}
          label={variant.label}
          copyLabel="Copy code"
          onCopy={variant.onCopyCode}
        />
      ) : variant.kind === "paste" ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            variant.onSubmit();
          }}
        >
          <input
            value={variant.value}
            onChange={(event) => variant.onChange(event.target.value)}
            aria-label={variant.label}
            placeholder="Paste the code here"
            autoComplete="off"
            spellCheck={false}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={variant.value.trim().length === 0}
          >
            Complete
          </Button>
        </form>
      ) : null}
    </InlinePanel>
  );
}
