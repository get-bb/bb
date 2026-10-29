// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { formPage } from "./form-page";

const key = "bb-community-survey";

async function load(page: Response) {
  const html = await page.text();
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, "");
  vi.stubGlobal("matchMedia", () => ({ addEventListener: () => {} }));
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)![1]!;
  new Function(script)();
}
const field = (selector: string) =>
  document.querySelector<HTMLInputElement>(selector)!;

describe("survey progress", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("saves answers as they change and restores them on the next visit", async () => {
    await load(formPage({ kind: "survey", id: "first" }));
    field('[name="work"][value="Just me"]').click();
    field('[name="role"][value="Other"]').click();
    const other = field('[name="role_other"]');
    other.value = "Researcher";
    other.dispatchEvent(new Event("input", { bubbles: true }));
    field('[name="email"]').value = "ada@example.test";
    field('[name="email"]').dispatchEvent(new Event("input", { bubbles: true }));
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      work: ["Just me"],
      role: ["Other"],
      role_other: ["Researcher"],
      email: ["ada@example.test"],
    });

    await load(formPage({ kind: "survey", id: "second" }));
    expect(field('[name="work"][value="Just me"]').checked).toBe(true);
    expect(field('[name="role_other"]').value).toBe("Researcher");
    expect(field('[name="role_other"]').hidden).toBe(false);
    expect(field('[data-question="team_adopt"]').hidden).toBe(false);
    expect(field('[name="email"]').value).toBe("ada@example.test");
    expect(field('[name="submission_id"]').value).toBe("second");
  });

  it("keeps server-returned answers over saved progress", async () => {
    localStorage.setItem(key, JSON.stringify({ city: ["Paris, France"] }));
    await load(
      formPage({ kind: "survey", id: "retry", values: { city: ["Austin, USA"] } }),
    );
    expect(field('[name="city"]').value).toBe("Austin, USA");
  });

  it("clears saved progress once the survey is submitted", async () => {
    localStorage.setItem(key, JSON.stringify({ city: ["Austin, USA"] }));
    await load(formPage({ kind: "survey", id: "done", complete: true }));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("ignores unreadable saved progress", async () => {
    localStorage.setItem(key, "{not json");
    await load(formPage({ kind: "survey", id: "broken" }));
    expect(field('[name="city"]').value).toBe("");
  });
});
