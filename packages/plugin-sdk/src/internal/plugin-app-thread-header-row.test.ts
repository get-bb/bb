import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Row = () => null;
const OtherRow = () => null;

describe("experimental_threadHeaderRow registration", () => {
  it("collects rows in registration order with their order", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.experimental_threadHeaderRow({
          id: "tabs",
          order: 2,
          component: Row,
        });
        app.slots.experimental_threadHeaderRow({
          id: "status",
          component: OtherRow,
        });
      },
    });
    expect(captured.threadHeaderRows).toEqual([
      { id: "tabs", order: 2, component: Row },
      { id: "status", component: OtherRow },
    ]);
  });

  it("rejects a duplicate id", () => {
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadHeaderRow({
            id: "tabs",
            component: Row,
          });
          app.slots.experimental_threadHeaderRow({
            id: "tabs",
            component: OtherRow,
          });
        },
      }),
    ).toThrow(/slots\.experimental_threadHeaderRow.*duplicate/i);
  });

  it("rejects an invalid id, order or component", () => {
    const register = (registration: unknown) => () =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadHeaderRow(
            // @ts-expect-error Exercise the JavaScript registration boundary.
            registration,
          );
        },
      });
    expect(register({ id: "bad id", component: Row })).toThrow(
      /experimental_threadHeaderRow/,
    );
    expect(register({ id: "tabs", order: "1", component: Row })).toThrow(
      /experimental_threadHeaderRow/,
    );
    expect(register({ id: "tabs", component: "Row" })).toThrow(
      /experimental_threadHeaderRow/,
    );
  });
});
