const RENDERED_TAG =
  /^<(\/?)(a|b|br|code|del|em|i|s|strike|strong)((?:\s[^>]*?)?)\s*\/?>$/i;
const LINK_ATTRIBUTES = /^(?:\s+(?:href|title)="[^"]*")+$/i;

export interface InlineToken {
  type: string;
  content: string;
}

export function renderedTags(tokens: InlineToken[]): Set<number> {
  const rendered = new Set<number>();
  const open = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    if (token.type !== "html_inline") return;
    const match = RENDERED_TAG.exec(token.content);
    if (!match) return;
    const [, closing, name, attributes] = match;
    const tag = name!.toLowerCase();
    if (closing) {
      const opening = open.get(tag)?.pop();
      if (opening === undefined) return;
      rendered.add(opening);
      rendered.add(index);
    } else if (
      tag === "br"
        ? !attributes
        : tag === "a"
          ? LINK_ATTRIBUTES.test(attributes!) && /href=/i.test(attributes!)
          : !attributes
    ) {
      if (tag === "br") rendered.add(index);
      else {
        const stack = open.get(tag);
        if (stack) stack.push(index);
        else open.set(tag, [index]);
      }
    }
  });
  return rendered;
}

export const HTML_EMBED_BLOCK =
  /^<div data-simple-html-embed="true" data-src="[^"]*" data-height="\d+"><\/div>\s*$/;
