// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeFlowLayout, setFakeHeight } from "@/test/fake-flow-layout";
import { ScrollPositionKeeper } from "./scroll-position-keeper";

const THRESHOLD_PX = 4;
const SEED_COUNT = Number(process.env.KEEPER_MODEL_SEEDS ?? 200);
const STEPS_PER_SEED = 40;
const SETTLE_MS = 3_600;

interface Row {
  id: string;
  height: number;
}

type StepKind = "reader" | "layout" | "navigation";

interface Step {
  kind: StepKind;
  label: string;
  heldRowId?: string;
  run: () => void;
}

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick from empty list");
      return item;
    },
  };
}

let restoreLayout: (() => void) | null = null;

afterEach(() => {
  restoreLayout?.();
  restoreLayout = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function runSeed(seed: number): string[] {
  const random = createRandom(seed);
  const deferWrites = random.next() < 0.5;
  let nextId = 0;
  const newRow = (): Row => ({
    id: `r${nextId++}`,
    height: random.int(20, 420),
  });
  let rows: Row[] = Array.from({ length: random.int(1, 30) }, newRow);
  const initiallyAttached = random.next() < 0.7;

  const scrollElement = document.createElement("div");
  const content = document.createElement("div");
  const items = document.createElement("div");
  items.setAttribute("data-timeline-items", "");
  content.append(items);
  const floor = initiallyAttached ? document.createElement("div") : null;
  if (floor === null) {
    scrollElement.append(content);
  } else {
    const scrollContent = document.createElement("div");
    scrollContent.append(floor, content);
    scrollElement.append(scrollContent);
  }
  document.body.append(scrollElement);
  let viewportHeight = random.int(300, 900);
  const layout = installFakeFlowLayout({ scrollElement, viewportHeight });
  const elements = new Map<string, HTMLElement>();
  const render = () => {
    items.replaceChildren(
      ...rows.map((row) => {
        const element = elements.get(row.id) ?? document.createElement("div");
        elements.set(row.id, element);
        element.setAttribute("data-timeline-row-id", row.id);
        setFakeHeight(element, row.height);
        return element;
      }),
    );
  };
  render();
  const keeper = new ScrollPositionKeeper({
    bottomThresholdPx: THRESHOLD_PX,
    deferWritesWhileScrolling: deferWrites,
    getContentElement: () => content,
    getFloorElement: () => floor,
    getFooterElement: () => null,
    getScrollElement: () => scrollElement,
    getTopLevelRows: () =>
      items.querySelectorAll<HTMLElement>(":scope > [data-timeline-row-id]"),
    initiallyAttached,
  });
  const disconnect = keeper.connect(scrollElement);
  restoreLayout = () => {
    disconnect();
    layout.restore();
  };

  const history: string[] = [
    `seed ${seed} ${initiallyAttached ? "timeline" : "detail box"} deferWrites=${deferWrites}`,
  ];
  const fromEnd = () => layout.maxScrollTop() - layout.scrollTop;
  const topOf = (id: string) =>
    elements.get(id)?.isConnected === true
      ? elements.get(id)!.getBoundingClientRect().top
      : null;

  const browserLayout = () => {
    const fireScroll = () => {
      if (layout.takeClamp()) scrollElement.dispatchEvent(new Event("scroll"));
    };
    if (random.next() < 0.5) {
      fireScroll();
      layout.flushResizeObservers();
      fireScroll();
    } else {
      layout.flushResizeObservers();
      fireScroll();
    }
  };
  const changeRows = (next: Row[]) => {
    rows = next;
    render();
    browserLayout();
  };
  const randomIndex = () => random.int(0, Math.max(0, rows.length - 1));

  const steps: Array<{ weight: number; make: () => Step }> = [
    {
      weight: 6,
      make: () => {
        const toEnd = random.next() < 0.2;
        const delta = random.int(-900, 900);
        return {
          kind: "reader",
          label: toEnd ? "wheel to end" : `wheel ${delta}`,
          run: () =>
            layout.userScrollTo(
              toEnd ? layout.maxScrollTop() : layout.scrollTop + delta,
            ),
        };
      },
    },
    {
      weight: 4,
      make: () => {
        const delta = random.int(-700, 700);
        return {
          kind: "reader",
          label: `touch drag ${delta}`,
          run: () => {
            scrollElement.dispatchEvent(new TouchEvent("touchstart"));
            layout.layoutScrollTo(layout.scrollTop + delta);
            scrollElement.dispatchEvent(new TouchEvent("touchend"));
          },
        };
      },
    },
    {
      weight: 4,
      make: () => {
        const visible = rows.filter((row) => {
          const top = topOf(row.id);
          return top !== null && top >= 0 && top < viewportHeight;
        });
        const row = visible.length === 0 ? null : random.pick(visible);
        const height = random.int(20, 600);
        return {
          kind: "layout",
          label: `tap toggle row ${row?.id ?? "none"} to ${height}`,
          ...(row === null ? {} : { heldRowId: row.id }),
          run: () => {
            if (row === null) return;
            scrollElement.dispatchEvent(new TouchEvent("touchstart"));
            scrollElement.dispatchEvent(new TouchEvent("touchend"));
            const element = elements.get(row.id);
            if (element !== undefined) keeper.hold(element, "top");
            changeRows(
              rows.map((candidate) =>
                candidate.id === row.id ? { ...candidate, height } : candidate,
              ),
            );
            keeper.reconcile();
          },
        };
      },
    },
    {
      weight: 4,
      make: () => {
        const index = randomIndex();
        const height = random.int(20, 600);
        return {
          kind: "layout",
          label: `resize row ${index} to ${height}`,
          run: () =>
            changeRows(
              rows.map((row, current) =>
                current === index ? { ...row, height } : row,
              ),
            ),
        };
      },
    },
    {
      weight: 4,
      make: () => {
        const count = random.int(1, 3);
        return {
          kind: "layout",
          label: `append ${count}`,
          run: () =>
            changeRows([...rows, ...Array.from({ length: count }, newRow)]),
        };
      },
    },
    {
      weight: 3,
      make: () => {
        const grow = random.int(5, 200);
        return {
          kind: "layout",
          label: `stream into last row +${grow}`,
          run: () =>
            changeRows(
              rows.map((row, index) =>
                index === rows.length - 1
                  ? { ...row, height: row.height + grow }
                  : row,
              ),
            ),
        };
      },
    },
    {
      weight: 2,
      make: () => {
        const count = random.int(1, 3);
        return {
          kind: "layout",
          label: `remove last ${count}`,
          run: () =>
            changeRows(rows.slice(0, Math.max(1, rows.length - count))),
        };
      },
    },
    {
      weight: 3,
      make: () => {
        const count = random.int(1, 8);
        return {
          kind: "layout",
          label: `prepend ${count}`,
          run: () =>
            changeRows([...Array.from({ length: count }, newRow), ...rows]),
        };
      },
    },
    {
      weight: 2,
      make: () => {
        const index = randomIndex();
        return {
          kind: "layout",
          label: `regroup rows ${index}..${index + 1}`,
          run: () => {
            const first = rows[index];
            const second = rows[index + 1];
            if (first === undefined || second === undefined) return;
            const merged = {
              id: `r${nextId++}`,
              height: first.height + second.height - random.int(0, 40),
            };
            changeRows([
              ...rows.slice(0, index),
              merged,
              ...rows.slice(index + 2),
            ]);
          },
        };
      },
    },
    {
      weight: 2,
      make: () => {
        const index = randomIndex();
        const shrunk = random.int(10, 60);
        return {
          kind: "layout",
          label: `shrink row ${index} to ${shrunk} for one frame`,
          run: () => {
            const original = rows;
            changeRows(
              rows.map((row, current) =>
                current === index ? { ...row, height: shrunk } : row,
              ),
            );
            changeRows(original);
          },
        };
      },
    },
    {
      weight: floor === null ? 0 : 2,
      make: () => {
        const index = randomIndex();
        const shrunk = random.int(10, 60);
        return {
          kind: "layout",
          label: `shrink row ${index} to ${shrunk} and back before the frame ends`,
          run: () => {
            const original = rows;
            rows = rows.map((row, current) =>
              current === index ? { ...row, height: shrunk } : row,
            );
            render();
            void scrollElement.scrollHeight;
            rows = original;
            render();
            layout.flushResizeObservers();
            if (layout.takeClamp()) {
              scrollElement.dispatchEvent(new Event("scroll"));
            }
          },
        };
      },
    },
    {
      weight: 2,
      make: () => {
        const height = random.int(250, 1000);
        return {
          kind: "layout",
          label: `viewport ${height}`,
          run: () => {
            viewportHeight = height;
            layout.setViewportHeight(height);
            browserLayout();
          },
        };
      },
    },
    {
      weight: 2,
      make: () => {
        const fraction = random.next();
        return {
          kind: "navigation",
          label: `navigate to ${fraction.toFixed(2)}`,
          run: () =>
            keeper.scrollTo(
              Math.round(fraction * (layout.maxScrollTop() + 200)),
              "instant",
            ),
        };
      },
    },
    {
      weight: 2,
      make: () => {
        const index = randomIndex();
        const missing = random.next() < 0.15;
        const offset = random.int(0, 300);
        const atBottom = random.next() < 0.2;
        return {
          kind: "navigation",
          label: `restore ${missing ? "missing row" : `row ${index}`} offset ${offset}${atBottom ? " at bottom" : ""}`,
          run: () =>
            keeper.restore({
              rowId: missing ? "not-loaded" : (rows[index]?.id ?? "none"),
              offsetWithinRow: offset,
              atBottom,
            }),
        };
      },
    },
    {
      weight: 1,
      make: () => ({
        kind: "navigation",
        label: "jump to bottom",
        run: () => keeper.scrollToBottom(),
      }),
    },
  ];
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
  const nextStep = (): Step => {
    let roll = random.next() * totalWeight;
    for (const step of steps) {
      roll -= step.weight;
      if (roll < 0) return step.make();
    }
    return steps[0]!.make();
  };

  const settle = () => {
    vi.advanceTimersByTime(SETTLE_MS);
    keeper.reconcile();
    vi.advanceTimersByTime(50);
  };
  const fail = (message: string): never =>
    expect.fail(
      `${message}\n  scrollTop=${layout.scrollTop} max=${layout.maxScrollTop()} attached=${keeper.isAttached()}\n  ${history.join("\n  ")}`,
    );

  settle();
  for (let index = 0; index < STEPS_PER_SEED; index += 1) {
    const step = nextStep();
    history.push(step.label);
    const wasAttached = keeper.isAttached();
    const position = keeper.getPosition();
    const anchorKey =
      step.heldRowId ??
      (position.kind === "anchor" && keeper.pendingRestoreRowId() === null
        ? position.key
        : null);
    const anchorTop = anchorKey === null ? null : topOf(anchorKey);

    step.run();
    const afterGesture = layout.scrollTop;
    const transform = content.style.transform;
    const runState = `${Math.round(layout.scrollTop)}/${Math.round(layout.maxScrollTop())} ${keeper.isAttached() ? "attached" : "detached"}${transform === "" ? "" : ` ${transform}`}`;
    settle();
    history[history.length - 1] +=
      `  [after: ${runState}; settled: ${Math.round(layout.scrollTop)}/${Math.round(layout.maxScrollTop())} ${keeper.isAttached() ? "attached" : "detached"}]`;

    const attached = keeper.isAttached();
    const atEnd = fromEnd() <= THRESHOLD_PX;
    const placed = keeper.getPosition().kind !== "free";
    if (attached !== atEnd && (attached || placed)) {
      fail(
        attached
          ? "attached but not at the end"
          : "detached while at the end (scroll-to-bottom button shows at the bottom)",
      );
    }
    if (step.kind === "layout" && wasAttached && !attached) {
      fail("a content change detached the reader");
    }
    if (
      step.kind === "layout" &&
      !attached &&
      anchorKey !== null &&
      anchorTop !== null
    ) {
      const top = topOf(anchorKey);
      const clamped =
        layout.scrollTop <= 0.5 ||
        layout.scrollTop >= layout.maxScrollTop() - 0.5;
      if (top !== null && !clamped && Math.abs(top - anchorTop) > 1) {
        fail(
          `the reading row ${anchorKey} moved from ${anchorTop} to ${top} without the reader`,
        );
      }
    }
    if (step.kind === "reader" && !attached) {
      if (Math.abs(layout.scrollTop - afterGesture) > 1) {
        fail(
          `the reader's scroll to ${afterGesture} was moved to ${layout.scrollTop}`,
        );
      }
    }
  }
  return history;
}

describe("ScrollPositionKeeper model", () => {
  it(
    `keeps the button, the bottom, and the reading row consistent across ${SEED_COUNT} random sequences`,
    { timeout: SEED_COUNT * 200 },
    () => {
      vi.useFakeTimers({
        toFake: [
          "setTimeout",
          "clearTimeout",
          "requestAnimationFrame",
          "cancelAnimationFrame",
          "performance",
        ],
      });
      for (let seed = 1; seed <= SEED_COUNT; seed += 1) {
        runSeed(seed);
        restoreLayout?.();
        restoreLayout = null;
        document.body.replaceChildren();
      }
    },
  );
});
