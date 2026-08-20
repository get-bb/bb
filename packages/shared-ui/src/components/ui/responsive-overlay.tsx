import * as React from "react";
import { createPortal } from "react-dom";
import { Slot } from "@radix-ui/react-slot";
import { Sheet } from "@silk-hq/components";

import {
	blurActiveKeyboardInputBeforeOverlayOpen,
	blurActiveKeyboardInputBeforeOverlayClose,
	blurActiveKeyboardInputWithin,
	getOverlayTriggerClassName,
	preventOverlayTriggerSelection,
} from "./overlay-trigger.js";
import { useIsCompactViewport } from "./hooks/use-compact-viewport.js";
import { usePortalScopeProps } from "../../lib/portal-scope.js";
import { cn } from "../../lib/utils.js";

// ---------------------------------------------------------------------------
// Shared context value for responsive overlays (dropdown menus, popovers)
// ---------------------------------------------------------------------------

export interface ResponsiveOverlayContextValue {
	isCompactViewport: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

const RESPONSIVE_DRAWER_REALIZE_FALLBACK_MS = 120;
const SKIP_TRAVEL_ANIMATION = { skip: true } as const;
const BACKDROP_TRAVEL_ANIMATION = {
	opacity: ({ progress }: { progress: number }) => progress,
} as const;

type SilkTravelStatus =
	| "entering"
	| "idleInside"
	| "stepping"
	| "exiting"
	| "idleOutside";

function prefersReducedMotion(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function shouldSkipTravelAnimation(): boolean {
	if (prefersReducedMotion()) {
		return true;
	}
	// Silk's spring sampler needs real layout geometry. jsdom reports synthetic
	// boxes that can throw during travel; skip programmatic travel there and in
	// unit tests. Real browsers keep the default Silk motion presets.
	if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
		return true;
	}
	return false;
}

// Open sheets only. Retained closed shells park their content outside the
// Silk View and must not steal Escape from a visible overlay above them.
type OpenSheetEscapeEntry = {
	requestClose: () => void;
};

type OpenSheetEscapeStack = {
	entries: OpenSheetEscapeEntry[];
	handleKeyDown: (event: KeyboardEvent) => void;
};

const openSheetEscapeStacks = new WeakMap<Document, OpenSheetEscapeStack>();

function registerOpenSheetEscape(
	ownerDocument: Document,
	entry: OpenSheetEscapeEntry,
): () => void {
	let stack = openSheetEscapeStacks.get(ownerDocument);
	if (stack === undefined) {
		const entries: OpenSheetEscapeEntry[] = [];
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.key !== "Escape") {
				return;
			}
			const topEntry = entries[entries.length - 1];
			if (topEntry === undefined) {
				return;
			}
			event.preventDefault();
			topEntry.requestClose();
		};
		stack = { entries, handleKeyDown };
		openSheetEscapeStacks.set(ownerDocument, stack);
		ownerDocument.addEventListener("keydown", handleKeyDown);
	}
	stack.entries.push(entry);

	return () => {
		const currentStack = openSheetEscapeStacks.get(ownerDocument);
		if (currentStack === undefined) {
			return;
		}
		const index = currentStack.entries.indexOf(entry);
		if (index >= 0) {
			currentStack.entries.splice(index, 1);
		}
		if (currentStack.entries.length === 0) {
			ownerDocument.removeEventListener("keydown", currentStack.handleKeyDown);
			openSheetEscapeStacks.delete(ownerDocument);
		}
	};
}

// ---------------------------------------------------------------------------
// Hook: manages open state, mobile detection, and breakpoint-cross close.
// One useMediaQuery subscription per Root (not two).
// ---------------------------------------------------------------------------

export function useResponsiveRoot(
	controlledOpen: boolean | undefined,
	controlledOnChange: ((open: boolean) => void) | undefined,
	defaultOpen: boolean = false,
): ResponsiveOverlayContextValue {
	const isCompactViewport = useIsCompactViewport();
	const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
	const isControlled = controlledOpen !== undefined;
	const open = isControlled ? controlledOpen : internalOpen;

	const onOpenChange = React.useCallback(
		(next: boolean) => {
			if (open && !next && isCompactViewport) {
				blurActiveKeyboardInputBeforeOverlayClose();
			}
			if (!isControlled) {
				setInternalOpen(next);
			}
			controlledOnChange?.(next);
		},
		[isCompactViewport, isControlled, controlledOnChange, open],
	);

	return React.useMemo(
		() => ({ isCompactViewport, open, onOpenChange }),
		[isCompactViewport, open, onOpenChange],
	);
}

