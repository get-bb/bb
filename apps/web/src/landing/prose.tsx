import { cloneElement, Fragment, isValidElement, type ReactNode } from "react";

const PLAIN_ELEMENTS = new Set(["code", "pre"]);

export function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(plainText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const text = plainText(node.props.children);
    return node.type === "p" || node.type === "li" ? `${text} ` : text;
  }
  return "";
}

function brandText(text: string): ReactNode {
  const parts = text.split(/\b(bb)\b/);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="cmp-bb">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function brandProse(node: ReactNode): ReactNode {
  if (typeof node === "string") return brandText(node);
  if (Array.isArray(node)) {
    return node.map((child, index) => (
      <Fragment key={index}>{brandProse(child)}</Fragment>
    ));
  }
  if (
    isValidElement<{ children?: ReactNode }>(node) &&
    (node.type === Fragment ||
      (typeof node.type === "string" && !PLAIN_ELEMENTS.has(node.type))) &&
    node.props.children !== undefined
  ) {
    return cloneElement(node, undefined, brandProse(node.props.children));
  }
  return node;
}

export function faqJsonLd(
  items: { question: string; answer: ReactNode }[],
): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: plainText(item.answer).replace(/\s+/g, " ").trim(),
      },
    })),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
