import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { formPage } from "./form-page";
import { surveyQuestions } from "./survey";

describe("survey page", () => {
  it("groups the questions, asks only for email, and fixes Other last while shuffling Q6", async () => {
    vi.stubGlobal(
      "Math",
      Object.assign(Object.create(Math), { random: () => 0 }),
    );
    try {
      const html = await formPage({ kind: "survey", id: "fixture" }).text();
      expect(html.indexOf("Getting to know you")).toBeLessThan(
        html.indexOf('data-question="discovery"'),
      );
      expect(html.indexOf("bb meetups")).toBeLessThan(
        html.indexOf("We&#x27;re starting bb meetups"),
      );
      expect(
        html.indexOf("What you&#x27;d like from the bb community"),
      ).toBeLessThan(html.indexOf('data-question="community"'));
      expect(html).not.toContain('name="name"');
      expect(html).toContain('type="email" required=""');
      expect(html).toContain(
        "Your email, so we can send your stickers and share the results with you.",
      );
      const community = html
        .split('data-question="community"')[1]!
        .split("</fieldset>")[0]!;
      const choices = [
        ...community.matchAll(/name="community" value="([^"]+)"/g),
      ].map((match) => match[1]);
      expect(choices).toHaveLength(7);
      expect(choices.at(-1)).toBe("Other");
      expect(choices[0]).toBe("Online build sessions");
      expect(community).toContain(
        "What would you like from the bb community?</span> (pick any)",
      );
      expect(community).toContain('name="community_other"');
      expect(
        surveyQuestions.find((question) => question.name === "community")
          ?.options,
      ).toHaveLength(7);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows Other text when Other is checked alongside another community choice", async () => {
    const html = await formPage({ kind: "survey", id: "fixture" }).text();
    const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(
      -1,
    )![1]!;
    const otherInput = {
      dataset: { other: "community" },
      hidden: false,
      disabled: false,
    };
    let otherChecked = true;
    let update = () => {};
    const form = {
      elements: { namedItem: () => ({ value: "" }) },
      querySelector: (selector: string) => {
        if (selector === "[data-meetup-label]") return { textContent: "" };
        expect(selector).toBe('[name="community"][value="Other"]:checked');
        return otherChecked ? { value: "Other" } : null;
      },
      querySelectorAll: () => [otherInput],
      addEventListener: (event: string, callback: () => void) => {
        if (event === "input") update = callback;
      },
    };
    runInNewContext(script, {
      document: { querySelector: () => form },
      matchMedia: () => ({ addEventListener: () => {} }),
    });
    expect(otherInput.hidden).toBe(false);
    expect(otherInput.disabled).toBe(false);
    otherChecked = false;
    update();
    expect(otherInput.hidden).toBe(true);
    expect(otherInput.disabled).toBe(true);
  });
});