// ---------------------------------------------------------------------------
// MobileTrigger: shared trigger for mobile overlays.
// Adds aria-expanded, aria-haspopup, and data-state that Radix normally
// provides on desktop but which are missing from a bare <button>.
// ---------------------------------------------------------------------------

interface MobileTriggerProps {
	asChild?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	haspopup: "menu" | "dialog";
	children: React.ReactNode;
	onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

export const MobileTrigger = React.forwardRef<
	HTMLButtonElement,
	MobileTriggerProps &
		Omit<
			React.ButtonHTMLAttributes<HTMLButtonElement>,
			keyof MobileTriggerProps
		>
>(
	(
		{
			asChild,
			open,
			onOpenChange,
			haspopup,
			onClick,
			children,
			className,
			...domProps
		},
		ref,
	) => {
		const triggerClassName = getOverlayTriggerClassName(className);
		const handleClick: React.MouseEventHandler<HTMLButtonElement> = (e) => {
			onClick?.(e);
			if (!e.defaultPrevented) {
				if (!open) {
					blurActiveKeyboardInputBeforeOverlayOpen();
				}
				onOpenChange(!open);
			}
		};

		const ariaProps = {
			"aria-expanded": open,
			"aria-haspopup": haspopup,
			"data-state": open ? "open" : "closed",
		} as const;

		if (asChild) {
			return (
				<Slot
					ref={ref}
					onClick={handleClick}
					onMouseDown={preventOverlayTriggerSelection}
					className={triggerClassName}
					{...ariaProps}
					{...domProps}
				>
					{children}
				</Slot>
			);
		}

		return (
			<button
				ref={ref}
				type="button"
				onClick={handleClick}
				onMouseDown={preventOverlayTriggerSelection}
				className={triggerClassName}
				{...ariaProps}
				{...domProps}
			>
				{children}
			</button>
		);
	},
);
MobileTrigger.displayName = "MobileTrigger";

// ---------------------------------------------------------------------------
// stripRadixContentProps: removes Radix positioning/behavior props from a
// props object so that only DOM-compatible props remain for mobile rendering.
// Derived from a single const to prevent interface/set drift.
// ---------------------------------------------------------------------------

const RADIX_CONTENT_PROP_NAMES = [
	"side",
	"sideOffset",
	"align",
	"alignOffset",
	"collisionPadding",
	"collisionBoundary",
	"arrowPadding",
	"sticky",
	"hideWhenDetached",
	"avoidCollisions",
	"onOpenAutoFocus",
	"onCloseAutoFocus",
	"onEscapeKeyDown",
	"onPointerDownOutside",
	"onFocusOutside",
	"onInteractOutside",
] as const;

type RadixContentPropName = (typeof RADIX_CONTENT_PROP_NAMES)[number];

const RADIX_CONTENT_KEYS: ReadonlySet<string> = new Set(
	RADIX_CONTENT_PROP_NAMES,
);

export function stripRadixContentProps<T extends Record<string, unknown>>(
	props: T,
): Omit<T, RadixContentPropName> {
	const result = {} as Record<string, unknown>;
	for (const key of Object.keys(props)) {
		if (!RADIX_CONTENT_KEYS.has(key)) {
			result[key] = props[key];
		}
	}
	return result as Omit<T, RadixContentPropName>;
}

// ---------------------------------------------------------------------------
// ResponsiveDrawerShell: Silk-backed bottom sheet for compact menus, popovers,
// dialogs, and secondary panels. Silk owns travel/backdrop/gestures; bb owns
// realization timing, controlled-state serialization, portal scope markers,
// and settled-open notifications.
// ---------------------------------------------------------------------------

interface ResponsiveDrawerShellProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Sr-only label announced when the drawer opens. Omit if the caller
	 * renders its own labeled heading inside children (e.g. DialogTitle).
	 */
	srLabel?: string;
	/** Existing visible title used to label a dialog body. */
	labelledBy?: string;
	/** Existing visible description for a dialog body. */
	describedBy?: string;
	/** Class name on the drawer panel. */
	contentClassName?: string;
	/** Inline style on the drawer panel. */
	contentStyle?: React.CSSProperties;
	/**
	 * Called once per settled terminal travel state (`idleInside` /
	 * `idleOutside`). Snap-back and intermediate travel do not fire.
	 */
	onContentAnimationEnd?: (open: boolean) => void;
	/**
	 * When true, Silk will not move focus into the sheet on present. Used by
	 * touch-opened sidebar paths.
	 */
	suppressPresentAutoFocus?: boolean;
	/**
	 * When true, Silk will not restore focus on dismiss; the caller restores
	 * the exact trigger only when it moved focus.
	 */
	suppressDismissAutoFocus?: boolean;
	/** Horizontal edge placement for sidebar sheets. Defaults to bottom sheet. */
	contentPlacement?: "bottom" | "left" | "right";
	/**
	 * When true, mount the Silk shell even before the first open (compact
	 * sidebar boot path). Normal overlays stay unmounted until first open.
	 */
	persistClosed?: boolean;
	/** Optional stable test id for the Silk backdrop element. */
	backdropTestId?: string;
	children: React.ReactNode;
}

