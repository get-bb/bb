import { describe, expect, it } from "vitest";
import { getImageLightboxKeyAction } from "@/components/ui/image-lightbox";

interface TestKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
}

function createKeyboardEvent(
  key: string,
  overrides: Partial<TestKeyboardEvent> = {},
): TestKeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key,
    metaKey: false,
    ...overrides,
  };
}

describe("ImageLightbox", () => {
  it("keeps Escape available when only a single image is open", () => {
    expect(
      getImageLightboxKeyAction({
        event: createKeyboardEvent("Escape"),
        hasNavigation: false,
      }),
    ).toBe("close");
  });
});
