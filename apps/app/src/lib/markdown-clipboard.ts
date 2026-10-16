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

const mathElements = ".katex-display, .katex, .katex-error";

function mathRoot(node: Node): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  return (
    element?.closest(".katex-display") ??
    element?.closest(".katex, .katex-error") ??
    null
  );
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
        const task = item.querySelector(
          ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
        );
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

export function selectionClipboard(
  selected: Range,
  root: Element,
): { text: string; html: string } {
  const range = expandRangeToMath(selected);
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
  let ancestor =
    range.commonAncestorContainer instanceof Element
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;
  while (ancestor && ancestor !== root && root.contains(ancestor)) {
    const wrapper = ancestor.cloneNode(false);
    wrapper.appendChild(contents);
    contents = wrapper;
    ancestor = ancestor.parentElement;
  }
  const container = document.createElement("div");
  container.appendChild(contents);
  const selectedLists = Array.from(root.querySelectorAll("ol")).filter((list) =>
    range.intersectsNode(list),
  );
  Array.from(container.querySelectorAll("ol")).forEach((list, index) => {
    const original = selectedLists[index];
    if (!original) return;
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
  });
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
