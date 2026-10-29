import { describe, expect, it } from "vitest";
import type { WorkSuggestionAttribution } from "@bb/server-contract";
import {
  emptyPromptDraftState,
  parsePromptDraftStorage,
  preserveEditedSuggestion,
  promptDraftToInput,
  promptDraftWorkAttribution,
  serializePromptDraftStorage,
  withSuggestionDraftAttribution,
} from "../src/prompt/prompt-draft.js";

const attribution: WorkSuggestionAttribution = {
  origin: "agent_context",
  surface: "continuation",
  template_key: null,
  content_revision: "baseline",
  edit_state: "unchanged",
};
const reference = "9e427b72-5eb2-4664-91af-92d14d8d4085";
const draft = {
  text: "Investigate failing checks",
  mentions: [],
  attachments: [],
};

describe("local suggestion attribution", () => {
  it("survives local persistence and deliberate edits without entering prompt input or work properties", () => {
    const selected = withSuggestionDraftAttribution(
      emptyPromptDraftState(),
      draft,
      attribution,
      reference,
      "replace",
    );
    const restored = parsePromptDraftStorage(
      serializePromptDraftStorage(selected),
    );
    expect(restored).toEqual(selected);
    const edited = preserveEditedSuggestion(restored, {
      ...restored,
      text: "Investigate only the lint check",
    });
    expect(edited.suggestion?.reference).toBe(reference);
    expect(promptDraftWorkAttribution(edited)).toEqual({
      ...attribution,
      edit_state: "edited",
    });
    expect(JSON.stringify(promptDraftWorkAttribution(edited))).not.toContain(
      reference,
    );
    expect(promptDraftToInput(edited)).toEqual([
      { type: "text", text: edited.text, mentions: [] },
    ]);
    expect(preserveEditedSuggestion(restored, restored)).toBe(restored);
  });

  it("clears attribution on unrelated replacement/reset and does not blame a single combined card", () => {
    const selected = withSuggestionDraftAttribution(
      emptyPromptDraftState(),
      draft,
      attribution,
      reference,
      "replace",
    );
    expect(
      promptDraftWorkAttribution(preserveEditedSuggestion(selected, draft))
        .origin,
    ).toBe("none");
    expect(promptDraftWorkAttribution(emptyPromptDraftState()).origin).toBe(
      "none",
    );
    const combined = withSuggestionDraftAttribution(
      selected,
      { ...draft, text: `${draft.text}\nAdd tests` },
      attribution,
      "d53c5087-7b64-41ba-b66f-72a84b3a422e",
      "append",
    );
    expect(promptDraftWorkAttribution(combined)).toEqual({
      ...attribution,
      origin: "mixed",
      edit_state: "unknown",
    });
    expect(
      promptDraftWorkAttribution(
        preserveEditedSuggestion(combined, {
          ...combined,
          text: "Edited combined draft",
        }),
      ).edit_state,
    ).toBe("unknown");
  });

  it("discards malformed stored attribution without losing the user's draft", () => {
    const restored = parsePromptDraftStorage(
      JSON.stringify({
        ...draft,
        suggestion: {
          reference,
          attribution: { ...attribution, prompt: "private detail" },
        },
      }),
    );
    expect(restored.text).toBe(draft.text);
    expect(restored.suggestion).toBeUndefined();
  });
});
