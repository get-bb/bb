// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageMessageSchema } from "./annotations.js";
import {
  buildActivateExpression,
  buildControllerExpression,
  buildReactProbeExpression,
} from "./page-script.js";

interface Bridge {
  postMessage(data: unknown): void;
}

function evaluate(expression: string, bb: Bridge | null): unknown {
  return new Function("bb", `return (${expression});`)(bb);
}

function shadowRoot(): ShadowRoot {
  const root = document.querySelector("bb-agent-annotations")?.shadowRoot;
  if (root === null || root === undefined) {
    throw new Error("Expected the annotation overlay to be mounted.");
  }
  return root;
}

function requireElement<T extends Element>(element: T | null): T {
  if (element === null) {
    throw new Error("Expected element to exist.");
  }
  return element;
}

let button: HTMLButtonElement;

beforeEach(() => {
  document.body.innerHTML =
    '<main><h1>Checkout</h1><button id="pay" class="btn primary" aria-label="Pay now">Pay</button></main>';
  button = requireElement(document.querySelector<HTMLButtonElement>("#pay"));
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: () => [button, document.body, document.documentElement],
  });
});

afterEach(() => {
  evaluate(buildControllerExpression("deactivate"), null);
  Reflect.deleteProperty(globalThis, "__bbAgentAnnotations");
  document.querySelector("bb-agent-annotations")?.remove();
  Reflect.deleteProperty(document, "elementsFromPoint");
});

describe("agent annotations page script", () => {
  it("selects the clicked element, captures a comment, and posts its context", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);

    expect(
      evaluate(
        buildActivateExpression({ "--bb-primary": "oklch(0.27 0 0)" }),
        bridge,
      ),
    ).toEqual({ active: true, count: 0 });

    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }),
    );
    expect(pageClick).not.toHaveBeenCalled();

    const root = shadowRoot();
    expect(root.querySelector(".editor-title")?.textContent).toBe(
      'button#pay.btn.primary "Pay now"',
    );
    const save = requireElement(root.querySelector<HTMLButtonElement>(".save"));
    expect(save.disabled).toBe(true);
    const textarea = requireElement(root.querySelector("textarea"));
    textarea.value = "  Make this green  ";
    textarea.dispatchEvent(new Event("input"));
    expect(save.disabled).toBe(false);
    save.click();

    const parsed = messages.map((message) => pageMessageSchema.parse(message));
    expect(parsed[0]).toMatchObject({
      type: "annotation",
      annotation: {
        number: 1,
        comment: "Make this green",
        element: {
          tagName: "button",
          selector: "#pay",
          text: "Pay",
          attributes: {
            id: "pay",
            class: "btn primary",
            "aria-label": "Pay now",
          },
        },
      },
    });
    expect(parsed[1]).toEqual({ type: "state", active: true, count: 1 });
    const first = parsed[0];
    if (first?.type !== "annotation") {
      throw new Error("Expected an annotation message first.");
    }
    expect(
      button.hasAttribute(`data-bb-annotation-${first.annotation.id}`),
    ).toBe(true);
    expect(root.querySelector(".pin")?.textContent).toBe("1");
    expect(root.querySelector(".editor")).toBeNull();
  });

  it("edits an existing pin while inactive, preserves its identity, and cancels changes", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    evaluate(buildActivateExpression({}), bridge);
    button.click();
    const root = shadowRoot();
    const input = requireElement(root.querySelector("textarea"));
    input.value = "Original";
    input.dispatchEvent(new Event("input"));
    requireElement(root.querySelector<HTMLButtonElement>(".save")).click();
    const created = pageMessageSchema.parse(messages[0]);
    if (created.type !== "annotation") throw new Error("Expected annotation");
    evaluate(buildControllerExpression("deactivate"), bridge);
    const pin = requireElement(root.querySelector<HTMLButtonElement>(".pin"));
    pin.click();
    const edit = requireElement(root.querySelector("textarea"));
    expect(edit.value).toBe("Original");
    expect(root.querySelector(".save")?.textContent).toBe("Save changes");
    edit.value = "   ";
    edit.dispatchEvent(new Event("input"));
    expect(root.querySelector<HTMLButtonElement>(".save")?.disabled).toBe(true);
    edit.value = "Updated";
    edit.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }),
    );
    expect(messages.at(-1)).toEqual({
      type: "annotation-update",
      id: created.annotation.id,
      comment: "Updated",
    });
    expect(pin.title).toBe("Updated");
    expect(root.querySelectorAll(".pin")).toHaveLength(1);
    expect(evaluate(buildControllerExpression("state"), bridge)).toEqual({
      active: false,
      count: 1,
    });
    pin.click();
    const cancelled = requireElement(root.querySelector("textarea"));
    expect(cancelled.value).toBe("Updated");
    cancelled.value = "Discard this";
    cancelled.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    pin.click();
    expect(root.querySelector("textarea")?.value).toBe("Updated");
    evaluate(buildControllerExpression("clear"), bridge);
    expect(root.querySelector(".editor")).toBeNull();
    expect(root.querySelector(".pin")).toBeNull();
  });

  it("turns off on Escape, releases page clicks, and reuses one overlay", () => {
    const messages: unknown[] = [];
    const bridge: Bridge = { postMessage: (data) => messages.push(data) };
    const pageClick = vi.fn();
    button.addEventListener("click", pageClick);
    evaluate(buildActivateExpression({}), bridge);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(messages).toEqual([{ type: "state", active: false, count: 0 }]);
    expect(evaluate(buildControllerExpression("state"), bridge)).toEqual({
      active: false,
      count: 0,
    });
    button.click();
    expect(pageClick).toHaveBeenCalledTimes(1);

    expect(evaluate(buildActivateExpression({}), bridge)).toEqual({
      active: true,
      count: 0,
    });
    expect(document.querySelectorAll("bb-agent-annotations")).toHaveLength(1);
  });

  it("reads React component names and debug sources from DOM fibers", () => {
    button.setAttribute("data-bb-annotation-abc123", "");
    function SubmitButton() {}
    function CheckoutCard() {}
    Reflect.set(button, "__reactFiber$x1y2", {
      type: "button",
      return: {
        type: SubmitButton,
        _debugSource: { fileName: "src/SubmitButton.tsx", lineNumber: 12 },
        return: {
          type: { render: CheckoutCard },
          _debugStack: {
            stack:
              "Error\n    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)\n    at CheckoutPage (http://localhost:5173/src/CheckoutPage.tsx?t=17:40:7)",
          },
          return: null,
        },
      },
    });

    expect(evaluate(buildReactProbeExpression("abc123"), null)).toEqual({
      components: [
        { name: "SubmitButton", source: "src/SubmitButton.tsx:12" },
        {
          name: "CheckoutCard",
          source: "http://localhost:5173/src/CheckoutPage.tsx:40:7",
        },
      ],
    });
    expect(evaluate(buildReactProbeExpression("missing1"), null)).toBeNull();
    expect(() => buildReactProbeExpression('x"]')).toThrow(
      /Invalid annotation id/,
    );
  });
});
