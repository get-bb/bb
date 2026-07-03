import type {
  ButtonHTMLAttributes,
  ComponentType,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  MouseEventHandler,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

/**
 * The `@bb/plugin-sdk/app` contract (plugin design §5.2) — pure types plus
 * the runtime export-name list, with no side effects. This module is what the
 * BB app imports to keep its real implementation in sync (`satisfies
 * PluginSdkApp`) and what `bb plugin build` imports to generate the shim's
 * named-export list. Plugin authors import the same shapes through
 * `@bb/plugin-sdk/app`.
 *
 * Per-slot props are versioned contracts: additive-only within an SDK major.
 */

// ---------------------------------------------------------------------------
// Slot props (the versioned per-slot contracts).
// ---------------------------------------------------------------------------

/** Props passed to a `homepageSection` component. */
export interface PluginHomepageSectionProps {
  /** Project in view on the compose surface; null when none is selected. */
  projectId: string | null;
}

/** Props passed to a `navPanel` component (it owns its whole route). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface PluginNavPanelProps {}

/** Props passed to a `threadPanelTab` component. */
export interface PluginThreadPanelTabProps {
  threadId: string;
}

/** Props passed to a `composerAccessory` component. */
export interface PluginComposerAccessoryProps {
  projectId: string | null;
  threadId: string | null;
}

// ---------------------------------------------------------------------------
// Slot registrations (the arguments to `app.slots.*`).
// ---------------------------------------------------------------------------

/**
 * Slot/panel ids and nav-panel paths must match this pattern (letters,
 * digits, `-`, `_`): they ride URLs and persisted panel-tab keys.
 */
export const PLUGIN_SLOT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface PluginHomepageSectionRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  component: ComponentType<PluginHomepageSectionProps>;
}

export interface PluginNavPanelRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  /** Icon hint (BB icon name); unknown names fall back to a generic icon. */
  icon: string;
  /** URL segment under `/plugins/<pluginId>/`; letters, digits, `-`, `_`. */
  path: string;
  component: ComponentType<PluginNavPanelProps>;
  /**
   * Panel chrome (default "page"): "page" renders the host title bar (plugin
   * logo + `title` + your `headerContent`) above a full-width padded body;
   * "none" hands the ENTIRE panel area to `component` — no host padding, no
   * title bar (`headerContent` is ignored) — only the per-plugin error
   * boundary remains.
   */
  chrome?: "page" | "none";
  /**
   * Optional component rendered on the right side of the "page" title bar
   * (e.g. a sync button or a count). Contained separately from the body: a
   * throwing headerContent is hidden without breaking the title bar.
   */
  headerContent?: ComponentType<PluginNavPanelProps>;
}

export interface PluginThreadPanelTabRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  title: string;
  component: ComponentType<PluginThreadPanelTabProps>;
  /**
   * Optional synchronous visibility predicate, evaluated per thread on
   * render. V1 is sync-only (the design allows async later); keep it cheap
   * and side-effect free. A throwing predicate hides the tab.
   */
  visible?: (context: { threadId: string }) => boolean;
}

export interface PluginComposerAccessoryRegistration {
  /** Unique within the plugin; letters, digits, `-`, `_`. */
  id: string;
  component: ComponentType<PluginComposerAccessoryProps>;
}

// ---------------------------------------------------------------------------
// definePluginApp
// ---------------------------------------------------------------------------

export interface PluginAppSlots {
  homepageSection(registration: PluginHomepageSectionRegistration): void;
  navPanel(registration: PluginNavPanelRegistration): void;
  threadPanelTab(registration: PluginThreadPanelTabRegistration): void;
  composerAccessory(registration: PluginComposerAccessoryRegistration): void;
}

export interface PluginAppBuilder {
  slots: PluginAppSlots;
}

export type PluginAppSetup = (app: PluginAppBuilder) => void;

