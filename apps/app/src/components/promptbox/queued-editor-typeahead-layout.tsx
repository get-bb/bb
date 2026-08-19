import { createContext, useContext, type ReactNode } from "react";

export interface QueuedEditorTypeaheadLayout {
  height: number;
  isOpen: boolean;
}

type QueuedEditorTypeaheadLayoutReporter = (
  layout: QueuedEditorTypeaheadLayout,
) => void;

const QueuedEditorTypeaheadLayoutContext =
  createContext<QueuedEditorTypeaheadLayoutReporter | null>(null);

export function QueuedEditorTypeaheadLayoutProvider({
  children,
  onLayoutChange,
}: {
  children: ReactNode;
  onLayoutChange: QueuedEditorTypeaheadLayoutReporter;
}) {
  return (
    <QueuedEditorTypeaheadLayoutContext.Provider value={onLayoutChange}>
      {children}
    </QueuedEditorTypeaheadLayoutContext.Provider>
  );
}

export function useQueuedEditorTypeaheadLayoutReporter(): QueuedEditorTypeaheadLayoutReporter | null {
  return useContext(QueuedEditorTypeaheadLayoutContext);
}
