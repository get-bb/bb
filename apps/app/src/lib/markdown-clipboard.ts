const omittedElements =
  "button, script, style, input, textarea, select, audio, video, canvas, embed, iframe, object, meta, link, [data-clipboard-ignore]";
const blockTags = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
]);

const blockElements =
  "p, div, section, article, header, footer, h1, h2, h3, h4, h5, h6, blockquote, details, summary, ul, ol, li, table, thead, tbody, tfoot, tr, th, td";
const taskCheckbox =
  ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]';
const requiredChildren: Record<string, string> = {
  UL: "li",
  OL: "li",
  TR: "th, td",
  THEAD: "tr",
  TBODY: "tr",
  TFOOT: "tr",
  TABLE: "tr, thead, tbody, tfoot",
};

const mathElements = ".katex-display, .katex, .katex-error";

function mathRoot(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return (
    element?.closest(".katex-display") ??
    element?.closest(".katex, .katex-error") ??
    null
  );
}

function selectedContent(range: Range, node: Node): boolean {
  if (!range.intersectsNode(node)) return false;
  if (node instanceof Element) return node.tagName === "IMG";
  if (!(node instanceof Text) || node.parentElement?.closest(omittedElements))
    return false;
  const start = node === range.startContainer ? range.startOffset : 0;
  const end = node === range.endContainer ? range.endOffset : node.length;
  return node.data.slice(start, end).trim() !== "";
}

function trimRangeToContent(range: Range): Range {
  const walker = document.createTreeWalker(
    range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    (node) =>
      selectedContent(range, node)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
  );
  const first = walker.nextNode();
  if (!first) return range;
  let last = first;
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    last = node;
  const trimmed = range.cloneRange();
  if (first instanceof Text && first !== range.startContainer)
    trimmed.setStart(first, 0);
  else if (first instanceof Element) trimmed.setStartBefore(first);
  if (last instanceof Text && last !== range.endContainer)
    trimmed.setEnd(last, last.length);
  else if (last instanceof Element) trimmed.setEndAfter(last);
  return trimmed;
}

function expandRangeToMath(range: Range): Range {
  const expanded = range.cloneRange();
  const start = mathRoot(range.startContainer);
  const end = mathRoot(range.endContainer);
  if (start) expanded.setStartBefore(start);
  if (end) expanded.setEndAfter(end);
  return expanded;
}

function mathMarkdown(element: Element): string | null {
  if (!element.matches(mathElements)) return null;
  const tex =
    (
      element.querySelector('annotation[encoding="application/x-tex"]') ??
      element
    ).textContent?.trim() ?? "";
  return element.matches(".katex-display")
    ? `\n\n$$\n${tex}\n$$\n\n`
    : `$$${tex}$$`;
}

function replaceMathWithMathMl(container: Element): void {
  for (const element of container.querySelectorAll(".katex-display, .katex")) {
    if (element.parentElement?.closest(".katex-display, .katex")) continue;
    const math = element.querySelector("math")?.cloneNode(true);
    if (!(math instanceof Element)) continue;
    math.querySelectorAll("annotation").forEach((annotation) => {
      annotation.remove();
    });
    element.replaceWith(math);
  }
}

function isBareUrl(link: Element): boolean {
  const text = link.textContent?.trim() ?? "";
  return [text, `http://${text}`, `https://${text}`, `mailto:${text}`].includes(
    link.getAttribute("href") ?? "",
  );
}

function safeUrl(value: string): string {
  return /^(?:javascript|vbscript|data):/i.test(
    value.replace(/[\u0000-\u0020]/g, ""),
  )
    ? ""
    : value;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([`*_[\]<>])/g, "\\$1");
}

function codeSpan(value: string): string {
  const fence = "`".repeat(
    Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length)) + 1,
  );
  const padding =
    value.startsWith("`") ||
    value.endsWith("`") ||
    (value.startsWith(" ") && value.endsWith(" "))
      ? " "
      : "";
  return `${fence}${padding}${value}${padding}${fence}`;
}

function childrenMarkdown(node: Node): string {
  return Array.from(node.childNodes).reduce((result, child) => {
    const part = nodeMarkdown(child);
    if (
      node instanceof Element &&
      node.tagName === "LI" &&
      child instanceof Element &&
      child.matches("ul, ol")
    )
      return result.trimEnd() + "\n" + part.trim();
    if (result.endsWith("\n\n") && part.startsWith("\n"))
      return result + part.replace(/^\n+/, "");
    if (part.startsWith("\n\n")) return result.replace(/\n+$/, "") + part;
    return result + part;
  }, "");
}

function tableRows(table: Element): Element[][] {
  return Array.from(table.querySelectorAll("tr"), (row) =>
    Array.from(row.children).filter((cell) => cell.matches("th, td")),
  );
}

function tableToMarkdown(table: Element): string {
  const rows = tableRows(table);
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width === 0) return "";
  const lines = rows.map(
    (row) =>
      `| ${Array.from({ length: width }, (_, index) => {
        const cell = row[index];
        return cell
          ? childrenMarkdown(cell)
              .trim()
              .replace(/\|/g, "\\|")
              .replace(/\n+/g, "<br>")
          : "";
      }).join(" | ")} |`,
  );
  lines.splice(
    1,
    0,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
  );
  return lines.join("\n");
}

function nodeMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeText(node.textContent ?? "");
  if (!(node instanceof Element)) return childrenMarkdown(node);
  if (node.matches(omittedElements)) return "";
  const math = mathMarkdown(node);
  if (math !== null) return math;
  const tag = node.tagName;
  if (tag === "PRE") {
    const code = node.querySelector("code");
    const text = (code ?? node).textContent ?? "";
    const language = code?.className.match(/(?:^|\s)language-(\S+)/)?.[1] ?? "";
    const fence = "`".repeat(
      Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1,
    );
    return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
  }
  if (tag === "CODE") return codeSpan(node.textContent ?? "");
  if (tag === "TABLE") return `\n\n${tableToMarkdown(node)}\n\n`;
  if (tag === "UL" || tag === "OL") {
    const start = Number(node.getAttribute("start") ?? 1);
    const items = Array.from(node.children).filter(
      (child) => child.tagName === "LI",
    );
    return `${node.parentElement?.tagName === "LI" ? "\n" : "\n\n"}${items
      .map((item, index) => {
        const marker = tag === "OL" ? `${start + index}. ` : "- ";
        const task = item.querySelector(taskCheckbox);
        const value = `${task ? (task.hasAttribute("checked") ? "[x] " : "[ ] ") : ""}${childrenMarkdown(item).trim()}`;
        return marker + value.replace(/\n/g, `\n${" ".repeat(marker.length)}`);
      })
      .join("\n")}${node.parentElement?.tagName === "LI" ? "" : "\n\n"}`;
  }
  const content = childrenMarkdown(node);
  if (tag === "BR") return "\n";
  if (tag === "HR") return "\n\n---\n\n";
  if (tag === "STRONG" || tag === "B") return `**${content}**`;
  if (tag === "EM" || tag === "I") return `*${content}*`;
  if (tag === "DEL" || tag === "S") return `~~${content}~~`;
  if (tag === "A") {
    if (node.hasAttribute("data-bare-url")) return node.textContent ?? "";
    const href = safeUrl(node.getAttribute("href") ?? "");
    return href
      ? `[${content}](${href.replace(/([\\()])/g, "\\$1")})`
      : content;
  }
  if (tag === "IMG")
    return `![${escapeText(node.getAttribute("alt") ?? "")}](${safeUrl(node.getAttribute("src") ?? "")})`;
  if (/^H[1-6]$/.test(tag))
    return `\n\n${"#".repeat(Number(tag[1]))} ${content}\n\n`;
  if (tag === "BLOCKQUOTE")
    return `\n\n${content.trim().replace(/^/gm, "> ")}\n\n`;
  if (tag === "DETAILS")
    return `\n\n<details>\n${content.trim()}\n</details>\n\n`;
  if (tag === "SUMMARY") return `<summary>${content}</summary>\n\n`;
  return blockTags.has(tag) ? `\n\n${content.trim()}\n\n` : content;
}

function keepsAncestor(
  ancestor: Element,
  contents: Node,
  common: Element | null,
): boolean {
  if (!ancestor.matches(blockElements)) return true;
  const top =
    contents instanceof DocumentFragment
      ? Array.from(contents.childNodes)
      : [contents];
  const required =
    requiredChildren[ancestor.tagName] ??
    (ancestor === common && !ancestor.matches("th, td") ? blockElements : null);
  return (
    required !== null &&
    top.some((node) => node instanceof Element && node.matches(required))
  );
}

export function selectionClipboard(
  selected: Range,
  root: Element,
): { text: string; html: string } {
  const range = expandRangeToMath(trimRangeToContent(selected));
  const start =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const end =
    range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement;
  const pre = start?.closest("pre");
  let contents: Node = range.cloneContents();
  const common =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  const wrapped: Element[] = [];
  let ancestor = common;
  while (
    ancestor &&
    ancestor !== root &&
    root.contains(ancestor) &&
    keepsAncestor(ancestor, contents, common)
  ) {
    const wrapper = ancestor.cloneNode(false);
    wrapper.appendChild(contents);
    contents = wrapper;
    wrapped.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  const container = document.createElement("div");
  container.appendChild(contents);
  const copiedOriginals = (selector: string) => {
    const originals = Array.from(root.querySelectorAll(selector)).filter(
      (element) =>
        wrapped.includes(element) ||
        (element !== common &&
          common?.contains(element) &&
          range.intersectsNode(element)),
    );
    return Array.from(
      container.querySelectorAll(selector),
      (copy, index) => [copy, originals[index]] as const,
    );
  };
  for (const [list, original] of copiedOriginals("ol")) {
    if (!original) continue;
    const firstSelected = Array.from(original.children).findIndex((item) =>
      range.intersectsNode(item),
    );
    list.setAttribute(
      "start",
      String(
        Number(original.getAttribute("start") ?? 1) +
          Math.max(0, firstSelected),
      ),
    );
  }
  for (const [item, original] of copiedOriginals("li")) {
    const task = original?.querySelector(taskCheckbox);
    if (task && !item.querySelector(taskCheckbox))
      item.prepend(task.cloneNode());
  }
  for (const [link, original] of copiedOriginals("a"))
    if (original && isBareUrl(original)) link.setAttribute("data-bare-url", "");
  const text =
    pre && end && pre.contains(end)
      ? range.toString()
      : childrenMarkdown(container).trim();
  replaceMathWithMathMl(container);
  container
    .querySelectorAll(omittedElements)
    .forEach((element) => element.remove());
  for (const element of container.querySelectorAll("*")) {
    if (element.closest("math")) continue;
    for (const attribute of Array.from(element.attributes)) {
      if (
        !["href", "src", "alt", "start", "colspan", "rowspan"].includes(
          attribute.name,
        )
      )
        element.removeAttribute(attribute.name);
      else if (attribute.name === "href" || attribute.name === "src")
        element.setAttribute(attribute.name, safeUrl(attribute.value));
    }
  }
  return { text, html: container.innerHTML };
}
