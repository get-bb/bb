// Bundled type declarations for `@bb/plugin-sdk`, shipped into scaffolded
// plugins so they typecheck without the @bb/* workspace on disk.
//
// Confused by the API, or need a symbol that isn't here? Clone the BB repo
// and read the real source: https://github.com/ymichael/bb

import * as react from 'react';
import { HTMLAttributes, ButtonHTMLAttributes, CSSProperties, ReactNode, MouseEventHandler, InputHTMLAttributes, LabelHTMLAttributes, ComponentType, TextareaHTMLAttributes } from 'react';

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
/** Props passed to a `homepageSection` component. */
interface PluginHomepageSectionProps {
    /** Project in view on the compose surface; null when none is selected. */
    projectId: string | null;
}
/** Props passed to a `navPanel` component (it owns its whole route). */
interface PluginNavPanelProps {
}
/** Props passed to a `threadPanelTab` component. */
interface PluginThreadPanelTabProps {
    threadId: string;
}
/** Props passed to a `composerAccessory` component. */
interface PluginComposerAccessoryProps {
    projectId: string | null;
    threadId: string | null;
}
/**
 * Slot/panel ids and nav-panel paths must match this pattern (letters,
 * digits, `-`, `_`): they ride URLs and persisted panel-tab keys.
 */
declare const PLUGIN_SLOT_ID_PATTERN: RegExp;
interface PluginHomepageSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    component: ComponentType<PluginHomepageSectionProps>;
}
interface PluginNavPanelRegistration {
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
interface PluginThreadPanelTabRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    component: ComponentType<PluginThreadPanelTabProps>;
    /**
     * Optional synchronous visibility predicate, evaluated per thread on
     * render. V1 is sync-only (the design allows async later); keep it cheap
     * and side-effect free. A throwing predicate hides the tab.
     */
    visible?: (context: {
        threadId: string;
    }) => boolean;
}
interface PluginComposerAccessoryRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    component: ComponentType<PluginComposerAccessoryProps>;
}
interface PluginAppSlots {
    homepageSection(registration: PluginHomepageSectionRegistration): void;
    navPanel(registration: PluginNavPanelRegistration): void;
    threadPanelTab(registration: PluginThreadPanelTabRegistration): void;
    composerAccessory(registration: PluginComposerAccessoryRegistration): void;
}
interface PluginAppBuilder {
    slots: PluginAppSlots;
}
type PluginAppSetup = (app: PluginAppBuilder) => void;
/**
 * The opaque product of `definePluginApp` — a plugin's `app.tsx` default
 * export. The host re-runs `setup` against a fresh collector on every
 * (re)interpretation, replacing that plugin's registrations wholesale.
 */
