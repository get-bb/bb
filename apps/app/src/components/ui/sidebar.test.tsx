// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { memo } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
	Sidebar,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
	useIsSidebarShowing,
	useOptionalIsSidebarShowing,
	useSidebar,
} from "./sidebar";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

// Matches SIDEBAR_MOBILE_DRAG_SETTLE_MS: fallback clear for the held-body
// closing latch after open flips immediately.
const MOBILE_TOGGLE_SETTLE_MS = 220;

function settleMobileToggle() {
	act(() => {
		vi.advanceTimersByTime(MOBILE_TOGGLE_SETTLE_MS);
	});
}

function createTouch(clientX: number, clientY: number): Touch {
	return { identifier: 1, clientX, clientY } as Touch;
}

function createTouchList(...touches: Touch[]): TouchList {
	const touchList = {
		length: touches.length,
		item: (index: number) => touches[index] ?? null,
	};
	touches.forEach((touch, index) => {
		Object.defineProperty(touchList, index, { value: touch });
	});
	return touchList as unknown as TouchList;
}

function fireTouch(
	target: Element | Document | Window,
	type: "touchstart" | "touchmove" | "touchend",
	touch: Touch,
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		touches: {
			value: type === "touchend" ? createTouchList() : createTouchList(touch),
		},
		changedTouches: { value: createTouchList(touch) },
	});
	fireEvent(target, event);
}

function firePointer(
	target: Element | Document | Window,
	type: "pointerdown" | "pointermove",
	clientX: number,
	clientY: number,
) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, {
		pointerId: { value: 1 },
		pointerType: { value: "touch" },
		isPrimary: { value: true },
		button: { value: 0 },
		buttons: { value: 1 },
		clientX: { value: clientX },
		clientY: { value: clientY },
	});
	fireEvent(target, event);
}

function renderScrollerSwipeHarness() {
	render(
		<CompactViewportOverrideProvider isCompactViewport>
			<SidebarProvider>
				<Sidebar>Sidebar content</Sidebar>
				<SidebarInset>
					<div data-testid="scroller" style={{ overflowX: "auto" }}>
						<div data-sidebar-swipe-selectable>Wide code block</div>
					</div>
				</SidebarInset>
			</SidebarProvider>
		</CompactViewportOverrideProvider>,
	);
	const scroller = screen.getByTestId("scroller");
	let scrollWidthReads = 0;
	Object.defineProperty(scroller, "scrollWidth", {
		get: () => {
			scrollWidthReads += 1;
			return 500;
		},
	});
	Object.defineProperty(scroller, "clientWidth", { get: () => 100 });
	return {
		prose: screen.getByText("Wide code block"),
		getScrollWidthReads: () => scrollWidthReads,
	};
}

function renderSelectableSwipeHarness() {
	render(
		<CompactViewportOverrideProvider isCompactViewport>
			<SidebarProvider>
				<Sidebar>Sidebar content</Sidebar>
				<SidebarInset>
					<div data-sidebar-swipe-selectable>Selectable message prose</div>
				</SidebarInset>
			</SidebarProvider>
		</CompactViewportOverrideProvider>,
	);
}

function OptionalSidebarProbe() {
	const isShowing = useOptionalIsSidebarShowing();
	return <div data-sidebar-showing={String(isShowing)} />;
}

describe("useOptionalIsSidebarShowing", () => {
	it("returns null outside SidebarProvider instead of throwing", () => {
		expect(renderToString(<OptionalSidebarProbe />)).toContain(
			'data-sidebar-showing="null"',
		);
	});
});

