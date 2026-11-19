import { describe, expect, it } from "vitest";
import type { ExperimentalPageRegistration } from "@get-bb/plugin-sdk";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Page = () => null;

function collect(registration: ExperimentalPageRegistration) {
  return collectPluginAppRegistrations({
    __bbPluginApp: true,
    setup(app) {
      app.slots.experimental_page(registration);
    },
  });
}

describe("experimental_page registration", () => {
  it("collects routes once each, in order, with the declared chrome", () => {
    const captured = collect({
      id: "chat",
      title: "Chat",
      routes: ["thread", "home", "thread"],
      chrome: { sidebar: "hidden" },
      component: Page,
    });
    expect(captured.pages).toEqual([
      {
        id: "chat",
        title: "Chat",
        routes: ["thread", "home"],
        chrome: { sidebar: "hidden" },
        component: Page,
      },
    ]);
  });

  it.each([
    [[], "at least one route"],
    [["settings"], "must be one of"],
  ])("rejects routes %j", (routes, message) => {
    expect(() =>
      collect({
        id: "chat",
        title: "Chat",
        routes: routes as ExperimentalPageRegistration["routes"],
        chrome: { sidebar: "shown" },
        component: Page,
      }),
    ).toThrow(message);
  });

  it("rejects an unknown sidebar chrome value", () => {
    expect(() =>
      collect({
        id: "chat",
        title: "Chat",
        routes: ["home"],
        chrome: {
          sidebar: "collapsed",
        } as unknown as ExperimentalPageRegistration["chrome"],
        component: Page,
      }),
    ).toThrow('"chrome.sidebar"');
  });
});
