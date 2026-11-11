export function ProjectAvatar({ name }: { name: string }) {
  const letter = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-foreground/10 text-2xs font-semibold leading-none text-foreground/80"
    >
      {letter}
    </span>
  );
}
