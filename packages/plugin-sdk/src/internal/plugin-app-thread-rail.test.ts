import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Rail = () => null;
const OtherRail = () => null;

describe("experimental_threadRail and experimental_threadRailOutline registration", () => {
  it("collects items in registration order with their order", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.experimental_threadRail({
          id: "outline",
          order: 2,
          component: Rail,
        });
        app.slots.experimental_threadRail({ id: "map", component: OtherRail });
      },
    });
    expect(captured.threadRails).toEqual([
      { id: "outline", order: 2, component: Rail },
      { id: "map", component: OtherRail },
    ]);
  });

  it("rejects a duplicate id and an invalid order", () => {
    const register =
      (...registrations: unknown[]) =>
      () =>
        collectPluginAppRegistrations({
          __bbPluginApp: true,
          setup(app) {
            for (const registration of registrations) {
              app.slots.experimental_threadRail(
                // @ts-expect-error Exercise the JavaScript registration boundary.
                registration,
              );
            }
          },
        });
    expect(
      register(
        { id: "outline", component: Rail },
        { id: "outline", component: OtherRail },
      ),
    ).toThrow(/slots\.experimental_threadRail.*duplicate/i);
    expect(register({ id: "outline", order: "1", component: Rail })).toThrow(
      /experimental_threadRail/,
    );
  });

  it("collects outlines without an order and rejects a duplicate id", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.experimental_threadRailOutline({
          id: "threadline",
          component: Rail,
        });
      },
    });
    expect(captured.threadRailOutlines).toEqual([
      { id: "threadline", component: Rail },
    ]);
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadRailOutline({
            id: "a",
            component: Rail,
          });
          app.slots.experimental_threadRailOutline({
            id: "a",
            component: OtherRail,
          });
        },
      }),
    ).toThrow(/slots\.experimental_threadRailOutline.*duplicate/i);
  });
});
