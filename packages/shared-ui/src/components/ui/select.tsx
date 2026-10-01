import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";

import { cn } from "../../lib/utils";
import { usePortalScopeProps } from "../../lib/portal-scope";
import { CONTROL_HOVER_TRANSITION } from "./motion.js";
import { Icon } from "../../components/ui/icon.js";
import { COARSE_POINTER_CHECK_SLOT_CLASS } from "./coarse-pointer-sizing.js";
import {
  COMPACT_SHEET_CONTENT_STYLE,
  ResponsiveDrawerShell,
  stripRadixContentProps,
  useResponsiveRoot,
} from "./responsive-overlay.js";
import {
  blurActiveKeyboardInputBeforeOverlayOpen,
  isLastInputKeyboard,
} from "./overlay-trigger.js";

const SELECT_OPEN_KEYS = new Set([" ", "Enter", "ArrowUp", "ArrowDown"]);
const ENABLED_OPTION_SELECTOR = '[role="option"]:not([aria-disabled="true"])';
const TYPEAHEAD_RESET_MS = 1000;

interface CompactSelectContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openFromTrigger: (trigger: HTMLButtonElement) => void;
  value: string;
  selectValue: (value: string) => void;
  listboxId: string;
  label: string;
}

const CompactSelectContext =
  React.createContext<CompactSelectContextValue | null>(null);
const CompactSelectListContext = React.createContext(false);
const CompactSelectGroupLabelContext = React.createContext<string | undefined>(
  undefined,
);

function useCompactSelectList(): CompactSelectContextValue | null {
  const compact = React.useContext(CompactSelectContext);
  const inList = React.useContext(CompactSelectListContext);
  return inList ? compact : null;
}

function readTriggerLabel(trigger: HTMLButtonElement | null): string {
  if (trigger === null) return "Options";
  const ariaLabel = trigger.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  const labelledBy = (trigger.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => trigger.ownerDocument.getElementById(id)?.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  if (labelledBy) return labelledBy;
  const labels = Array.from(trigger.labels ?? [])
    .map((label) => label.textContent?.trim())
    .filter(Boolean)
    .join(" ");
  return labels || "Options";
}

function Select({
  open: controlledOpen,
  defaultOpen,
  onOpenChange: controlledOnOpenChange,
  value: controlledValue,
  defaultValue,
  onValueChange,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const overlay = useResponsiveRoot(
    controlledOpen,
    controlledOnOpenChange,
    defaultOpen,
  );
  const [uncontrolledValue, setUncontrolledValue] = React.useState(
    defaultValue ?? "",
  );
  const isValueControlled = controlledValue !== undefined;
  const value = isValueControlled ? controlledValue : uncontrolledValue;
  const handleValueChange = React.useCallback(
    (next: string) => {
      if (!isValueControlled) setUncontrolledValue(next);
      onValueChange?.(next);
    },
    [isValueControlled, onValueChange],
  );
  const listboxId = React.useId();
  const [trigger, setTrigger] = React.useState<HTMLButtonElement | null>(null);
  const { isCompactViewport, open, onOpenChange } = overlay;

  const compact = React.useMemo<CompactSelectContextValue | null>(() => {
    if (!isCompactViewport) return null;
    return {
      open,
      onOpenChange,
      openFromTrigger: (element) => {
        blurActiveKeyboardInputBeforeOverlayOpen();
        element.focus({ preventScroll: true });
        setTrigger(element);
        onOpenChange(true);
      },
      value,
      selectValue: (next) => {
        if (next !== value) handleValueChange(next);
        onOpenChange(false);
      },
      listboxId,
      label: readTriggerLabel(trigger),
    };
  }, [
    handleValueChange,
    isCompactViewport,
    listboxId,
    onOpenChange,
    open,
    trigger,
    value,
  ]);

  return (
    <CompactSelectContext.Provider value={compact}>
      <SelectPrimitive.Root
        {...props}
        value={value}
        onValueChange={handleValueChange}
        open={!isCompactViewport && open}
        onOpenChange={onOpenChange}
      >
        {children}
      </SelectPrimitive.Root>
    </CompactSelectContext.Provider>
  );
}

const SelectGroup = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Group>
>((props, ref) => {
  const compact = useCompactSelectList();
  const labelId = React.useId();

  if (compact === null) {
    return <SelectPrimitive.Group ref={ref} {...props} />;
  }

  return (
    <CompactSelectGroupLabelContext.Provider value={labelId}>
      <div ref={ref} role="group" aria-labelledby={labelId} {...props} />
    </CompactSelectGroupLabelContext.Provider>
  );
});
SelectGroup.displayName = SelectPrimitive.Group.displayName;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(
  (
    { className, children, onClick, onKeyDown, onPointerDown, ...props },
    ref,
  ) => {
    const compact = React.useContext(CompactSelectContext);
    const compactProps =
      compact === null
        ? { onClick, onKeyDown, onPointerDown }
        : {
            "aria-expanded": compact.open,
            "aria-controls": compact.open ? compact.listboxId : undefined,
            "data-state": compact.open ? "open" : "closed",
            onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
              onPointerDown?.(event);
              if (event.pointerType === "mouse" && event.button === 0) {
                event.preventDefault();
              }
            },
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
              onClick?.(event);
              if (event.defaultPrevented) return;
              event.preventDefault();
              compact.openFromTrigger(event.currentTarget);
            },
            onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
              onKeyDown?.(event);
              if (event.defaultPrevented || !SELECT_OPEN_KEYS.has(event.key)) {
                return;
              }
              event.preventDefault();
              compact.openFromTrigger(event.currentTarget);
            },
          };

    return (
      <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
          `flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm ${CONTROL_HOVER_TRANSITION} placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1`,
          className,
        )}
        {...props}
        {...compactProps}
      >
        {children}
        <SelectPrimitive.Icon asChild>
          <Icon name="ChevronDown" className="size-4 opacity-50" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
    );
  },
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <Icon name="ChevronUp" className="size-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <Icon name="ChevronDown" className="size-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

