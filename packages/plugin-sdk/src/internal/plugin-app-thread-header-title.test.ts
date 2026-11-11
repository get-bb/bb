import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Title = () => null;
const OtherTitle = () => null;

describe("experimental_threadHeaderTitle registration", () => {
  it("collects titles in registration order", () => {
    const captured = collectPluginAppRegistrations({
      __bbPluginApp: true,
      setup(app) {
        app.slots.experimental_threadHeaderTitle({
          id: "breadcrumb",
          component: Title,
        });
        app.slots.experimental_threadHeaderTitle({
          id: "fallback",
          component: OtherTitle,
        });
      },
    });
    expect(captured.threadHeaderTitles).toEqual([
      { id: "breadcrumb", component: Title },
      { id: "fallback", component: OtherTitle },
    ]);
  });

  it("rejects a duplicate id", () => {
    expect(() =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadHeaderTitle({
            id: "breadcrumb",
            component: Title,
          });
          app.slots.experimental_threadHeaderTitle({
            id: "breadcrumb",
            component: OtherTitle,
          });
        },
      }),
    ).toThrow(/slots\.experimental_threadHeaderTitle.*duplicate/i);
  });

  it("rejects an invalid id or component", () => {
    const register = (registration: unknown) => () =>
      collectPluginAppRegistrations({
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadHeaderTitle(
            // @ts-expect-error Exercise the JavaScript registration boundary.
            registration,
          );
        },
      });
    expect(register({ id: "bad id", component: Title })).toThrow(
      /experimental_threadHeaderTitle/,
    );
    expect(register({ component: Title })).toThrow(
      /experimental_threadHeaderTitle/,
    );
    expect(register({ id: "breadcrumb", component: "Title" })).toThrow(
      /experimental_threadHeaderTitle/,
    );
  });
});