describe("useIsSidebarShowing", () => {
	it("re-renders its reader only when the visible bit flips, not on every provider commit", () => {
		vi.useFakeTimers();
		const showingRenders: boolean[] = [];
		const ShowingReader = memo(function ShowingReader() {
			const isShowing = useIsSidebarShowing();
			showingRenders.push(isShowing);
			return <output data-testid="showing">{String(isShowing)}</output>;
		});
		function Controls() {
			const { openMobileSidebar, closeMobileSidebar } = useSidebar();
			return (
				<>
					<button type="button" onClick={openMobileSidebar}>
						open
					</button>
					<button type="button" onClick={closeMobileSidebar}>
						close
					</button>
				</>
			);
		}
		render(
			<CompactViewportOverrideProvider isCompactViewport>
				<SidebarProvider>
					<ShowingReader />
					<Controls />
				</SidebarProvider>
			</CompactViewportOverrideProvider>,
		);
		expect(screen.getByTestId("showing").textContent).toBe("false");
		const settled = showingRenders.length;

		fireEvent.click(screen.getByRole("button", { name: "open" }));
		// Open flips immediately so Silk can start travel without a pre-delay.
		expect(screen.getByTestId("showing").textContent).toBe("true");
		const afterOpen = showingRenders.length;
		expect(afterOpen).toBe(settled + 1);

		// Close flips openMobile immediately; the held-body closing latch must
		// not produce an extra showing-bit render.
		fireEvent.click(screen.getByRole("button", { name: "close" }));
		expect(screen.getByTestId("showing").textContent).toBe("false");
		expect(showingRenders).toHaveLength(afterOpen + 1);
		settleMobileToggle();
		expect(showingRenders).toHaveLength(afterOpen + 1);
	});
});

describe("SidebarTrigger", () => {
	it("uses the shared sidebar icon on every viewport", () => {
		const markup = renderToString(
			<SidebarProvider>
				<SidebarTrigger />
			</SidebarProvider>,
		);

		expect(markup).toContain('data-icon="PanelLeft"');
		expect(markup).not.toContain('data-icon="AlignLeft"');
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).not.toContain('aria-pressed="');
	});
});

function getMobilePanel(): HTMLElement | null {
	const panel = document.querySelector('[data-sidebar="panel"]');
	return panel instanceof HTMLElement ? panel : null;
}

// Matches SIDEBAR_MOBILE_REALIZE_TIMEOUT_MS: the closed compact drawer
// realizes its subtree at the latest this long after boot.
const MOBILE_REALIZE_TIMEOUT_MS = 1000;

function settleMobileRealization() {
	act(() => {
		vi.advanceTimersByTime(MOBILE_REALIZE_TIMEOUT_MS);
	});
}

function renderCompactSidebarHarness() {
	render(
		<CompactViewportOverrideProvider isCompactViewport>
			<SidebarProvider>
				<Sidebar>Sidebar content</Sidebar>
				<SidebarInset>
					<SidebarTrigger />
					Main content
				</SidebarInset>
			</SidebarProvider>
		</CompactViewportOverrideProvider>,
	);
}

