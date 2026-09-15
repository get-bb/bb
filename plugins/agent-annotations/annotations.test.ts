import { describe, expect, it } from "vitest";
import {
  annotationMentionLabel,
  annotationRecordSchema,
  formatAnnotationContext,
  type AnnotationRecord,
} from "./annotations.js";

const record: AnnotationRecord = {
  id: "mfx12abc",
  number: 2,
  comment: "The pay button should be green and say “Pay securely” instead",
  url: "http://localhost:5173/checkout",
  title: "Checkout",
  viewport: { width: 1280, height: 720 },
  element: {
    tagName: "button",
    name: 'button#pay.btn "Pay now"',
    selector: "#pay",
    text: "Pay",
    attributes: { id: "pay", "aria-label": "Pay now" },
    rect: { x: 40, y: 300, width: 120, height: 36 },
    styles: { "background-color": "rgb(0, 0, 0)" },
  },
  components: [
    { name: "SubmitButton", source: "src/SubmitButton.tsx:12" },
    { name: "CheckoutCard", source: null },
  ],
};

describe("annotation formatting", () => {
  it("labels mentions with the element and a shortened comment", () => {
    expect(annotationMentionLabel(record)).toBe(
      "2. button: The pay button should be green and say…",
    );
  });

  it("formats agent context with the comment, locator hints, and styles", () => {
    expect(formatAnnotationContext(record)).toBe(
      [
        "# Browser annotation 2",
        "",
        'The user selected an element on "Checkout" (http://localhost:5173/checkout) and commented on it.',
        "",
        "## Comment",
        "",
        "The pay button should be green and say “Pay securely” instead",
        "",
        "## Element",
        "",
        '- Element: `button#pay.btn "Pay now"`',
        "- Selector: `#pay`",
        "- React components, innermost first: SubmitButton (src/SubmitButton.tsx:12) › CheckoutCard",
        '- Text: "Pay"',
        '- Attributes: id="pay", aria-label="Pay now"',
        "- Box: x=40, y=300, 120×36px in a 1280×720px viewport",
        "",
        "## Computed styles",
        "",
        "- background-color: rgb(0, 0, 0)",
      ].join("\n"),
    );
  });

  it("rejects records with blank comments", () => {
    expect(
      annotationRecordSchema.safeParse({ ...record, comment: "   " }).success,
    ).toBe(false);
  });
});
