// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { trackLandingEvent } from "./analytics";
import { Testimonials } from "./testimonials";

vi.mock("./analytics", () => ({ trackLandingEvent: vi.fn() }));

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  vi.mocked(trackLandingEvent).mockClear();
  document.body.replaceChildren();
});

describe("Testimonials", () => {
  it("opens each post in a new tab and tracks the click by source", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Testimonials />));

    const section = container.querySelector("section");
    expect(section?.dataset.section).toBe("testimonials");
    const cards = [
      ...container.querySelectorAll<HTMLAnchorElement>("a.tm-card-link"),
    ];
    expect(cards).toHaveLength(12);
    for (const card of cards) {
      expect(card.target).toBe("_blank");
      expect(card.rel).toBe("noopener noreferrer");
    }

    const blog = cards.find(
      (card) => card.href === "https://hem.so/multiplexers",
    );
    blog?.addEventListener("click", (event) => event.preventDefault());
    act(() => blog?.click());

    expect(trackLandingEvent).toHaveBeenCalledOnce();
    expect(trackLandingEvent).toHaveBeenCalledWith({
      name: "landing_testimonial_clicked",
      properties: { source: "blog" },
    });
    act(() => root.unmount());
  });

  it("shows each X author's handle from their post link, and the site for other sources", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Testimonials />));

    for (const card of container.querySelectorAll(".tm-card")) {
      const href =
        card.querySelector<HTMLAnchorElement>("a.tm-card-link")!.href;
      const byline = card.querySelector(".tm-byline")?.textContent;
      const handle = href.match(/^https:\/\/x\.com\/([^/]+)\/status\//)?.[1];
      expect(byline).toBe(handle ? `@${handle}` : new URL(href).hostname);
    }
    act(() => root.unmount());
  });

  it("quotes every post in full, cutting only Hemanth's and Swair's off-topic sentences", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Testimonials />));

    const cut = [...container.querySelectorAll(".tm-card")]
      .filter((card) =>
        card.querySelector(".tm-quote")?.textContent?.includes("…"),
      )
      .map((card) => card.querySelector(".tm-name")?.textContent);
    expect(cut).toEqual(["Hemanth Soni", "Swair"]);
    expect(container.textContent).not.toContain("`");
    expect(
      [...container.querySelectorAll(".tm-quote code")].map(
        (c) => c.textContent,
      ),
    ).toEqual(["bb"]);
    expect(container.querySelector(".tm-quote a")).toBeNull();
    expect(
      [...container.querySelectorAll(".tm-col")].map(
        (column) => column.querySelector(".tm-name")?.textContent,
      ),
    ).toEqual(["Ben Tossell", "Tobi Lütke", "Alana Goyal", "Rob Haisfield"]);
    act(() => root.unmount());
  });
});
