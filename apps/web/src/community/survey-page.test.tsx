// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { surveyOrder } from "./survey";
import { SurveyPage } from "./survey-page";

const key = "bb-community-survey";
const answers = {
  discovery: ["GitHub"],
  role: ["Student"],
  work: ["Just me"],
  love: ["Plugins"],
  improve: ["Search"],
  community: ["Get help when I'm stuck"],
  city: ["Austin"],
  meetup: ["Maybe"],
  research_call: ["No"],
  email: ["ada@example.test"],
};
let root: Root | undefined;

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  const container = document.createElement("div");
  document.body.replaceChildren(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(<SurveyPage title="Survey" order={surveyOrder()} />),
  );
}
const field = <T extends HTMLElement = HTMLInputElement>(selector: string) =>
  document.querySelector<T>(selector);
const click = (selector: string) => act(async () => field(selector)!.click());
const submit = () =>
  act(async () => field<HTMLFormElement>("form")!.requestSubmit());
const shown = (name: string) => field(`[data-question="${name}"]`) !== null;

describe("survey page", () => {
  afterEach(() => {
    act(() => root?.unmount());
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("restores saved progress and keeps saving changes", async () => {
    localStorage.setItem(
      key,
      JSON.stringify({ role: ["Other"], role_other: ["Researcher"] }),
    );
    await render();
    expect(field('[name="role_other"]')!.value).toBe("Researcher");
    await click('[name="work"][value="Just me"]');
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
      role_other: ["Researcher"],
      work: ["Just me"],
    });
  });

  it("ignores unreadable saved progress", async () => {
    localStorage.setItem(key, "{not json");
    await render();
    expect(field('[name="city"]')!.value).toBe("");
  });

  it("shows only the questions that apply", async () => {
    await render();
    await click('[name="role"][value="Founder or executive"]');
    await click('[name="work"][value="2–5 people"]');
    expect(
      ["work", "company_size", "team_improve", "team_adopt"].map(shown),
    ).toEqual([true, true, true, false]);
    await click('[name="work"][value="Just me"]');
    expect(["team_improve", "team_adopt"].map(shown)).toEqual([false, true]);
    await click('[name="role"][value="Student"]');
    expect(["work", "company_size", "team_adopt"].map(shown)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("asks for Other text while Other is picked", async () => {
    await render();
    await click('[name="community"][value="Other"]');
    expect(document.activeElement).toBe(field('[name="community_other"]'));
    await click('[name="community"][value="Other"]');
    expect(field('[name="community_other"]')).toBeNull();
  });

  it("sends visible answers once, then focuses the thanks and clears progress", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ result: { duplicate: false } }),
    );
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("scrollTo", () => {});
    localStorage.setItem(key, JSON.stringify(answers));
    await render();
    expect(field("form")!.getAttribute("method")).toBe("post");
    await submit();
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0]![1].body as string);
    expect(body.answers.work).toBeUndefined();
    expect(field("main")!.textContent).toContain("We got your answers.");
    expect(document.activeElement).toBe(field(".community-thanks"));
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("points to an unanswered checkbox question without sending", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    localStorage.setItem(key, JSON.stringify({ ...answers, community: [] }));
    await render();
    await submit();
    expect(fetch).not.toHaveBeenCalled();
    expect(field('[role="alert"]')!.textContent).toContain(
      "What would you most want from the bb community? Please answer this question.",
    );
  });

  it("shows a sending state while the answers are in flight", async () => {
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      () => new Promise<Response>((resolve) => (finish = resolve)),
    );
    vi.stubGlobal("scrollTo", () => {});
    localStorage.setItem(key, JSON.stringify(answers));
    await render();
    await submit();
    const button = field<HTMLButtonElement>('[type="submit"]')!;
    expect([button.disabled, button.textContent]).toEqual([true, "Sending…"]);
    await act(async () =>
      finish(
        Response.json(
          { error: "We couldn't save your response." },
          { status: 503 },
        ),
      ),
    );
    expect([button.disabled, button.textContent]).toEqual([
      false,
      "Send my answers",
    ]);
  });

  it("keeps the answers on screen when saving fails", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json(
        { error: "We couldn't save your response. Please try again." },
        { status: 503 },
      ),
    );
    localStorage.setItem(key, JSON.stringify(answers));
    await render();
    await submit();
    expect(field('[role="alert"]')!.textContent).toContain(
      "We couldn't save your response.",
    );
    expect(field('[name="city"]')!.value).toBe("Austin");
    const button = field<HTMLButtonElement>('[type="submit"]')!;
    expect([button.disabled, button.textContent]).toEqual([
      false,
      "Send my answers",
    ]);
  });
});
