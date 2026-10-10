import { useState, type ReactNode, type RefObject } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import { PromptStackCollapseRow } from "@bb/shared-ui/prompt-stack-disclosure";

interface AnimatedBodyProps {
  id: string;
  labelledBy: string;
  isExpanded: boolean;
  collapsedBorder: "reserve" | "none";
  children: ReactNode;
}

export function AnimatedBody({
  id,
  labelledBy,
  isExpanded,
  collapsedBorder,
  children,
}: AnimatedBodyProps) {
  const [hasRealizedBody, setHasRealizedBody] = useState(isExpanded);
  if (isExpanded && !hasRealizedBody) {
    setHasRealizedBody(true);
  }
  const isBodyRealized = hasRealizedBody || isExpanded;

  return (
    <section
      id={id}
      role="region"
      aria-labelledby={labelledBy}
      aria-hidden={!isExpanded}
      inert={!isExpanded}
      className={cn(
        "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
        isExpanded
          ? "grid-rows-[1fr] border-t border-border opacity-100"
          : cn(
              "pointer-events-none grid-rows-[0fr] opacity-0",
              collapsedBorder === "reserve" && "border-t border-transparent",
            ),
      )}
    >
      <div className="overflow-hidden bg-popover">
        {isBodyRealized ? children : null}
      </div>
    </section>
  );
}

interface AnimatedDisclosureBodyProps extends AnimatedBodyProps {
  collapseLabel: string;
  collapseRef: RefObject<HTMLButtonElement | null>;
  onCollapse: () => void;
}

export function AnimatedDisclosureBody({
  collapseLabel,
  collapseRef,
  onCollapse,
  children,
  ...bodyProps
}: AnimatedDisclosureBodyProps) {
  return (
    <AnimatedBody {...bodyProps}>
      {children}
      <div className="px-1 pb-1">
        <PromptStackCollapseRow
          buttonRef={collapseRef}
          controlsId={bodyProps.id}
          label={collapseLabel}
          onCollapse={onCollapse}
        />
      </div>
    </AnimatedBody>
  );
}
