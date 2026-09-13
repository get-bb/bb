export function TimelineReasoningDetail({ text }: { text: string }) {
  return (
    <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words ms-1.5 border-l border-border-seam pl-3 text-sm leading-relaxed text-muted-foreground">
      {text}
    </div>
  );
}