/**
 * The opaque product of `definePluginApp` — a plugin's `app.tsx` default
 * export. The host re-runs `setup` against a fresh collector on every
 * (re)interpretation, replacing that plugin's registrations wholesale.
 */
export interface PluginAppDefinition {
  /** Brand the host checks before interpreting a bundle's default export. */
  readonly __bbPluginApp: true;
  readonly setup: PluginAppSetup;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface PluginRpcClient {
  /**
   * Invoke one of the plugin's `bb.rpc` methods (POST
   * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
   * result; rejects with an `Error` carrying the server's message when the
   * handler fails or the plugin is not running.
   */
  call(method: string, input?: unknown): Promise<unknown>;
}

export interface PluginSettingsState {
  /**
   * Effective non-secret setting values (secret settings are excluded —
   * read them server-side). Undefined while loading or unavailable.
   */
  values: Record<string, string | boolean> | undefined;
  isLoading: boolean;
}

/** Current app selection, derived from the route. */
export interface BbContext {
  projectId: string | null;
  threadId: string | null;
}

export interface BbNavigate {
  toThread(threadId: string): void;
  toProject(projectId: string): void;
  /** Navigate to one of this plugin's own nav panels by its `path`. */
  toPluginPanel(path: string): void;
}

// ---------------------------------------------------------------------------
// UI kit — the host's shadcn/ui-derived components, exposed under stock
// shadcn/ui names with stock props so standard shadcn code works as-is.
// Rendered by the host (theme tokens, dark mode, and portalled overlays work
// for free). Additive-only within an SDK major; the prop types below are the
// guaranteed contract — host components may accept more at runtime, but only
// these are stable. Internal app components beyond this surface are NOT
// exposed.
// ---------------------------------------------------------------------------

/** Placement side for popover-style overlay content. */
export type PluginUiSide = "top" | "right" | "bottom" | "left";
/** Placement alignment for popover-style overlay content. */
export type PluginUiAlign = "start" | "center" | "end";

/** Baseline props shared by styled kit parts. */
export interface PluginUiPartProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

// --- Buttons, badges, cards ------------------------------------------------

export interface PluginButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  variant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  size?: "default" | "sm" | "lg" | "icon";
  /** Render the child element instead of a <button>, merging props (Slot). */
  asChild?: boolean;
}

export interface PluginBadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

/** shadcn Card family: Card, CardHeader, CardTitle, …, all plain divs. */
export type PluginCardProps = HTMLAttributes<HTMLDivElement>;

// --- Form controls -----------------------------------------------------------

export type PluginInputProps = InputHTMLAttributes<HTMLInputElement>;

export type PluginTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export type PluginLabelProps = LabelHTMLAttributes<HTMLLabelElement>;

export interface PluginSwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

export interface PluginCheckboxProps {
  checked?: boolean | "indeterminate";
  defaultChecked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean | "indeterminate") => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}

// --- Select ------------------------------------------------------------------

export interface PluginSelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  children?: ReactNode;
}

export interface PluginSelectTriggerProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