function moveOptionFocus(list: HTMLElement, key: string): boolean {
  const options = Array.from(
    list.querySelectorAll<HTMLElement>(ENABLED_OPTION_SELECTOR),
  );
  const current = options.findIndex(
    (option) => option === list.ownerDocument.activeElement,
  );
  const last = options.length - 1;
  const targetIndex =
    key === "Home"
      ? 0
      : key === "End"
        ? last
        : key === "ArrowDown"
          ? Math.min(last, current + 1)
          : key === "ArrowUp"
            ? Math.max(0, current - 1)
            : null;
  if (targetIndex === null) return false;
  options[targetIndex]?.focus();
  return true;
}

function optionTextValue(option: HTMLElement): string {
  return option.dataset.textValue ?? option.textContent?.trim() ?? "";
}

function findTypeaheadOption(
  options: HTMLElement[],
  current: HTMLElement | undefined,
  search: string,
): HTMLElement | undefined {
  const firstChar = search.charAt(0);
  const isRepeatedChar = Array.from(search).every((char) => char === firstChar);
  const normalizedSearch = (isRepeatedChar ? firstChar : search).toLowerCase();
  const start = current === undefined ? 0 : options.indexOf(current);
  const wrapped = [...options.slice(start), ...options.slice(0, start)];
  const candidates =
    normalizedSearch.length === 1
      ? wrapped.filter((option) => option !== current)
      : wrapped;
  return candidates.find((option) =>
    optionTextValue(option).toLowerCase().startsWith(normalizedSearch),
  );
}

const CompactSelectListbox = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { compact: CompactSelectContextValue }
>(({ compact, children, onKeyDown, onKeyDownCapture, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const typeaheadRef = React.useRef({ search: "", timeout: 0 });
  const setListRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      listRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref !== null) ref.current = node;
    },
    [ref],
  );

  React.useEffect(() => {
    const list = listRef.current;
    if (!compact.open || list === null || !isLastInputKeyboard()) return;
    const target =
      list.querySelector<HTMLElement>(
        `${ENABLED_OPTION_SELECTOR}[aria-selected="true"]`,
      ) ?? list.querySelector<HTMLElement>(ENABLED_OPTION_SELECTOR);
    target?.focus();
  }, [compact.open]);

  React.useEffect(() => {
    const typeahead = typeaheadRef.current;
    return () => window.clearTimeout(typeahead.timeout);
  }, []);

  return (
    <div
      ref={setListRef}
      role="listbox"
      id={compact.listboxId}
      aria-label={compact.label}
      {...props}
      onKeyDownCapture={(event) => {
        onKeyDownCapture?.(event);
        const typeahead = typeaheadRef.current;
        const isModifierKey = event.ctrlKey || event.altKey || event.metaKey;
        if (event.defaultPrevented || isModifierKey || event.key.length !== 1) {
          return;
        }
        if (event.key === " " && typeahead.search === "") return;
        event.preventDefault();
        typeahead.search += event.key;
        window.clearTimeout(typeahead.timeout);
        typeahead.timeout = window.setTimeout(() => {
          typeahead.search = "";
        }, TYPEAHEAD_RESET_MS);
        const options = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            ENABLED_OPTION_SELECTOR,
          ),
        );
        const activeElement = event.currentTarget.ownerDocument.activeElement;
        const current = options.find((option) => option === activeElement);
        findTypeaheadOption(options, current, typeahead.search)?.focus();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (moveOptionFocus(event.currentTarget, event.key)) {
          event.preventDefault();
        }
      }}
    >
      <CompactSelectListContext.Provider value={true}>
        {children}
      </CompactSelectListContext.Provider>
    </div>
  );
});
CompactSelectListbox.displayName = "CompactSelectListbox";

