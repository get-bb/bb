export function TimelineReasoningDetail({ text }: { text: string }) {
  return (
    <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words border-l border-border pl-3 text-sm leading-relaxed text-muted-foreground">
      {text}
    </div>
  );
}
