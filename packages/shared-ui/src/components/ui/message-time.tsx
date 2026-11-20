function formatMessageDay(date: Date, now: Date): string {
  if (date.toDateString() === now.toDateString()) {
    return "Today";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatShortMessageTime(timestamp: number, now: Date): string {
  const date = new Date(timestamp);
  const time = formatClockTime(date);
  return date.toDateString() === now.toDateString()
    ? time
    : `${formatMessageDay(date, now)}, ${time}`;
}

export function formatDayMessageTime(timestamp: number, now: Date): string {
  const date = new Date(timestamp);
  return `${formatMessageDay(date, now)}, ${formatClockTime(date)}`;
}

export function MessageTime({
  timestamp,
  label,
  className,
}: {
  timestamp: number;
  label: string;
  className?: string;
}) {
  const date = new Date(timestamp);
  return (
    <time
      className={className}
      dateTime={date.toISOString()}
      title={date.toLocaleString(undefined, {
        dateStyle: "full",
        timeStyle: "long",
      })}
    >
      {label}
    </time>
  );
}
