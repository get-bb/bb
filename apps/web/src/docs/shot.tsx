export function screenshotFiles(src: string): { light: string; dark: string } {
  return { light: `${src}-light.png`, dark: `${src}-dark.png` };
}

export function Shot({ todo }: { todo: string }) {
  return (
    <div
      className="docs-shot"
      role="img"
      aria-label={`Image placeholder: ${todo}`}
    >
      <strong>Image placeholder</strong>
      <span>{todo}</span>
      <small>Filled by the docs-images skill before merge</small>
    </div>
  );
}

export function Screenshot({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const files = screenshotFiles(src);
  return (
    <figure className="docs-screenshot">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcSet={files.dark} />
        <img
          src={files.light}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
        />
      </picture>
    </figure>
  );
}
