import { useState, type ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { getNativeShell } from "@/lib/native-shell/native-shell";
import type { TerminalNavigationKey } from "./terminal-mobile-input";

interface TerminalMobileControlsProps {
  controlActive: boolean;
  disabled: boolean;
  onArrow: (key: TerminalNavigationKey) => void;
  onControlChange: (active: boolean) => void;
  onInput: (data: string) => void;
  onKeyboardToggle: () => void;
  onPaste: () => void;
}

function Key({
  label,
  children,
  onPress,
  active = false,
  toggle = false,
  disabled,
  className,
}: {
  label: string;
  children: ReactNode;
  onPress: () => void;
  active?: boolean;
  toggle?: boolean;
  disabled: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        const shell = getNativeShell();
        if (shell?.has("haptic"))
          shell.post({ type: "haptic", kind: "selection" });
        onPress();
      }}
      className={cn(
        "flex h-11 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg border border-border/50 bg-background font-mono text-xs font-medium text-foreground shadow-xs transition-colors active:bg-state-active focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40",
        active && "border-primary/40 bg-primary/10 text-primary",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TerminalMobileControls({
  controlActive,
  disabled,
  onArrow,
  onControlChange,
  onInput,
  onKeyboardToggle,
  onPaste,
}: TerminalMobileControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const keyProps = { disabled };
  return (
    <div
      role="group"
      aria-label="Terminal keyboard controls"
      data-terminal-mobile-controls=""
      className="shrink-0 border-t border-border bg-sidebar px-2 py-2"
    >
      {expanded ? (
        <div className="mb-2 flex gap-1">
          <Key
            {...keyProps}
            label="Interrupt (Control C)"
            onPress={() => onInput("\x03")}
          >
            ^C
          </Key>
          <Key
            {...keyProps}
            label="End of input (Control D)"
            onPress={() => onInput("\x04")}
          >
            ^D
          </Key>
          <Key {...keyProps} label="Home" onPress={() => onInput("\x1b[H")}>
            Home
          </Key>
          <Key {...keyProps} label="End" onPress={() => onInput("\x1b[F")}>
            End
          </Key>
          <Key {...keyProps} label="Paste" onPress={onPaste}>
            Paste
          </Key>
          <Key
            {...keyProps}
            label="Show or hide keyboard"
            onPress={onKeyboardToggle}
          >
            ⌨
          </Key>
        </div>
      ) : null}
      <div className="flex gap-1">
        <Key {...keyProps} label="Escape" onPress={() => onInput("\x1b")}>
          Esc
        </Key>
        <Key {...keyProps} label="Tab" onPress={() => onInput("\t")}>
          Tab
        </Key>
        <Key
          {...keyProps}
          label="Control for next key"
          toggle
          active={controlActive}
          onPress={() => onControlChange(!controlActive)}
        >
          Ctrl
        </Key>
        <div className="flex min-w-0 flex-[4] gap-1">
          <Key
            {...keyProps}
            label="Arrow left"
            onPress={() => onArrow("left")}
            className="text-base"
          >
            ←
          </Key>
          <Key
            {...keyProps}
            label="Arrow down"
            onPress={() => onArrow("down")}
            className="text-base"
          >
            ↓
          </Key>
          <Key
            {...keyProps}
            label="Arrow up"
            onPress={() => onArrow("up")}
            className="text-base"
          >
            ↑
          </Key>
          <Key
            {...keyProps}
            label="Arrow right"
            onPress={() => onArrow("right")}
            className="text-base"
          >
            →
          </Key>
        </div>
        <Key
          {...keyProps}
          label="Enter"
          onPress={() => onInput("\r")}
          className="border-primary/20 bg-primary/10 text-base text-primary"
        >
          ↵
        </Key>
        <Key
          {...keyProps}
          label="More terminal keys"
          toggle
          active={expanded}
          onPress={() => setExpanded(!expanded)}
        >
          ···
        </Key>
      </div>
    </div>
  );
}
