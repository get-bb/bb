const MATH = ".katex-display, .katex, .katex-error";
const TEX_ANNOTATION = 'annotation[encoding="application/x-tex"]';

function mathRoot(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return (
    element?.closest(".katex-display") ??
    element?.closest(".katex, .katex-error") ??
    null
  );
}

export function expandRangeToMath(range: Range): Range {
  const expanded = range.cloneRange();
  const start = mathRoot(range.startContainer);
  const end = mathRoot(range.endContainer);
  if (start) expanded.setStartBefore(start);
  if (end) expanded.setEndAfter(end);
  return expanded;
}

export function mathMarkdown(element: Element): string | null {
  if (!element.matches(MATH)) return null;
  const tex =
    (element.querySelector(TEX_ANNOTATION) ?? element).textContent?.trim() ??
    "";
  return element.matches(".katex-display")
    ? `\n\n$$\n${tex}\n$$\n\n`
    : `$$${tex}$$`;
}