interface PluginAppDefinition {
    /** Brand the host checks before interpreting a bundle's default export. */
    readonly __bbPluginApp: true;
    readonly setup: PluginAppSetup;
}
interface PluginRpcClient {
    /**
     * Invoke one of the plugin's `bb.rpc` methods (POST
     * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
     * result; rejects with an `Error` carrying the server's message when the
     * handler fails or the plugin is not running.
     */
    call(method: string, input?: unknown): Promise<unknown>;
}
interface PluginSettingsState {
    /**
     * Effective non-secret setting values (secret settings are excluded —
     * read them server-side). Undefined while loading or unavailable.
     */
    values: Record<string, string | boolean> | undefined;
    isLoading: boolean;
}
/** Current app selection, derived from the route. */
interface BbContext {
    projectId: string | null;
    threadId: string | null;
}
interface BbNavigate {
    toThread(threadId: string): void;
    toProject(projectId: string): void;
    /** Navigate to one of this plugin's own nav panels by its `path`. */
    toPluginPanel(path: string): void;
}
/** Placement side for popover-style overlay content. */
type PluginUiSide = "top" | "right" | "bottom" | "left";
/** Placement alignment for popover-style overlay content. */
type PluginUiAlign = "start" | "center" | "end";
/** Baseline props shared by styled kit parts. */
interface PluginUiPartProps {
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
}
interface PluginButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
    variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
    size?: "default" | "sm" | "lg" | "icon";
    /** Render the child element instead of a <button>, merging props (Slot). */
    asChild?: boolean;
}
interface PluginBadgeProps extends HTMLAttributes<HTMLDivElement> {
    variant?: "default" | "secondary" | "destructive" | "outline";
}
/** shadcn Card family: Card, CardHeader, CardTitle, …, all plain divs. */
type PluginCardProps = HTMLAttributes<HTMLDivElement>;
type PluginInputProps = InputHTMLAttributes<HTMLInputElement>;
type PluginTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
type PluginLabelProps = LabelHTMLAttributes<HTMLLabelElement>;
interface PluginSwitchProps {
    checked?: boolean;
    defaultChecked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    id?: string;
    className?: string;
    style?: CSSProperties;
    "aria-label"?: string;
}
interface PluginCheckboxProps {
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
interface PluginSelectProps {
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
interface PluginSelectTriggerProps {
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
    disabled?: boolean;
    id?: string;
    "aria-label"?: string;
}
interface PluginSelectValueProps {
    placeholder?: ReactNode;
    className?: string;
    children?: ReactNode;
}
interface PluginSelectContentProps extends PluginUiPartProps {
    position?: "item-aligned" | "popper";
    side?: PluginUiSide;
    align?: PluginUiAlign;
    sideOffset?: number;
}
interface PluginSelectItemProps extends PluginUiPartProps {
    value: string;
    disabled?: boolean;
    textValue?: string;
}
interface PluginTabsProps {
    value?: string;
    defaultValue?: string;
    onValueChange?: (value: string) => void;
    orientation?: "horizontal" | "vertical";
    className?: string;
    style?: CSSProperties;
    children?: ReactNode;
}
interface PluginTabsListProps extends PluginUiPartProps {
    loop?: boolean;
}
interface PluginTabsTriggerProps extends PluginUiPartProps {
    value: string;
    disabled?: boolean;
}
interface PluginTabsContentProps extends PluginUiPartProps {
    value: string;
}
interface PluginDialogProps {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    modal?: boolean;
    children?: ReactNode;
}
interface PluginOverlayTriggerProps {
    /** Render the child element instead of the default tag, merging props. */
    asChild?: boolean;
    className?: string;
    children?: ReactNode;
    disabled?: boolean;
}
interface PluginDialogCloseProps extends PluginOverlayTriggerProps {
    onClick?: MouseEventHandler<HTMLButtonElement>;
}
/** DialogHeader / DialogFooter — plain layout divs. */
type PluginDialogSectionProps = HTMLAttributes<HTMLDivElement>;
interface PluginDropdownMenuProps {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    modal?: boolean;
    children?: ReactNode;
}
interface PluginMenuContentProps extends PluginUiPartProps {
    side?: PluginUiSide;
    align?: PluginUiAlign;
    sideOffset?: number;
    alignOffset?: number;
}
interface PluginDropdownMenuItemProps extends PluginUiPartProps {
    disabled?: boolean;
    /** Indent to align with checkbox/radio items (shadcn `inset`). */
    inset?: boolean;
    onSelect?: (event: Event) => void;
}
interface PluginDropdownMenuCheckboxItemProps extends PluginUiPartProps {
    checked?: boolean | "indeterminate";
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
}
interface PluginDropdownMenuRadioGroupProps {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
}
interface PluginDropdownMenuRadioItemProps extends PluginUiPartProps {
    value: string;
    disabled?: boolean;
    onSelect?: (event: Event) => void;
}
interface PluginDropdownMenuLabelProps extends PluginUiPartProps {
    inset?: boolean;
}
interface PluginDropdownMenuSubProps {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: ReactNode;
}
interface PluginDropdownMenuSubTriggerProps extends PluginUiPartProps {
    inset?: boolean;
    disabled?: boolean;
}
interface PluginPortalProps {
    children?: ReactNode;
}
interface PluginPopoverProps {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    modal?: boolean;
    children?: ReactNode;
}
interface PluginPopoverContentProps extends PluginUiPartProps {
    side?: PluginUiSide;
    align?: PluginUiAlign;
    sideOffset?: number;
    alignOffset?: number;
}
interface PluginTooltipProps {
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    delayDuration?: number;
    disableHoverableContent?: boolean;
    children?: ReactNode;
}
interface PluginTooltipProviderProps {
    delayDuration?: number;
    skipDelayDuration?: number;
    disableHoverableContent?: boolean;
    children: ReactNode;
}
interface PluginTooltipContentProps extends PluginUiPartProps {
    side?: PluginUiSide;
    align?: PluginUiAlign;
    sideOffset?: number;
    alignOffset?: number;
    hidden?: boolean;
}
interface PluginSeparatorProps {
    className?: string;
    style?: CSSProperties;
    orientation?: "horizontal" | "vertical";
    decorative?: boolean;
}
type PluginSkeletonProps = HTMLAttributes<HTMLDivElement>;
interface PluginToastOptions {
    id?: string | number;
    description?: ReactNode;
    duration?: number;
}
/**
 * sonner's `toast` — the host renders the `<Toaster>`, so calling this from
 * plugin code shows a normal app toast.
 */
interface PluginToast {
    (message: ReactNode, options?: PluginToastOptions): string | number;
    success(message: ReactNode, options?: PluginToastOptions): string | number;
    error(message: ReactNode, options?: PluginToastOptions): string | number;
    info(message: ReactNode, options?: PluginToastOptions): string | number;
    warning(message: ReactNode, options?: PluginToastOptions): string | number;
    loading(message: ReactNode, options?: PluginToastOptions): string | number;
    dismiss(id?: string | number): void;
}
interface PluginEmptyStateProps {
    message: string;
    className?: string;
}
interface PluginMarkdownProps {
    content: string;
    className?: string;
}
/**
 * Props for `PageBody` — the opt-in navPanel layout wrapper. `chrome: "page"`
 * bodies are full-width by default; wrapping your content in `<PageBody>`
 * gives the classic centered, width-capped column used by the host's own
 * settings-style pages.
 */
interface PluginPageBodyProps {
    className?: string;
    children?: ReactNode;
}
interface PluginSpinnerProps {
    className?: string;
}
/**
 * Everything `@bb/plugin-sdk/app` resolves to at runtime. The BB app builds
 * the real implementation and `satisfies` this interface; `bb plugin build`
 * shims the specifier to that object on `globalThis.__bbPluginRuntime`.
 */
interface PluginSdkApp {
    definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
    useRpc(): PluginRpcClient;
    useRealtime(channel: string, handler: (payload: unknown) => void): void;
    useSettings(): PluginSettingsState;
    useBbContext(): BbContext;
    useBbNavigate(): BbNavigate;
    toast: PluginToast;
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
declare const PLUGIN_SDK_APP_EXPORT_NAMES: readonly ["Badge", "Button", "Card", "CardContent", "CardDescription", "CardFooter", "CardHeader", "CardTitle", "Checkbox", "Dialog", "DialogClose", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogOverlay", "DialogTitle", "DialogTrigger", "DropdownMenu", "DropdownMenuCheckboxItem", "DropdownMenuContent", "DropdownMenuGroup", "DropdownMenuItem", "DropdownMenuLabel", "DropdownMenuPortal", "DropdownMenuRadioGroup", "DropdownMenuRadioItem", "DropdownMenuSeparator", "DropdownMenuShortcut", "DropdownMenuSub", "DropdownMenuSubContent", "DropdownMenuSubTrigger", "DropdownMenuTrigger", "EmptyState", "Input", "Label", "Markdown", "PageBody", "Popover", "PopoverAnchor", "PopoverContent", "PopoverTrigger", "Select", "SelectContent", "SelectGroup", "SelectItem", "SelectLabel", "SelectScrollDownButton", "SelectScrollUpButton", "SelectSeparator", "SelectTrigger", "SelectValue", "Separator", "Skeleton", "Spinner", "Switch", "Tabs", "TabsContent", "TabsList", "TabsTrigger", "Textarea", "Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger", "definePluginApp", "toast", "useBbContext", "useBbNavigate", "useRealtime", "useRpc", "useSettings"];

declare const definePluginApp: (setup: PluginAppSetup) => PluginAppDefinition;
declare const useRpc: () => PluginRpcClient;
declare const useRealtime: (channel: string, handler: (payload: unknown) => void) => void;
declare const useSettings: () => PluginSettingsState;
declare const useBbContext: () => BbContext;
declare const useBbNavigate: () => BbNavigate;
declare const toast: PluginToast;
declare const Badge: react.ComponentType<PluginBadgeProps>;
declare const Button: react.ComponentType<PluginButtonProps>;
declare const Card: react.ComponentType<PluginCardProps>;
declare const CardContent: react.ComponentType<PluginCardProps>;
declare const CardDescription: react.ComponentType<PluginCardProps>;
declare const CardFooter: react.ComponentType<PluginCardProps>;
declare const CardHeader: react.ComponentType<PluginCardProps>;
declare const CardTitle: react.ComponentType<PluginCardProps>;
declare const Checkbox: react.ComponentType<PluginCheckboxProps>;
declare const Dialog: react.ComponentType<PluginDialogProps>;
declare const DialogClose: react.ComponentType<PluginDialogCloseProps>;
declare const DialogContent: react.ComponentType<PluginUiPartProps>;
declare const DialogDescription: react.ComponentType<PluginUiPartProps>;
declare const DialogFooter: react.ComponentType<PluginDialogSectionProps>;
declare const DialogHeader: react.ComponentType<PluginDialogSectionProps>;
declare const DialogOverlay: react.ComponentType<PluginUiPartProps>;
declare const DialogTitle: react.ComponentType<PluginUiPartProps>;
declare const DialogTrigger: react.ComponentType<PluginOverlayTriggerProps>;
declare const DropdownMenu: react.ComponentType<PluginDropdownMenuProps>;
declare const DropdownMenuCheckboxItem: react.ComponentType<PluginDropdownMenuCheckboxItemProps>;
declare const DropdownMenuContent: react.ComponentType<PluginMenuContentProps>;
declare const DropdownMenuGroup: react.ComponentType<PluginUiPartProps>;
declare const DropdownMenuItem: react.ComponentType<PluginDropdownMenuItemProps>;
declare const DropdownMenuLabel: react.ComponentType<PluginDropdownMenuLabelProps>;
declare const DropdownMenuPortal: react.ComponentType<PluginPortalProps>;
declare const DropdownMenuRadioGroup: react.ComponentType<PluginDropdownMenuRadioGroupProps>;
declare const DropdownMenuRadioItem: react.ComponentType<PluginDropdownMenuRadioItemProps>;
declare const DropdownMenuSeparator: react.ComponentType<PluginUiPartProps>;
declare const DropdownMenuShortcut: react.ComponentType<react.HTMLAttributes<HTMLSpanElement>>;
declare const DropdownMenuSub: react.ComponentType<PluginDropdownMenuSubProps>;
declare const DropdownMenuSubContent: react.ComponentType<PluginUiPartProps>;
declare const DropdownMenuSubTrigger: react.ComponentType<PluginDropdownMenuSubTriggerProps>;
declare const DropdownMenuTrigger: react.ComponentType<PluginOverlayTriggerProps>;
declare const Input: react.ComponentType<PluginInputProps>;
declare const Label: react.ComponentType<PluginLabelProps>;
declare const Popover: react.ComponentType<PluginPopoverProps>;
declare const PopoverAnchor: react.ComponentType<PluginUiPartProps>;
declare const PopoverContent: react.ComponentType<PluginPopoverContentProps>;
declare const PopoverTrigger: react.ComponentType<PluginOverlayTriggerProps>;
declare const Select: react.ComponentType<PluginSelectProps>;
declare const SelectContent: react.ComponentType<PluginSelectContentProps>;
declare const SelectGroup: react.ComponentType<PluginUiPartProps>;
declare const SelectItem: react.ComponentType<PluginSelectItemProps>;
declare const SelectLabel: react.ComponentType<PluginUiPartProps>;
declare const SelectScrollDownButton: react.ComponentType<PluginUiPartProps>;
declare const SelectScrollUpButton: react.ComponentType<PluginUiPartProps>;
declare const SelectSeparator: react.ComponentType<PluginUiPartProps>;
declare const SelectTrigger: react.ComponentType<PluginSelectTriggerProps>;
declare const SelectValue: react.ComponentType<PluginSelectValueProps>;
declare const Separator: react.ComponentType<PluginSeparatorProps>;
declare const Skeleton: react.ComponentType<PluginSkeletonProps>;
declare const Switch: react.ComponentType<PluginSwitchProps>;
declare const Tabs: react.ComponentType<PluginTabsProps>;
declare const TabsContent: react.ComponentType<PluginTabsContentProps>;
declare const TabsList: react.ComponentType<PluginTabsListProps>;
declare const TabsTrigger: react.ComponentType<PluginTabsTriggerProps>;
declare const Textarea: react.ComponentType<PluginTextareaProps>;
declare const Tooltip: react.ComponentType<PluginTooltipProps>;
declare const TooltipContent: react.ComponentType<PluginTooltipContentProps>;
declare const TooltipProvider: react.ComponentType<PluginTooltipProviderProps>;
declare const TooltipTrigger: react.ComponentType<PluginOverlayTriggerProps>;
declare const EmptyState: react.ComponentType<PluginEmptyStateProps>;
declare const Markdown: react.ComponentType<PluginMarkdownProps>;
declare const PageBody: react.ComponentType<PluginPageBodyProps>;
declare const Spinner: react.ComponentType<PluginSpinnerProps>;

export { Badge, Button, Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, Checkbox, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogTitle, DialogTrigger, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuPortal, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, EmptyState, Input, Label, Markdown, PLUGIN_SDK_APP_EXPORT_NAMES, PLUGIN_SLOT_ID_PATTERN, PageBody, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectScrollDownButton, SelectScrollUpButton, SelectSeparator, SelectTrigger, SelectValue, Separator, Skeleton, Spinner, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, definePluginApp, toast, useBbContext, useBbNavigate, useRealtime, useRpc, useSettings };
export type { BbContext, BbNavigate, PluginAppBuilder, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginBadgeProps, PluginButtonProps, PluginCardProps, PluginCheckboxProps, PluginComposerAccessoryProps, PluginComposerAccessoryRegistration, PluginDialogCloseProps, PluginDialogProps, PluginDialogSectionProps, PluginDropdownMenuCheckboxItemProps, PluginDropdownMenuItemProps, PluginDropdownMenuLabelProps, PluginDropdownMenuProps, PluginDropdownMenuRadioGroupProps, PluginDropdownMenuRadioItemProps, PluginDropdownMenuSubProps, PluginDropdownMenuSubTriggerProps, PluginEmptyStateProps, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginInputProps, PluginLabelProps, PluginMarkdownProps, PluginMenuContentProps, PluginNavPanelProps, PluginNavPanelRegistration, PluginOverlayTriggerProps, PluginPageBodyProps, PluginPopoverContentProps, PluginPopoverProps, PluginPortalProps, PluginRpcClient, PluginSdkApp, PluginSelectContentProps, PluginSelectItemProps, PluginSelectProps, PluginSelectTriggerProps, PluginSelectValueProps, PluginSeparatorProps, PluginSettingsState, PluginSkeletonProps, PluginSpinnerProps, PluginSwitchProps, PluginTabsContentProps, PluginTabsListProps, PluginTabsProps, PluginTabsTriggerProps, PluginTextareaProps, PluginThreadPanelTabProps, PluginThreadPanelTabRegistration, PluginToast, PluginToastOptions, PluginTooltipContentProps, PluginTooltipProps, PluginTooltipProviderProps, PluginUiAlign, PluginUiPartProps, PluginUiSide };
