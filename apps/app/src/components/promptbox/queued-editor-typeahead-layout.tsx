import { createContext } from "react";

export interface QueuedEditorTypeaheadLayout {
  height: number;
  isOpen: boolean;
}

type QueuedEditorTypeaheadLayoutReporter = (
  layout: QueuedEditorTypeaheadLayout,
) => void;

export const QueuedEditorTypeaheadLayoutContext =
  createContext<QueuedEditorTypeaheadLayoutReporter | null>(null);