export interface PluginSelectValueProps {
  placeholder?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export interface PluginSelectContentProps extends PluginUiPartProps {
  position?: "item-aligned" | "popper";
  side?: PluginUiSide;
  align?: PluginUiAlign;
  sideOffset?: number;
}

export interface PluginSelectItemProps extends PluginUiPartProps {
  value: string;
  disabled?: boolean;
  textValue?: string;
}

// --- Tabs --------------------------------------------------------------------

export interface PluginTabsProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export interface PluginTabsListProps extends PluginUiPartProps {
  loop?: boolean;
}

export interface PluginTabsTriggerProps extends PluginUiPartProps {
  value: string;
  disabled?: boolean;
}

export interface PluginTabsContentProps extends PluginUiPartProps {
  value: string;
}

// --- Dialog ------------------------------------------------------------------

export interface PluginDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

export interface PluginOverlayTriggerProps {
  /** Render the child element instead of the default tag, merging props. */
  asChild?: boolean;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
}

export interface PluginDialogCloseProps extends PluginOverlayTriggerProps {
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

/** DialogHeader / DialogFooter — plain layout divs. */
export type PluginDialogSectionProps = HTMLAttributes<HTMLDivElement>;

// --- DropdownMenu ------------------------------------------------------------

export interface PluginDropdownMenuProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

export interface PluginMenuContentProps extends PluginUiPartProps {
  side?: PluginUiSide;
  align?: PluginUiAlign;
  sideOffset?: number;
  alignOffset?: number;
}

export interface PluginDropdownMenuItemProps extends PluginUiPartProps {
  disabled?: boolean;
  /** Indent to align with checkbox/radio items (shadcn `inset`). */
  inset?: boolean;
  onSelect?: (event: Event) => void;
}

export interface PluginDropdownMenuCheckboxItemProps
  extends PluginUiPartProps {
  checked?: boolean | "indeterminate";
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
}

export interface PluginDropdownMenuRadioGroupProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: ReactNode;
}

export interface PluginDropdownMenuRadioItemProps extends PluginUiPartProps {
  value: string;
  disabled?: boolean;
  onSelect?: (event: Event) => void;
}

export interface PluginDropdownMenuLabelProps extends PluginUiPartProps {
  inset?: boolean;
}

export interface PluginDropdownMenuSubProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export interface PluginDropdownMenuSubTriggerProps extends PluginUiPartProps {
  inset?: boolean;
  disabled?: boolean;
}

export interface PluginPortalProps {
  children?: ReactNode;
}

// --- Popover / Tooltip ---------------------------------------------------------

export interface PluginPopoverProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: ReactNode;
}

export interface PluginPopoverContentProps extends PluginUiPartProps {
  side?: PluginUiSide;
  align?: PluginUiAlign;
  sideOffset?: number;
  alignOffset?: number;
}

export interface PluginTooltipProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  delayDuration?: number;
  disableHoverableContent?: boolean;
  children?: ReactNode;
}

export interface PluginTooltipProviderProps {
  delayDuration?: number;
  skipDelayDuration?: number;
  disableHoverableContent?: boolean;
  children: ReactNode;
}

export interface PluginTooltipContentProps extends PluginUiPartProps {
  side?: PluginUiSide;
  align?: PluginUiAlign;
  sideOffset?: number;
  alignOffset?: number;
  hidden?: boolean;
}

// --- Misc primitives ---------------------------------------------------------

export interface PluginSeparatorProps {
  className?: string;
  style?: CSSProperties;
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
}

export type PluginSkeletonProps = HTMLAttributes<HTMLDivElement>;

// --- Toast (sonner) ------------------------------------------------------------

export interface PluginToastOptions {
  id?: string | number;
  description?: ReactNode;
  duration?: number;
}

/**
 * sonner's `toast` — the host renders the `<Toaster>`, so calling this from
 * plugin code shows a normal app toast.
 */
export interface PluginToast {
  (message: ReactNode, options?: PluginToastOptions): string | number;
  success(message: ReactNode, options?: PluginToastOptions): string | number;
  error(message: ReactNode, options?: PluginToastOptions): string | number;
  info(message: ReactNode, options?: PluginToastOptions): string | number;
  warning(message: ReactNode, options?: PluginToastOptions): string | number;
  loading(message: ReactNode, options?: PluginToastOptions): string | number;
  dismiss(id?: string | number): void;
}

// --- BB extras (not part of shadcn) --------------------------------------------

export interface PluginEmptyStateProps {
  message: string;
  className?: string;
}

export interface PluginMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Props for `PageBody` — the opt-in navPanel layout wrapper. `chrome: "page"`
 * bodies are full-width by default; wrapping your content in `<PageBody>`
 * gives the classic centered, width-capped column used by the host's own
 * settings-style pages.
 */
