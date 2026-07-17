import { describe, expect, it } from "vitest";
import {
  buildSectionMentionSuggestions,
  type SectionMentionCandidate,
} from "./sectionMentionSuggestions";

const SECTIONS: SectionMentionCandidate[] = [
  { id: "sec_alpha", name: "Alpha work" },
  { id: "sec_beta", name: "Beta launch" },
];

describe("buildSectionMentionSuggestions", () => {
  it("fuzzy-matches by section name and serializes a section reference", () => {
    expect(
      buildSectionMentionSuggestions({
        sections: SECTIONS,
        query: "alpha",
        limit: 8,
      }),
    ).toEqual([
      {
        kind: "section",
        path: "section:sec_alpha",
        replacement: "section:sec_alpha",
        sectionId: "sec_alpha",
        name: "Alpha work",
      },
    ]);
  });

  it("matches by section id", () => {
    expect(
      buildSectionMentionSuggestions({
        sections: SECTIONS,
        query: "sec_beta",
        limit: 8,
      }).map((suggestion) => suggestion.sectionId),
    ).toEqual(["sec_beta"]);
  });
});
