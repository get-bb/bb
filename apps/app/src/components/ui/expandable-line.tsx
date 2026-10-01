import { useRef, useState, type ReactNode } from "react";

interface ExpandableLineProps {
  fullText: string;
  children: ReactNode;
  collapsedClassName: string;
}

const EXPANDED_CLASS_NAME = "whitespace-pre-wrap break-words";

export function ExpandableLine({
  fullText,
  children,
  collapsedClassName,
}: ExpandableLineProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const handleToggle = () => {
    const selection =
      typeof window === "undefined" ? null : window.getSelection();
    if (selection && selection.toString().length > 0) {
      return;
    }
    if (isExpanded && buttonRef.current) {
      buttonRef.current.scrollTo({ top: 0, behavior: "auto" });
    }
    setIsExpanded((prev) => !prev);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleToggle}
      className={[
        "block w-full cursor-pointer select-text text-left leading-tight transition-[max-height] duration-200 ease-out",
        isExpanded ? EXPANDED_CLASS_NAME : collapsedClassName,
      ]
        .filter(Boolean)
        .join(" ")}
      title={isExpanded ? "Click to collapse" : fullText}
      aria-expanded={isExpanded}
    >
      {children}
    </button>
  );
}