export interface PluginPageBodyProps {
  className?: string;
  children?: ReactNode;
}

export interface PluginSpinnerProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// The whole surface + its runtime export names.
// ---------------------------------------------------------------------------

/**
 * Everything `@bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
export interface PluginSdkApp {
  definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
  useRpc(): PluginRpcClient;
  useRealtime(channel: string, handler: (payload: unknown) => void): void;
  useSettings(): PluginSettingsState;
  useBbContext(): BbContext;
  useBbNavigate(): BbNavigate;
  toast: PluginToast;
  // shadcn/ui surface (stock names + props).
  Badge: ComponentType<PluginBadgeProps>;
  Button: ComponentType<PluginButtonProps>;
  Card: ComponentType<PluginCardProps>;
  CardContent: ComponentType<PluginCardProps>;
  CardDescription: ComponentType<PluginCardProps>;
  CardFooter: ComponentType<PluginCardProps>;
  CardHeader: ComponentType<PluginCardProps>;
  CardTitle: ComponentType<PluginCardProps>;
  Checkbox: ComponentType<PluginCheckboxProps>;
  Dialog: ComponentType<PluginDialogProps>;
  DialogClose: ComponentType<PluginDialogCloseProps>;
  DialogContent: ComponentType<PluginUiPartProps>;
  DialogDescription: ComponentType<PluginUiPartProps>;
  DialogFooter: ComponentType<PluginDialogSectionProps>;
  DialogHeader: ComponentType<PluginDialogSectionProps>;
  DialogOverlay: ComponentType<PluginUiPartProps>;
  DialogTitle: ComponentType<PluginUiPartProps>;
  DialogTrigger: ComponentType<PluginOverlayTriggerProps>;
  DropdownMenu: ComponentType<PluginDropdownMenuProps>;
  DropdownMenuCheckboxItem: ComponentType<PluginDropdownMenuCheckboxItemProps>;
  DropdownMenuContent: ComponentType<PluginMenuContentProps>;
  DropdownMenuGroup: ComponentType<PluginUiPartProps>;
  DropdownMenuItem: ComponentType<PluginDropdownMenuItemProps>;
  DropdownMenuLabel: ComponentType<PluginDropdownMenuLabelProps>;
  DropdownMenuPortal: ComponentType<PluginPortalProps>;
  DropdownMenuRadioGroup: ComponentType<PluginDropdownMenuRadioGroupProps>;
  DropdownMenuRadioItem: ComponentType<PluginDropdownMenuRadioItemProps>;
  DropdownMenuSeparator: ComponentType<PluginUiPartProps>;
  DropdownMenuShortcut: ComponentType<HTMLAttributes<HTMLSpanElement>>;
  DropdownMenuSub: ComponentType<PluginDropdownMenuSubProps>;
  DropdownMenuSubContent: ComponentType<PluginUiPartProps>;
  DropdownMenuSubTrigger: ComponentType<PluginDropdownMenuSubTriggerProps>;
  DropdownMenuTrigger: ComponentType<PluginOverlayTriggerProps>;
  Input: ComponentType<PluginInputProps>;
  Label: ComponentType<PluginLabelProps>;
  Popover: ComponentType<PluginPopoverProps>;
  PopoverAnchor: ComponentType<PluginUiPartProps>;
  PopoverContent: ComponentType<PluginPopoverContentProps>;
  PopoverTrigger: ComponentType<PluginOverlayTriggerProps>;
  Select: ComponentType<PluginSelectProps>;
  SelectContent: ComponentType<PluginSelectContentProps>;
  SelectGroup: ComponentType<PluginUiPartProps>;
  SelectItem: ComponentType<PluginSelectItemProps>;
  SelectLabel: ComponentType<PluginUiPartProps>;
  SelectScrollDownButton: ComponentType<PluginUiPartProps>;
  SelectScrollUpButton: ComponentType<PluginUiPartProps>;
  SelectSeparator: ComponentType<PluginUiPartProps>;
  SelectTrigger: ComponentType<PluginSelectTriggerProps>;
  SelectValue: ComponentType<PluginSelectValueProps>;
  Separator: ComponentType<PluginSeparatorProps>;
  Skeleton: ComponentType<PluginSkeletonProps>;
  Switch: ComponentType<PluginSwitchProps>;
  Tabs: ComponentType<PluginTabsProps>;
  TabsContent: ComponentType<PluginTabsContentProps>;
  TabsList: ComponentType<PluginTabsListProps>;
  TabsTrigger: ComponentType<PluginTabsTriggerProps>;
  Textarea: ComponentType<PluginTextareaProps>;
  Tooltip: ComponentType<PluginTooltipProps>;
  TooltipContent: ComponentType<PluginTooltipContentProps>;
  TooltipProvider: ComponentType<PluginTooltipProviderProps>;
  TooltipTrigger: ComponentType<PluginOverlayTriggerProps>;
  // BB extras (not shadcn).
  EmptyState: ComponentType<PluginEmptyStateProps>;
  Markdown: ComponentType<PluginMarkdownProps>;
  PageBody: ComponentType<PluginPageBodyProps>;
  Spinner: ComponentType<PluginSpinnerProps>;
}

/**
 * Named runtime exports of `@bb/plugin-sdk/app`, in sorted order. Single
 * source of truth for the build shim's export list and the app's
 * implementation-key test — adding a surface member without updating this
 * list fails the type assertion below.
 */
