import { marked, type Token, type Tokens } from "marked";

const DOCUMENT_PREAMBLE = [
  '#set page(paper: "a4", margin: 2cm)',
  '#set text(font: "Libertinus Serif", size: 11pt)',
  "#set par(justify: true)",
  '#show raw: set text(font: "DejaVu Sans Mono", size: 9pt)',
].join("\n");

const TYPST_SPECIAL = /[\\#$*_`[\]<>@~]/g;

const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const LIST_INDENT = "  ";

function escapeText(text: string): string {
  return text.replace(TYPST_SPECIAL, (character) => `\\${character}`);
}

function typstString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function isRemoteTarget(href: string): boolean {
  return URL_SCHEME.test(href) || href.startsWith("//");
}

function localImagePath(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0 || isRemoteTarget(trimmed)) return null;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function rawInline(text: string): string {
  return `#raw(${typstString(text)})`;
}

function rawBlock(text: string, lang: string): string {
  const trimmed = text.replace(/\n+$/, "");
  const language = lang.trim().length > 0 ? `, lang: ${typstString(lang.trim())}` : "";
  return `#raw(${typstString(trimmed)}${language}, block: true)`;
}

function inlineLink(token: Tokens.Link): string {
  const label = token.tokens ? inlineTokens(token.tokens) : escapeText(token.text);
  const href = (token.href ?? "").trim();
  if (href.length === 0) return label;
  return `#link(${typstString(href)})[${label}]`;
}

function inlineImage(token: Tokens.Image): string {
  const alt = token.tokens ? inlineTokens(token.tokens) : escapeText(token.text);
  const href = (token.href ?? "").trim();
  const local = localImagePath(href);
  if (local === null) {
    const label = alt.length > 0 ? alt : escapeText(href);
    return href.length === 0 ? label : `#link(${typstString(href)})[${label}]`;
  }
  return `#image(${typstString(local)}, width: 100%)`;
}

function inlineToken(token: Token): string {
  switch (token.type) {
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens ? inlineTokens(text.tokens) : escapeText(text.text);
    }
    case "escape":
      return escapeText((token as Tokens.Escape).text);
    case "strong":
      return `*${inlineTokens((token as Tokens.Strong).tokens)}*`;
    case "em":
      return `_${inlineTokens((token as Tokens.Em).tokens)}_`;
    case "del":
      return `#strike[${inlineTokens((token as Tokens.Del).tokens)}]`;
    case "codespan":
      return rawInline((token as Tokens.Codespan).text);
    case "br":
      return "\\\n";
    case "link":
      return inlineLink(token as Tokens.Link);
    case "image":
      return inlineImage(token as Tokens.Image);
    case "checkbox": {
      const checkbox = token as Tokens.Checkbox;
      return checkbox.checked ? "☑ " : "☐ ";
    }
    case "html":
      return escapeText((token as Tokens.HTML).text);
    default:
      return escapeText(token.raw ?? "");
  }
}

function inlineTokens(tokens: readonly Token[] | undefined): string {
  if (tokens === undefined || tokens.length === 0) return "";
  return tokens.map(inlineToken).join("");
}

function indentLines(text: string, pad: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `${pad}${line}` : line))
    .join("\n");
}

function convertList(token: Tokens.List, depth: number): string {
  const pad = LIST_INDENT.repeat(depth);
  const marker = token.ordered ? "+" : "-";
  const lines: string[] = [];

  for (const item of token.items) {
    const inlineParts: string[] = [];
    const nestedLists: string[] = [];
    const extraBlocks: string[] = [];

    for (const child of item.tokens ?? []) {
      switch (child.type) {
        case "space":
        case "checkbox":
          break;
        case "list":
          nestedLists.push(convertList(child as Tokens.List, depth + 1));
          break;
        case "text": {
          const text = child as Tokens.Text;
          inlineParts.push(
            text.tokens ? inlineTokens(text.tokens) : escapeText(text.text),
          );
          break;
        }
        case "paragraph":
          inlineParts.push(inlineTokens((child as Tokens.Paragraph).tokens));
          break;
        default: {
          const block = convertBlock(child, depth + 1);
          if (block !== null) extraBlocks.push(indentLines(block, pad + LIST_INDENT));
        }
      }
    }

    let head = inlineParts.filter((part) => part.length > 0).join(" ");
    if (item.task === true) {
      head = `${item.checked === true ? "☑" : "☐"} ${head}`.trimEnd();
    }
    if (head.length > 0) {
      lines.push(`${pad}${marker} ${head}`);
    } else if (nestedLists.length > 0) {
      lines.push(`${pad}${marker}`);
    }
    lines.push(...extraBlocks);
    lines.push(...nestedLists);
  }

  return lines.join("\n");
}

function convertTable(token: Tokens.Table): string {
  const cells: string[] = [`columns: ${token.header.length}`];
  const header = token.header.map((cell) => `[${inlineTokens(cell.tokens)}]`);
  if (header.length > 0) cells.push(`table.header(${header.join(", ")})`);
  for (const row of token.rows) {
    for (const cell of row) cells.push(`[${inlineTokens(cell.tokens)}]`);
  }
  return `#table(\n  ${cells.join(",\n  ")}\n)`;
}

function convertBlock(token: Token, depth: number): string | null {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const heading = token as Tokens.Heading;
      return `${"=".repeat(heading.depth)} ${inlineTokens(heading.tokens)}`;
    }
    case "paragraph":
      return inlineTokens((token as Tokens.Paragraph).tokens);
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens ? inlineTokens(text.tokens) : escapeText(text.text);
    }
    case "blockquote":
      return `#quote(block: true)[\n${convertBlocks(
        (token as Tokens.Blockquote).tokens,
        depth,
      )}\n]`;
    case "list":
      return convertList(token as Tokens.List, depth);
    case "code": {
      const code = token as Tokens.Code;
      return rawBlock(code.text, code.lang ?? "");
    }
    case "table":
      return convertTable(token as Tokens.Table);
    case "hr":
      return "#line(length: 100%)";
    case "html":
      return escapeText((token as Tokens.HTML).text);
    case "br":
      return "\\";
    default:
      return escapeText(token.raw ?? "");
  }
}

function convertBlocks(tokens: readonly Token[], depth = 0): string {
  const parts: string[] = [];
  for (const token of tokens) {
    const block = convertBlock(token, depth);
    if (block !== null && block.length > 0) parts.push(block);
  }
  return parts.join("\n\n");
}

function stripFrontmatter(markdown: string): string {
  const withoutBom = markdown.replace(/^\uFEFF/, "");
  return withoutBom.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, "");
}

export function markdownToTypst(markdown: string): string {
  const tokens = marked.lexer(stripFrontmatter(markdown));
  const body = convertBlocks(tokens).trim();
  return `${DOCUMENT_PREAMBLE}\n\n${body}\n`;
}
