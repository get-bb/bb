const URL_SCHEME = /^[^/?#]*:/;

export function isAllowedEditorLink(
  href: string,
  defaultValidate: (href: string) => boolean,
): boolean {
  return defaultValidate(href) || !URL_SCHEME.test(href);
}

export function handleEditorLinkClick(
  event: MouseEvent,
  open: { url(href: string): boolean; relative?(href: string): boolean },
): boolean {
  if (
    event.button !== 0 ||
    event.shiftKey ||
    !(event.target instanceof Element)
  )
    return false;
  const href = event.target.closest("a[href]")?.getAttribute("href");
  if (!href) return false;
  const handled = URL_SCHEME.test(href)
    ? open.url(href)
    : (open.relative?.(href) ?? false);
  if (handled) event.preventDefault();
  return handled;
}