export const PLUGIN_SDK_APP_EXPORT_NAMES = [
  "Badge",
  "Button",
  "Card",
  "CardContent",
  "CardDescription",
  "CardFooter",
  "CardHeader",
  "CardTitle",
  "Checkbox",
  "Dialog",
  "DialogClose",
  "DialogContent",
  "DialogDescription",
  "DialogFooter",
  "DialogHeader",
  "DialogOverlay",
  "DialogTitle",
  "DialogTrigger",
  "DropdownMenu",
  "DropdownMenuCheckboxItem",
  "DropdownMenuContent",
  "DropdownMenuGroup",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "DropdownMenuPortal",
  "DropdownMenuRadioGroup",
  "DropdownMenuRadioItem",
  "DropdownMenuSeparator",
  "DropdownMenuShortcut",
  "DropdownMenuSub",
  "DropdownMenuSubContent",
  "DropdownMenuSubTrigger",
  "DropdownMenuTrigger",
  "EmptyState",
  "Input",
  "Label",
  "Markdown",
  "PageBody",
  "Popover",
  "PopoverAnchor",
  "PopoverContent",
  "PopoverTrigger",
  "Select",
  "SelectContent",
  "SelectGroup",
  "SelectItem",
  "SelectLabel",
  "SelectScrollDownButton",
  "SelectScrollUpButton",
  "SelectSeparator",
  "SelectTrigger",
  "SelectValue",
  "Separator",
  "Skeleton",
  "Spinner",
  "Switch",
  "Tabs",
  "TabsContent",
  "TabsList",
  "TabsTrigger",
  "Textarea",
  "Tooltip",
  "TooltipContent",
  "TooltipProvider",
  "TooltipTrigger",
  "definePluginApp",
  "toast",
  "useBbContext",
  "useBbNavigate",
  "useRealtime",
  "useRpc",
  "useSettings",
] as const satisfies readonly (keyof PluginSdkApp)[];

// Compile-time exhaustiveness: every PluginSdkApp key must appear in
// PLUGIN_SDK_APP_EXPORT_NAMES (the `satisfies` above covers the converse).
type MissingExportName = Exclude<
  keyof PluginSdkApp,
  (typeof PLUGIN_SDK_APP_EXPORT_NAMES)[number]
>;
const _assertAllExported: MissingExportName extends never ? true : never =
  true;
void _assertAllExported;
