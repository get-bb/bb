import { describe, expect, it } from "vitest";
import type { PluginAppSlots } from "../app-contract.js";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Summary = () => null;
const Row = () => null;
const useVisible = () => true;

function collect(setup: (slots: PluginAppSlots) => void) {
  return collectPluginAppRegistrations({
    __bbPluginApp: true,
    setup(app) {
      setup(app.slots);
    },
  });
}

describe("experimental_threadContextItem", () => {
  it("collects the banner part with the item's title and the card part's kind", () => {
    const collected = collect((slots) => {
      slots.experimental_threadContextItem({
        id: "deploy",
        title: "Deploy",
        group: "2_deploy",
        order: 5,
        banner: { summary: Summary, useVisible },
        card: { row: Row },
      });
      slots.experimental_threadContextItem({
        id: "reviews",
        title: "Reviews",
        group: "1_related",
        card: { section: Row },
      });
    });
    expect(collected.threadContextItems).toEqual([
      {
        id: "deploy",
        group: "2_deploy",
        order: 5,
        banner: { title: "Deploy", summary: Summary, useVisible },
        card: { kind: "row", component: Row },
      },
      {
        id: "reviews",
        group: "1_related",
        banner: null,
        card: { kind: "section", component: Row, legacyTitle: null },
      },
    ]);
  });

  it.each([
    ["no part", {}, /give a "banner" part, a "card" part, or both/],
    [
      "a card with both kinds",
      { card: { row: Row, section: Row } },
      /exactly one of "row" or "section"/,
    ],
    [
      "a card with neither kind",
      { card: {} },
      /exactly one of "row" or "section"/,
    ],
    [
      "a banner without a summary",
      { banner: { details: Summary } },
      /"banner.summary" must be a React component function/,
    ],
  ])("rejects %s", (_name, parts, message) => {
    expect(() =>
      collect((slots) => {
        slots.experimental_threadContextItem({
          id: "deploy",
          title: "Deploy",
          group: "2_deploy",
          ...(parts as object),
        });
      }),
    ).toThrow(message);
  });

  it.each([
    "experimental_threadContextSegment",
    "experimental_threadContextCardRow",
    "experimental_threadContextCardSection",
  ] as const)(
    "rejects an item id that %s already uses, in either order",
    (legacy) => {
      const registerLegacy = (slots: PluginAppSlots) => {
        if (legacy === "experimental_threadContextSegment") {
          slots.experimental_threadContextSegment({
            id: "deploy",
            title: "Deploy",
            group: "2_deploy",
            summary: Summary,
          });
        } else {
          slots[legacy]({ id: "deploy", group: "2_deploy", component: Row });
        }
      };
      const registerItem = (slots: PluginAppSlots) =>
        slots.experimental_threadContextItem({
          id: "deploy",
          title: "Deploy",
          group: "2_deploy",
          card: { row: Row },
        });
      expect(() =>
        collect((slots) => {
          registerLegacy(slots);
          registerItem(slots);
        }),
      ).toThrow(/already a thread context segment, card row or card section/);
      expect(() =>
        collect((slots) => {
          registerItem(slots);
          registerLegacy(slots);
        }),
      ).toThrow(/already a thread context item/);
    },
  );

  it("still lets a legacy segment and card row share an id", () => {
    const collected = collect((slots) => {
      slots.experimental_threadContextSegment({
        id: "deploy",
        title: "Deploy",
        group: "2_deploy",
        summary: Summary,
      });
      slots.experimental_threadContextCardRow({
        id: "deploy",
        group: "2_deploy",
        component: Row,
      });
    });
    expect(collected.threadContextSegments.map(({ id }) => id)).toEqual([
      "deploy",
    ]);
    expect(collected.threadContextCardRows.map(({ id }) => id)).toEqual([
      "deploy",
    ]);
  });
});