const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => {
  const compact = React.useContext(CompactSelectContext);
  const scopeProps = usePortalScopeProps();

  const floating = (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={compact === null ? ref : undefined}
        {...scopeProps}
        className={cn(
          "relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );

  if (compact === null) {
    return floating;
  }

  const { style, ...domProps } = stripRadixContentProps(props);
  return (
    <>
      {floating}
      <ResponsiveDrawerShell
        open={compact.open}
        onOpenChange={compact.onOpenChange}
        srLabel={compact.label}
        onEscapeKeyDown={props.onEscapeKeyDown}
        onPointerDownOutside={props.onPointerDownOutside}
      >
        <CompactSelectListbox
          ref={ref}
          compact={compact}
          className={cn("overflow-y-auto px-2 pt-1 pb-3", className)}
          {...domProps}
          style={{ ...style, ...COMPACT_SHEET_CONTENT_STYLE }}
        >
          {children}
        </CompactSelectListbox>
      </ResponsiveDrawerShell>
    </>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => {
  const compact = useCompactSelectList();
  const groupLabelId = React.useContext(CompactSelectGroupLabelContext);
  const labelClassName = cn("px-2 py-1.5 text-sm font-semibold", className);

  if (compact === null) {
    return (
      <SelectPrimitive.Label ref={ref} className={labelClassName} {...props} />
    );
  }

  return (
    <div ref={ref} id={groupLabelId} className={labelClassName} {...props} />
  );
});
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(
  (
    {
      className,
      children,
      value,
      disabled,
      textValue,
      onClick,
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const compact = useCompactSelectList();

    if (compact === null) {
      return (
        <SelectPrimitive.Item
          ref={ref}
          value={value}
          disabled={disabled}
          textValue={textValue}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className={cn(
            "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-state-hover focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
            className,
          )}
          {...props}
        >
          <span className="absolute right-2 flex size-3.5 items-center justify-center">
            <SelectPrimitive.ItemIndicator>
              <Icon name="Check" className="size-4" />
            </SelectPrimitive.ItemIndicator>
          </span>
          <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        </SelectPrimitive.Item>
      );
    }

    const selected = compact.value === value;
    const select = () => {
      if (!disabled) compact.selectValue(value);
    };

    return (
      <div
        ref={ref}
        role="option"
        aria-selected={selected}
        aria-disabled={disabled || undefined}
        data-disabled={disabled ? "" : undefined}
        data-state={selected ? "checked" : "unchecked"}
        data-text-value={textValue}
        tabIndex={disabled ? undefined : 0}
        className={cn(
          "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-2 pr-8 text-sm outline-none transition-colors focus:bg-state-hover focus:text-foreground active:bg-state-active active:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
          className,
        )}
        {...props}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) select();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || event.target !== event.currentTarget) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            select();
          }
        }}
      >
        <span
          className={cn(
            "absolute right-2 flex items-center justify-center",
            COARSE_POINTER_CHECK_SLOT_CLASS,
          )}
        >
          {selected ? (
            <Icon name="Check" className={COARSE_POINTER_CHECK_SLOT_CLASS} />
          ) : null}
        </span>
        <span>{children}</span>
      </div>
    );
  },
);
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => {
  const separatorClassName = cn("-mx-1 my-1 h-px bg-border", className);

  if (useCompactSelectList() === null) {
    return (
      <SelectPrimitive.Separator
        ref={ref}
        className={separatorClassName}
        {...props}
      />
    );
  }

  return (
    <div ref={ref} aria-hidden className={separatorClassName} {...props} />
  );
});
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
