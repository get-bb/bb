import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { formPage } from "./form-page";
import { surveyQuestions } from "./survey";

describe("survey page", () => {
  it.each(["survey", "merch"] as const)(
    "loads shared chrome with the response nonce on %s pages",
    async (kind) => {
      const response = formPage({ kind, id: "fixture" });
      const html = await response.text();
      const policy = response.headers.get("content-security-policy")!;
      const nonce = policy.match(/script-src 'nonce-([^']+)'/)![1];
      expect(html).toContain('id="site-nav"><nav class="nav"');
      expect(html).toContain('id="site-footer"><footer class="footer"');
      expect(html).toMatch(
        new RegExp(
          `<script nonce="${nonce}" src="[^"]+site-chrome[^"]*" defer=""></script>`,
        ),
      );
      expect(html).not.toContain("community-header");
      expect(html).not.toContain("community-footer");
      expect(policy).toContain("connect-src 'none'");
      expect(policy).not.toContain("unsafe-inline");
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

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
      expect(html).not.toContain(">bb meetups<");
      expect(html).not.toContain("We&#x27;re starting bb meetups");
      expect(html.indexOf('data-question="community"')).toBeLessThan(
        html.indexOf("So we know where to start meetups."),
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
      expect(choices[0]).toBe("See how other people use bb");
      expect(community).toContain(
        "What would you most want from the bb community?</span> (pick up to 3)",
      );
      expect(community).toContain('name="community_other"');
      expect(html).not.toContain("marketing list");
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
    let work = "2–4 people";
    const textarea = { value: "Shared sessions" };
    const team = {
      hidden: false,
      disabled: false,
      querySelector: () => textarea,
    };
    let update = () => {};
    const form = {
      elements: {
        namedItem: (name: string) => ({ value: name === "work" ? work : "" }),
      },
      querySelector: (selector: string) => {
        if (selector === '[data-question="team_improve"]') return team;
        if (selector === '[data-question="company_size"]') return { hidden: false, disabled: false, querySelectorAll: () => [] };
        if (selector === "[data-meetup-label]") return { textContent: "" };
        expect(selector).toBe('[name="community"][value="Other"]:checked');
        return otherChecked ? { value: "Other" } : null;
      },
      querySelectorAll: (selector: string) =>
        selector === "[data-other]" ? [otherInput] : [],
      addEventListener: (event: string, callback: () => void) => {
        if (event === "input") update = callback;
      },
    };
    runInNewContext(script, {
      document: { querySelector: () => form },
      matchMedia: () => ({ addEventListener: () => {} }),
    });
    expect(team.hidden).toBe(false);
    expect(textarea.value).toBe("Shared sessions");
    work = "Just me";
    update();
    expect(team.hidden).toBe(true);
    expect(team.disabled).toBe(true);
    expect(textarea.value).toBe("");
    work = "5 or more";
    update();
    expect(team.hidden).toBe(false);
    expect(team.disabled).toBe(false);
    expect(textarea.value).toBe("");
    expect(otherInput.hidden).toBe(false);
    expect(otherInput.disabled).toBe(false);
    otherChecked = false;
    update();
    expect(otherInput.hidden).toBe(true);
    expect(otherInput.disabled).toBe(true);
  });
});
