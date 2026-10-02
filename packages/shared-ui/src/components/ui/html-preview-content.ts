export function htmlPreviewContent(content: string, fileUrl: string): string {
  const absoluteUrl = new URL(fileUrl, window.location.href).href;
  const document = new DOMParser().parseFromString(content, "text/html");
  const authoredBase = document.querySelector("base[href]");
  if (authoredBase) {
    const href = authoredBase.getAttribute("href") ?? "";
    authoredBase.setAttribute(
      "href",
      URL.canParse(href, absoluteUrl)
        ? new URL(href, absoluteUrl).href
        : absoluteUrl,
    );
  } else {
    const base = document.createElement("base");
    base.setAttribute("href", absoluteUrl);
    document.head.prepend(base);
  }
  const fragmentNavigation = document.createElement("script");
  fragmentNavigation.textContent = `document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href], area[href]") : null;
    const href = anchor?.getAttribute("href");
    if (!href?.startsWith("#") || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.hasAttribute("download") || (anchor.target && anchor.target.toLowerCase() !== "_self")) return;
    event.preventDefault();
    const oldURL = location.href;
    const nextURL = new URL(oldURL);
    nextURL.hash = href.slice(1);
    if (nextURL.href !== oldURL) {
      history.pushState(null, "", nextURL.href);
      window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: nextURL.href }));
    }
    let id = href.slice(1);
    try { id = decodeURIComponent(id); } catch {}
    if (!id) { window.scrollTo(0, 0); return; }
    const target = document.getElementById(id) ?? document.getElementsByName(id)[0];
    target?.scrollIntoView();
  });`;
  document.head.append(fragmentNavigation);
  const doctype = document.doctype
    ? new XMLSerializer().serializeToString(document.doctype)
    : "";
  return `${doctype}${document.documentElement.outerHTML}`;
}
