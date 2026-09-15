import type { CSSProperties } from "react";

export function TypstSheet({
  style,
  svg,
  viewportClassName,
}: {
  style?: CSSProperties;
  svg: string;
  viewportClassName: string;
}) {
  return (
    <div
      data-typst-sheet-viewport=""
      style={style}
      className={viewportClassName}
    >
      <div
        data-typst-sheet=""
        className="mx-auto w-full max-w-3xl overflow-hidden rounded-sm bg-white shadow-sm [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
