import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";

const INLINE_TEXT_LINK_CLASS =
  "rounded-sm text-foreground underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export const INLINE_CHIP_BUTTON_CLASS =
  "inline-flex items-center rounded-md px-1 py-0.5 text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
  caretWhenCollapsed = true,
  children,
  onToggle,
}: {
  expanded: boolean;
  leading?: ReactNode;
  caretWhenCollapsed?: boolean;
  children: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className={cn(
        INLINE_CHIP_BUTTON_CLASS,
        "gap-0.5",
        expanded && "bg-state-hover",
      )}
    >
      {leading}
      <span className="underline underline-offset-2">{children}</span>
      {expanded || caretWhenCollapsed ? (
        <Icon
          name={expanded ? "ChevronDown" : "ChevronRight"}
          aria-hidden
          className="size-3.5 text-subtle-foreground"
        />
      ) : null}
    </button>
  );
}

export function InlinePanel({
  hasBody = true,
  children,
  toggles,
  expanded,
}: {
  hasBody?: boolean;
  children: ReactNode;
  toggles?: ReactNode;
  expanded?: ReactNode;
}) {
  return (
    <div className="-mx-3 -mb-3 overflow-hidden border-t border-border-hairline bg-surface-recessed text-xs text-muted-foreground">
      {hasBody ? (
        <div className="flex flex-col gap-3 p-3">{children}</div>
      ) : null}
      {toggles === undefined ? null : (
        <div
          className={cn(
            "flex flex-wrap items-center justify-end gap-x-2 gap-y-1 px-2 py-1.5",
            hasBody && "border-t border-border-hairline",
          )}
        >
          {toggles}
        </div>
      )}
      {expanded === undefined || expanded === null ? null : (
        <div>{expanded}</div>
      )}
    </div>
  );
}

export function PendingStatus({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2">
      <Icon
        name="Spinner"
        aria-hidden
        className="size-3.5 shrink-0 animate-spin text-subtle-foreground"
      />
      {children}
    </p>
  );
}

export function PasteCodeForm({
  label,
  value,
  onChange,
  onSubmit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder="Paste the code here"
        autoComplete="off"
        spellCheck={false}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={value.trim().length === 0}
      >
        Complete
      </Button>
    </form>
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
  variant,
  toggles,
  expanded,
}: {
  status?: string;
  variant: SignInPanelVariant;
  toggles?: ReactNode;
  expanded?: ReactNode;
}) {
  return (
    <InlinePanel
      hasBody={status !== undefined || variant.kind !== "waiting"}
      toggles={toggles}
      expanded={expanded}
    >
      {status === undefined ? null : <PendingStatus>{status}</PendingStatus>}
      {variant.kind === "code" ? (
        <CodeDisplay
          code={variant.code}
          label={variant.label}
          copyLabel="Copy code"
          onCopy={variant.onCopyCode}
        />
      ) : variant.kind === "paste" ? (
        <PasteCodeForm
          label={variant.label}
          value={variant.value}
          onChange={variant.onChange}
          onSubmit={variant.onSubmit}
        />
      ) : null}
    </InlinePanel>
  );
}
