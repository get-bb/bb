export function buildIosTextSizeScript(fontScale: number): string {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return `(function () {
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty("--bb-ios-font-scale", "${scale}");
    root.style.setProperty("--bb-ios-text-size-adjust", "${scale * 100}%");
    if (${scale === 1}) {
      root.removeAttribute("data-bb-ios-text-scale");
    } else {
      root.setAttribute("data-bb-ios-text-scale", "${scale}");
    }
  })(); true;`;
}
