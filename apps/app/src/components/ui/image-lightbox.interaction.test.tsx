// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ImageLightbox } from "./image-lightbox";

function Preview() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open image
      </button>
      <ImageLightbox
        imageSrc={open ? `/image-${index}.png` : null}
        imageAlt={`Image ${index}`}
        title="Image preview"
        hasMultipleImages
        onPrevious={() => setIndex(0)}
        onNext={() => setIndex(1)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

afterEach(cleanup);

it("dismisses from the image, backdrop, or close control without hiding the app root", () => {
  const { container } = render(<Preview />);
  const trigger = screen.getByRole("button", { name: "Open image" });
  for (const target of ["image", "backdrop", "close"]) {
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Image preview" });
    expect(dialog.parentElement).toBe(document.body);
    expect(container.closest('[inert], [aria-hidden="true"]')).toBeNull();
    fireEvent.click(
      target === "image"
        ? screen.getByRole("img", { name: "Image 0" })
        : target === "backdrop"
          ? dialog
          : screen.getByRole("button", { name: "Close image preview" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }
});

it("keeps navigation open and restores the trigger after keyboard dismissal", () => {
  render(<Preview />);
  const trigger = screen.getByRole("button", { name: "Open image" });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("button", { name: "Next image" }));
  expect(screen.getByRole("img", { name: "Image 1" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "ArrowLeft" });
  expect(screen.getByRole("img", { name: "Image 0" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "Tab" });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Previous image" }),
  );
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
