// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalPluginBrowserPage,
  ExperimentalPluginBrowserPageEvaluateOptions,
  JsonValue,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const { useComposer } = await import("@get-bb/plugin-sdk/app");

afterEach(cleanup);

const pageAnnotation = {
  id: "mfx12abc",
  number: 1,
  comment: "Make this green",
  url: "http://localhost:5173/checkout",
  title: "Checkout",
  viewport: { width: 1280, height: 720 },
  element: {
    tagName: "button",
    name: 'button#pay "Pay now"',
    selector: "#pay",
    text: "Pay",
    attributes: { id: "pay" },
    rect: { x: 40, y: 300, width: 120, height: 36 },
    styles: {},
  },
};

function createFakePage() {
  const listeners = new Set<(data: JsonValue) => void>();
  const evaluate = vi.fn(
    async (
      expression: string,
      options?: ExperimentalPluginBrowserPageEvaluateOptions,
    ): Promise<JsonValue> => {
      if (options?.world === "main") {
        return {
          components: [
            { name: "SubmitButton", source: "src/SubmitButton.tsx:12" },
          ],
        };
      }
      return expression.includes(".activate()")
        ? { active: true, count: 0 }
        : { active: false, count: 0 };
    },
  );
  const page: ExperimentalPluginBrowserPage = {
    evaluate,
    onMessage(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    page,
    evaluate,
    emit(data: JsonValue) {
      for (const listener of listeners) {
        listener(data);
      }
    },
  };
}

function registration() {
  const action = app.browserToolbarActions[0];
  if (action === undefined) {
    throw new Error("Expected the browser toolbar action.");
  }
  return action;
}

describe("AnnotateAction", () => {
  it("activates from the toolbar and adds saved annotations to the prompt", async () => {
    const fake = createFakePage();
    const slot = renderSlot(
      registration(),
      {
        threadId: "thr_1",
        tabId: "browser:1",
        url: "http://localhost:5173/checkout",
        isCompactViewport: false,
        experimental_page: fake.page,
      },
      {
        rpc: {
          save: () => ({ id: "ann_saved" }),
          update: () => ({ id: pageAnnotation.id }),
        },
      },
    );

    fireEvent.click(slot.getByRole("button", { name: "Annotate elements" }));
    await waitFor(() => {
      expect(
        slot
          .getByRole("button", { name: "Stop annotating" })
          .getAttribute("aria-pressed"),
      ).toBe("true");
    });
    expect(
      fake.evaluate.mock.calls.some(([expression]) =>
        expression.includes("__bbAgentAnnotations.activate()"),
      ),
    ).toBe(true);

    act(() => {
      fake.emit({ type: "annotation", annotation: pageAnnotation });
    });
    await waitFor(() => {
      expect(slot.inspection.composer.mentions).toEqual([
        {
          provider: "annotation",
          id: "ann_saved",
          label: '1. button#pay "Pay now"',
        },
      ]);
    });
    expect(slot.inspection.rpcCalls).toEqual([
      {
        method: "save",
        input: {
          ...pageAnnotation,
          components: [
            { name: "SubmitButton", source: "src/SubmitButton.tsx:12" },
          ],
        },
      },
    ]);
    expect(fake.evaluate).toHaveBeenCalledWith(
      expect.stringContaining("__reactFiber$"),
      { world: "main" },
    );

    act(() => {
      fake.emit({
        type: "annotation-update",
        id: pageAnnotation.id,
        comment: "Make this blue",
      });
    });
    await waitFor(() => {
      expect(slot.inspection.rpcCalls.at(-1)).toEqual({
        method: "update",
        input: { id: pageAnnotation.id, comment: "Make this blue" },
      });
    });
    expect(slot.inspection.composer.mentions).toHaveLength(1);

    act(() => {
      fake.emit({ type: "state", active: false, count: 1 });
    });
    expect(
      slot
        .getByRole("button", { name: "Annotate elements" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(slot.getByTestId("agent-annotations-count").textContent).toBe("1");
  });

  it("removes deleted mentions and clears page annotations on submission, not draft clearing", async () => {
    const fake = createFakePage();
    const action = registration();
    const AnnotateAction = action.component;
    const slot = renderSlot(
      {
        ...action,
        component: (props) => {
          const composer = useComposer();
          return (
            <>
              <AnnotateAction {...props} />
              <button
                onClick={() => {
                  void composer.experimental_submit({
                    experimental_data: null,
                  });
                }}
              >
                Submit test
              </button>
            </>
          );
        },
      },
      {
        threadId: "thr_1",
        tabId: "browser:1",
        url: "http://localhost/",
        isCompactViewport: false,
        experimental_page: fake.page,
      },
      { rpc: { save: () => ({ id: pageAnnotation.id }) } },
    );
    act(() => fake.emit({ type: "annotation", annotation: pageAnnotation }));
    await waitFor(() =>
      expect(slot.inspection.composer.mentions).toHaveLength(1),
    );
    act(() => fake.emit({ type: "annotation-delete", id: pageAnnotation.id }));
    await waitFor(() =>
      expect(slot.inspection.composer.mentions).toHaveLength(0),
    );
    await slot.behavior.setComposerText("");
    expect(
      fake.evaluate.mock.calls.some(([expression]) =>
        expression.includes(".clear()"),
      ),
    ).toBe(false);
    await slot.behavior.setComposerText("Send this");
    fireEvent.click(slot.getByRole("button", { name: "Submit test" }));
    await waitFor(() =>
      expect(
        fake.evaluate.mock.calls.some(([expression]) =>
          expression.includes(".clear()"),
        ),
      ).toBe(true),
    );
  });

  it("ignores malformed page messages", async () => {
    const fake = createFakePage();
    const slot = renderSlot(
      registration(),
      {
        threadId: "thr_1",
        tabId: "browser:1",
        url: "http://localhost:5173/",
        isCompactViewport: false,
        experimental_page: fake.page,
      },
      { rpc: { save: () => ({ id: "ann_saved" }) } },
    );

    act(() => {
      fake.emit({ type: "annotation", annotation: { id: "x" } });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(slot.inspection.rpcCalls).toEqual([]);
    expect(slot.inspection.composer.mentions).toEqual([]);
  });

  it("is disabled outside the desktop app", () => {
    const slot = renderSlot(registration(), {
      threadId: "thr_1",
      tabId: "browser:1",
      url: "https://example.com/",
      isCompactViewport: false,
      experimental_page: null,
    });

    const button = slot.getByRole("button", {
      name: "Annotate elements is available in the desktop app",
    });
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