describe("mobile sidebar deferred realization", () => {
	it("parks the closed sidebar content without presenting the Silk view", async () => {
		renderCompactSidebarHarness();
		await act(async () => {
			await new Promise((r) => setTimeout(r, 50));
		});
		const closedPanel = getMobilePanel();
		expect(closedPanel).not.toBeNull();
		expect(closedPanel?.dataset.state).toBe("closed");
		expect(document.querySelector("[data-bb-sheet-root]")).not.toBeNull();
		expect(document.querySelector("[data-bb-sheet-view]")).toBeNull();
		expect(
			document.querySelector("[data-bb-sheet-retained-parking]")?.contains(
				closedPanel,
			),
		).toBe(true);
	});

	it("realizes sidebar content through the provider latch without remounting the panel", async () => {
		vi.useFakeTimers();
		renderCompactSidebarHarness();
		await act(async () => {
			await Promise.resolve();
		});
		const panel = getMobilePanel();
		expect(panel).not.toBeNull();
		settleMobileRealization();
		expect(getMobilePanel()).toBe(panel);
		expect(panel?.dataset.state).toBe("closed");
	});

	it("writes the desktop width on the gap and panel, not on the provider wrapper", () => {
		render(
			<CompactViewportOverrideProvider isCompactViewport={false}>
				<SidebarProvider width="333px" data-testid="wrapper">
					<Sidebar>Sidebar content</Sidebar>
				</SidebarProvider>
			</CompactViewportOverrideProvider>,
		);

		const wrapper = screen.getByTestId("wrapper");
		const gap = document.querySelector('[data-sidebar="gap"]');
		const panel = document.querySelector('[data-sidebar="panel"]');
		if (!(gap instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
			throw new Error("Expected desktop gap and panel");
		}
		expect(gap.style.getPropertyValue("--sidebar-width")).toBe("333px");
		expect(panel.style.getPropertyValue("--sidebar-width")).toBe("333px");
		expect(wrapper.style.getPropertyValue("--sidebar-width")).toBe("");
	});

	it("renders the desktop sidebar subtree synchronously", () => {
		const markup = renderToString(
			<CompactViewportOverrideProvider isCompactViewport={false}>
				<SidebarProvider>
					<Sidebar>Sidebar content</Sidebar>
				</SidebarProvider>
			</CompactViewportOverrideProvider>,
		);

		expect(markup).toContain("Sidebar content");
	});
});

describe("mobile sidebar persistence", () => {
	it("keeps closed drawer content mounted across open/close", () => {
		vi.useFakeTimers();
		renderCompactSidebarHarness();
		settleMobileRealization();
		fireEvent.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
		const openPanel = getMobilePanel();
		expect(openPanel?.dataset.state).toBe("open");
		const sheetContent = document.querySelector("[data-bb-sheet-content]");
		expect(sheetContent).toBeInstanceOf(HTMLElement);
		expect(
			(sheetContent as HTMLElement).style.getPropertyValue(
				"--sidebar-width-mobile",
			),
		).toBe("min(90vw, 320px)");
		fireEvent.click(screen.getByTestId("sidebar-mobile-backdrop"));
		settleMobileToggle();
		expect(getMobilePanel()).toBe(openPanel);
		expect(getMobilePanel()?.dataset.state).toBe("closed");
	});

	it("keeps the pinned trigger interactive and closes on a second press", () => {
		vi.useFakeTimers();
		renderCompactSidebarHarness();
		settleMobileRealization();
		const trigger = screen.getByRole("button", { name: "Toggle Sidebar" });
		fireEvent.click(trigger);
		expect(getMobilePanel()?.dataset.state).toBe("open");
		fireEvent.click(trigger);
		settleMobileToggle();
		expect(getMobilePanel()?.dataset.state).toBe("closed");
	});
});

describe("mobile sidebar swipe-open touch listener scoping", () => {
	function touchMoveRegistrations(spy: {
		mock: { calls: readonly (readonly unknown[])[] };
	}) {
		return spy.mock.calls.filter(([type]) => type === "touchmove");
	}

	it("registers a passive touchmove for touches that start deep in the content", () => {
		renderSelectableSwipeHarness();
		const prose = screen.getByText("Selectable message prose");
		const addSpy = vi.spyOn(window, "addEventListener");

		// Deeper than the edge zone: this is a scroll far more often than a
		// swipe, so it must never make the browser wait on the main thread.
		fireTouch(prose, "touchstart", createTouch(120, 160));

		const registrations = touchMoveRegistrations(addSpy);
		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.[2]).toEqual({ passive: true });

		// The passive session still recognizes intent without preventDefault.
		const move = new Event("touchmove", { bubbles: true, cancelable: true });
		Object.defineProperties(move, {
			touches: { value: createTouchList(createTouch(260, 164)) },
			changedTouches: { value: createTouchList(createTouch(260, 164)) },
		});
		fireEvent(window, move);
		// Open commits on release, not at intent recognition.
		expect(getMobilePanel()?.dataset.state).toBe("closed");
		expect(move.defaultPrevented).toBe(false);
		fireTouch(window, "touchend", createTouch(260, 164));
		expect(getMobilePanel()?.dataset.state).toBe("open");
	});

	it("keeps the non-passive touchmove for edge-zone touches so the swipe can claim the gesture", () => {
		renderSelectableSwipeHarness();
		const prose = screen.getByText("Selectable message prose");
		const addSpy = vi.spyOn(window, "addEventListener");

		fireTouch(prose, "touchstart", createTouch(40, 160));

		const registrations = touchMoveRegistrations(addSpy);
		expect(registrations).toHaveLength(1);
		expect(registrations[0]?.[2]).toEqual({ passive: false });

		const move = new Event("touchmove", { bubbles: true, cancelable: true });
		Object.defineProperties(move, {
			touches: { value: createTouchList(createTouch(180, 164)) },
			changedTouches: { value: createTouchList(createTouch(180, 164)) },
		});
		fireEvent(window, move);
		expect(getMobilePanel()?.dataset.state).toBe("closed");
		expect(move.defaultPrevented).toBe(true);
		fireTouch(window, "touchend", createTouch(180, 164));
		expect(getMobilePanel()?.dataset.state).toBe("open");
	});
});