export function useResponsiveDrawerRealization({
	open,
	enabled = true,
}: {
	open: boolean;
	enabled?: boolean;
}): { isContentRealized: boolean; realizeContent: () => void } {
	const [isContentRealized, setIsContentRealized] = React.useState(false);
	const realizeContent = React.useCallback(
		() => setIsContentRealized(true),
		[],
	);

	React.useEffect(() => {
		if (!enabled || !open || isContentRealized) {
			return;
		}

		let firstFrame: number | null = null;
		let secondFrame: number | null = null;
		firstFrame = window.requestAnimationFrame(() => {
			firstFrame = null;
			secondFrame = window.requestAnimationFrame(() => {
				secondFrame = null;
				realizeContent();
			});
		});
		const fallback = window.setTimeout(
			realizeContent,
			RESPONSIVE_DRAWER_REALIZE_FALLBACK_MS,
		);

		return () => {
			if (firstFrame !== null) {
				window.cancelAnimationFrame(firstFrame);
			}
			if (secondFrame !== null) {
				window.cancelAnimationFrame(secondFrame);
			}
			window.clearTimeout(fallback);
		};
	}, [enabled, isContentRealized, open, realizeContent]);

	return {
		isContentRealized: enabled && isContentRealized,
		realizeContent,
	};
}

