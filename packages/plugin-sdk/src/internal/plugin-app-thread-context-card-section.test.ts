import { describe, expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Section = () => null;

function collect(registration: object) {
  const warnings: string[] = [];
  const captured = collectPluginAppRegistrations(
    {
      __bbPluginApp: true,
      setup(app) {
        app.slots.experimental_threadContextCardSection(
          // @ts-expect-error Exercise registrations from plugins built against older SDKs.
          registration,
        );
      },
    },
    (message) => warnings.push(message),
  );
  return { sections: captured.threadContextCardSections, warnings };
}

describe("experimental_threadContextCardSection registration", () => {
  it.each([
    [
      "no title",
      { id: "deploys", group: "2_deploys", component: Section },
      null,
      [],
    ],
    [
      "a title from an older SDK",
      {
        id: "deploys",
        title: "Deploys",
        group: "2_deploys",
        component: Section,
      },
      "Deploys",
      [expect.stringMatching(/"title" is retired.*experimental_InfoSection/)],
    ],
    [
      "a blank title",
      { id: "deploys", title: " ", group: "2_deploys", component: Section },
      null,
      [expect.stringMatching(/"title" ignored/)],
    ],
    [
      "a non-string title",
      { id: "deploys", title: 3, group: "2_deploys", component: Section },
      null,
      [expect.stringMatching(/"title" ignored/)],
    ],
  ])(
    "collects a section with %s",
    (_name, registration, legacyTitle, warnings) => {
      const collected = collect(registration);
      expect(collected.sections).toEqual([
        { id: "deploys", group: "2_deploys", component: Section, legacyTitle },
      ]);
      expect(collected.warnings).toEqual(warnings);
    },
  );
});
