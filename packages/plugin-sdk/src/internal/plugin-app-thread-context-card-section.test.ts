import { expect, it } from "vitest";
import { collectPluginAppRegistrations } from "./plugin-app-collector.js";

const Section = () => null;

it.each([
  [{}, null, []],
  [
    { title: "Deploys" },
    "Deploys",
    [expect.stringMatching(/"title" is retired/)],
  ],
])(
  "keeps a card section title from an older SDK for bb to draw: %o",
  (extra, legacyTitle, warnings) => {
    const messages: string[] = [];
    const captured = collectPluginAppRegistrations(
      {
        __bbPluginApp: true,
        setup(app) {
          app.slots.experimental_threadContextCardSection({
            id: "deploys",
            group: "2_deploys",
            component: Section,
            ...extra,
          });
        },
      },
      (message) => messages.push(message),
    );
    expect(captured.threadContextCardSections).toEqual([
      { id: "deploys", group: "2_deploys", component: Section, legacyTitle },
    ]);
    expect(messages).toEqual(warnings);
  },
);
