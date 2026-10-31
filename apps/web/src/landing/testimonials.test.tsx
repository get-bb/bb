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
      ...container.querySelectorAll<HTMLAnchorElement>("a.tm-card"),
    ];
    expect(cards).toHaveLength(11);
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
});
