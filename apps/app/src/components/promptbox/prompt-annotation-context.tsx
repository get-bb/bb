import { createContext, useContext, type ReactNode } from "react";
import type { PromptDraftAnnotation } from "@/lib/prompt-draft";

export type PromptAnnotationInput = Omit<PromptDraftAnnotation, "id">;

interface PromptAnnotationComposer {
  addAnnotation: (annotation: PromptAnnotationInput) => void;
  annotations: readonly PromptDraftAnnotation[];
}

const PromptAnnotationComposerContext =
  createContext<PromptAnnotationComposer | null>(null);

interface PromptAnnotationComposerProviderProps {
  addAnnotation: (annotation: PromptAnnotationInput) => void;
  annotations?: readonly PromptDraftAnnotation[];
  children: ReactNode;
}

export function PromptAnnotationComposerProvider({
  addAnnotation,
  annotations = [],
  children,
}: PromptAnnotationComposerProviderProps) {
  return (
    <PromptAnnotationComposerContext.Provider
      value={{
        addAnnotation,
        annotations,
      }}
    >
      {children}
    </PromptAnnotationComposerContext.Provider>
  );
}

/**
 * Returns the composer's addAnnotation, or null when a diff/code surface renders
 * outside a composer (e.g. stories) so line-range comments simply stay off.
 */
export function usePromptAnnotationComposer(): PromptAnnotationComposer | null {
  return useContext(PromptAnnotationComposerContext);
}