export function ResponsiveDrawerShell({
	open,
	onOpenChange,
	srLabel,
	labelledBy,
	describedBy,
	contentClassName,
	contentStyle,
	onContentAnimationEnd,
	suppressPresentAutoFocus = false,
	suppressDismissAutoFocus = false,
	contentPlacement = "bottom",
	persistClosed = false,
	backdropTestId,
	children,
}: ResponsiveDrawerShellProps) {
	const realization = useResponsiveDrawerRealization({ open });
	const isContentRealized = persistClosed
		? true
		: realization.isContentRealized;
	const portalScopeProps = usePortalScopeProps();
	const contentRef = React.useRef<HTMLDivElement | null>(null);
	const returnFocusRef = React.useRef<HTMLElement | null>(null);
	const desiredPresentedRef = React.useRef(open);
	desiredPresentedRef.current = open;
	const travelStatusRef = React.useRef<SilkTravelStatus>("idleOutside");
	const settledStateRef = React.useRef<boolean | null>(null);
	const onOpenChangeRef = React.useRef(onOpenChange);
	const onContentAnimationEndRef = React.useRef(onContentAnimationEnd);
	const [hasBeenPresented, setHasBeenPresented] = React.useState(open);
	const [presented, setPresented] = React.useState(open);
	const skipTravelAnimation = shouldSkipTravelAnimation()
		? SKIP_TRAVEL_ANIMATION
		: undefined;
	// Silk remounts View/Content when re-presenting. Keep one durable DOM host
	// and park it under Root while closed so realized children retain identity.
	const retainedMountRef = React.useRef<HTMLDivElement | null>(null);
	const retainedParkingRef = React.useRef<HTMLDivElement | null>(null);
	if (retainedMountRef.current === null && typeof document !== "undefined") {
		const mount = document.createElement("div");
		mount.setAttribute("data-bb-sheet-retained", "");
		mount.className = "flex min-h-0 min-w-0 flex-1 flex-col";
		retainedMountRef.current = mount;
	}
	const attachRetainedMount = React.useCallback(
		(slot: HTMLDivElement | null) => {
			const mount = retainedMountRef.current;
			const destination = slot ?? retainedParkingRef.current;
			if (mount === null || destination === null) {
				return;
			}
			if (mount.parentElement !== destination) {
				destination.appendChild(mount);
			}
		},
		[],
	);
	const attachRetainedParking = React.useCallback(
		(parking: HTMLDivElement | null) => {
			retainedParkingRef.current = parking;
			const mount = retainedMountRef.current;
			if (parking !== null && mount !== null && mount.parentElement === null) {
				parking.appendChild(mount);
			}
		},
		[],
	);

	React.useLayoutEffect(() => {
		onOpenChangeRef.current = onOpenChange;
	}, [onOpenChange]);
	React.useLayoutEffect(() => {
		onContentAnimationEndRef.current = onContentAnimationEnd;
	}, [onContentAnimationEnd]);

	React.useEffect(() => {
		if (open || persistClosed) {
			setHasBeenPresented(true);
		}
	}, [open, persistClosed]);

	const reportSettled = React.useCallback((settledOpen: boolean) => {
		if (settledStateRef.current === settledOpen) {
			return;
		}
		settledStateRef.current = settledOpen;
		onContentAnimationEndRef.current?.(settledOpen);
	}, []);

	const applyDesiredPresented = React.useCallback(() => {
		const desired = desiredPresentedRef.current;
		setPresented((current) => (current === desired ? current : desired));
	}, []);

	React.useEffect(() => {
		const status = travelStatusRef.current;
		if (status === "idleInside" || status === "idleOutside") {
			applyDesiredPresented();
		}
	}, [applyDesiredPresented, open]);

	const handlePresentedChange = React.useCallback((nextPresented: boolean) => {
		// Triggers live outside Silk, so an internal `true` can only be a stale
		// presentation callback. Only a dismissal while the owner still wants the
		// sheet open is actionable.
		if (nextPresented || !desiredPresentedRef.current) {
			return;
		}
		desiredPresentedRef.current = false;
		blurActiveKeyboardInputWithin(contentRef.current);
		onOpenChangeRef.current(false);
	}, []);

	const handleTravelStatusChange = React.useCallback(
		(status: SilkTravelStatus) => {
			travelStatusRef.current = status;
			if (status === "idleInside") {
				applyDesiredPresented();
				reportSettled(true);
				return;
			}
			if (status === "idleOutside") {
				applyDesiredPresented();
				reportSettled(false);
			}
		},
		[applyDesiredPresented, reportSettled],
	);

	React.useLayoutEffect(() => {
		if (!open) {
			return;
		}
		if (suppressPresentAutoFocus) {
			return;
		}
		const active = document.activeElement;
		if (active instanceof HTMLElement) {
			returnFocusRef.current = active;
		}
	}, [open, suppressPresentAutoFocus]);

	React.useLayoutEffect(() => {
		if (open || suppressDismissAutoFocus) {
			return;
		}
		const returnFocus = returnFocusRef.current;
		returnFocusRef.current = null;
		if (
			returnFocus?.isConnected &&
			returnFocus.closest('[aria-hidden="true"], [inert]') === null
		) {
			returnFocus.focus({ preventScroll: true });
		}
	}, [open, suppressDismissAutoFocus]);

	// With inertOutside={false}, Silk's Escape path is best-effort. Mirror
	// dismiss through a per-document LIFO stack of *open* sheets only so a
	// closed retained sidebar cannot steal Escape and nested sheets close
	// topmost-first.
	React.useEffect(() => {
		if (!open) {
			return;
		}
		return registerOpenSheetEscape(document, {
			requestClose: () => {
				handlePresentedChange(false);
			},
		});
	}, [handlePresentedChange, open]);

	// No Silk root before the first open, unless a surface (sidebar) retains
	// its content in the hidden parking host at boot.
	if (!persistClosed && !hasBeenPresented && !open && !isContentRealized) {
		return null;
	}

	return (
		<Sheet.Root
			license="non-commercial"
			sheetRole="dialog"
			presented={presented}
			onPresentedChange={handlePresentedChange}
			style={{ display: "contents" }}
			data-bb-sheet-root=""
			data-state={open ? "open" : "closed"}
		>
			{isContentRealized ? (
				<div
					ref={attachRetainedParking}
					hidden
					aria-hidden="true"
					data-bb-sheet-retained-parking=""
				/>
			) : null}
			<Sheet.Portal>
				<Sheet.View
					{...portalScopeProps}
					contentPlacement={contentPlacement}
					tracks={contentPlacement}
					inertOutside={false}
					nativeEdgeSwipePrevention={contentPlacement !== "bottom"}
					swipeDismissal
					enteringAnimationSettings={skipTravelAnimation}
					exitingAnimationSettings={skipTravelAnimation}
					onTravelStatusChange={handleTravelStatusChange}
					onPresentAutoFocus={{ focus: !suppressPresentAutoFocus }}
					onDismissAutoFocus={{ focus: false }}
					onClickOutside={{ dismiss: true, stopOverlayPropagation: true }}
					onEscapeKeyDown={{ dismiss: true, stopOverlayPropagation: true }}
					data-bb-sheet-view=""
					data-bb-portaled-overlay=""
					data-state={open ? "open" : "closed"}
					aria-label={labelledBy === undefined ? srLabel : undefined}
					aria-labelledby={labelledBy}
					aria-describedby={describedBy}
					className="z-50"
				>
					<Sheet.Backdrop
						data-bb-sheet-backdrop=""
						data-state={open ? "open" : "closed"}
						data-testid={backdropTestId}
						className="bg-black/40"
						travelAnimation={BACKDROP_TRAVEL_ANIMATION}
						// One click path only. Do not also handle pointerup: a primary
						// activation emits pointerup then click and would double-dismiss.
						// View onClickOutside remains enabled for non-backdrop outside taps.
						onClick={(event) => {
							if (event.button !== 0 && event.button !== undefined) {
								return;
							}
							handlePresentedChange(false);
						}}
					/>
					<Sheet.Content
						ref={contentRef}
						style={contentStyle}
						data-bb-sheet-content=""
						data-state={open ? "open" : "closed"}
						className={cn(
							contentPlacement === "bottom"
								? "flex max-h-[92dvh] w-full flex-col rounded-t-xl border bg-background pb-[env(safe-area-inset-bottom)] outline-none"
								: "flex h-full max-h-full w-[min(100vw,20rem)] flex-col border bg-background outline-none",
							contentClassName,
						)}
					>
						{contentPlacement === "bottom" ? (
							<div
								data-bb-sheet-handle=""
								className="mx-auto flex h-8 w-16 shrink-0 items-center justify-center"
								aria-hidden="true"
							>
								<div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
							</div>
						) : null}
						{srLabel === undefined ? null : (
							<Sheet.Title className="sr-only">{srLabel}</Sheet.Title>
						)}
						{describedBy === undefined && srLabel !== undefined ? (
							<Sheet.Description className="sr-only">
								{srLabel}
							</Sheet.Description>
						) : null}
						{isContentRealized ? (
							<div
								className="flex min-h-0 min-w-0 flex-1 flex-col"
								ref={attachRetainedMount}
							/>
						) : (
							<div
								aria-hidden="true"
								className="min-h-32"
								data-bb-sheet-placeholder=""
							/>
						)}
					</Sheet.Content>
				</Sheet.View>
			</Sheet.Portal>
			{isContentRealized && retainedMountRef.current !== null
				? createPortal(children, retainedMountRef.current)
				: null}
		</Sheet.Root>
	);
}
