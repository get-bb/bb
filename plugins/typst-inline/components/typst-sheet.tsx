import { useRef, type CSSProperties } from "react";
import type { TypstPage } from "../lib/typst-pages.js";
import { useTypstPageWindow } from "../lib/typst-page-window.js";

export function TypstSheet({
  pages,
  style,
  viewportClassName,
}: {
  pages: readonly TypstPage[];
  style?: CSSProperties;
  viewportClassName: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const { mounted, registerSlot } = useTypstPageWindow({
    count: pages.length,
    rootRef: viewportRef,
  });

  return (
    <div
      ref={viewportRef}
      data-typst-sheet-viewport=""
      style={style}
      className={viewportClassName}
    >
      <div
        data-typst-sheet=""
        className="mx-auto w-full max-w-3xl overflow-hidden rounded-sm bg-white shadow-sm [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
      >
        {pages.map((page, index) => (
          <div
            key={index}
            ref={(element) => {
              registerSlot(index, element);
            }}
            data-typst-page-slot={index}
            style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
          >
            {mounted.has(index) ? (
              <div
                data-typst-page=""
                dangerouslySetInnerHTML={{ __html: page.svg }}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