describe("mobile sidebar text-selection arbitration", () => {
	it("opens from a right swipe that starts over selectable message prose", () => {
		renderSelectableSwipeHarness();
		const prose = screen.getByText("Selectable message prose");

		fireTouch(prose, "touchstart", createTouch(120, 160));
		fireTouch(window, "touchmove", createTouch(260, 164));
		fireTouch(window, "touchend", createTouch(260, 164));

		expect(getMobilePanel()?.dataset.state).toBe("open");
		// Winning release commits open and realizes content in that path.
		expect(getMobilePanel()?.textContent).toContain("Sidebar content");
	});

	it("defers the horizontal-scroll-region probe until horizontal intent", () => {
		const { prose, getScrollWidthReads } = renderScrollerSwipeHarness();

		fireTouch(prose, "touchstart", createTouch(120, 160));

		// The tap path must stay free of forced layout reads (#1269).
		expect(getScrollWidthReads()).toBe(0);

		fireTouch(window, "touchmove", createTouch(260, 164));
		fireTouch(window, "touchmove", createTouch(280, 164));

		// Exactly one probe per gesture, then the swipe cancels.
		expect(getScrollWidthReads()).toBe(1);
		expect(getMobilePanel()?.dataset.state).toBe("closed");
	});

	it("defers the probe on the pointer path as well", () => {
		const { prose, getScrollWidthReads } = renderScrollerSwipeHarness();

		firePointer(prose, "pointerdown", 120, 160);

		expect(getScrollWidthReads()).toBe(0);

		firePointer(window, "pointermove", 260, 164);
		firePointer(window, "pointermove", 280, 164);

		expect(getScrollWidthReads()).toBe(1);
		expect(getMobilePanel()?.dataset.state).toBe("closed");
	});

	it("cancels a swipe whose start target detached before the probe", () => {
		const { prose, getScrollWidthReads } = renderScrollerSwipeHarness();

		fireTouch(prose, "touchstart", createTouch(120, 160));
		prose.remove();
		fireTouch(window, "touchmove", createTouch(260, 164));

		// A detached target reports empty computed style; never probe or open.
		expect(getScrollWidthReads()).toBe(0);
		expect(getMobilePanel()?.dataset.state).toBe("closed");
	});

	it("cancels a pending prose swipe when native text selection begins", () => {
		let hasSelection = false;
		let selectionNode: Node | null = null;
		vi.spyOn(document, "getSelection").mockImplementation(() =>
			hasSelection
				? ({
						anchorNode: selectionNode,
						focusNode: selectionNode,
						isCollapsed: false,
					} as Selection)
				: null,
		);
		renderSelectableSwipeHarness();
		const prose = screen.getByText("Selectable message prose");
		selectionNode = prose.firstChild;

		fireTouch(prose, "touchstart", createTouch(120, 160));
		hasSelection = true;
		fireEvent(document, new Event("selectionchange"));
		fireTouch(window, "touchmove", createTouch(260, 164));

		expect(getMobilePanel()?.dataset.state).toBe("closed");
	});
});
