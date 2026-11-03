// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { experimental_useComposerRenderer as useComposerRenderer } from "@get-bb/plugin-sdk/app";
import { ComposerRendererTestHost } from "@/test/fixtures/composer-renderer";
import { testTypeaheadConfig } from "@/test/fixtures/composer-search";

vi.mock("@/hooks/usePromptMentions", async () =>
  (await import("@/test/fixtures/composer-search")).fakePromptMentionsModule(),
);
vi.mock("@/hooks/useCommandSuggestions", async () =>
  (
    await import("@/test/fixtures/composer-search")
  ).fakeCommandSuggestionsModule(),
);

afterEach(cleanup);

function TriggerProbe() {
  const { input } = useComposerRenderer();
  return (
    <output>
      {`${input.mentionTriggers.join(" ")}|${input.commandTriggers.join(" ")}`}
    </output>
  );
}

describe("composer search", () => {
  it("never hands a composer a command trigger that is also a mention trigger", () => {
    render(
      <ComposerRendererTestHost
        typeahead={testTypeaheadConfig({
          mentionTriggers: ["@", "$"],
          commandTriggers: ["/", "$"],
        })}
      >
        <TriggerProbe />
      </ComposerRendererTestHost>,
    );

    expect(screen.getByRole("status").textContent).toBe("@ $|/");
  });
});
