import type { ReactNode } from "react";
import type { PluginNavPanelProps } from "@bb/plugin-sdk/app";
import type { DailySummary } from "../../shared/contract.js";
import { localDateKey } from "../../shared/date.js";
import { useTasksQuery } from "../../shell/data.js";
import { TasksRefreshProvider } from "../../shell/refresh.js";

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning.";
  if (hour < 17) return "Good afternoon.";
  return "Good evening.";
}

function pluralTasks(count: number): string {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

interface Activity {
  className: string;
  highlight: string;
  suffix: string;
}

function ActivitySeparator({ index, total }: { index: number; total: number }) {
  if (index === 0) return null;
  if (index === total - 1) return total === 2 ? " and " : ", and ";
  return ", ";
}

function DailyMessage({ summary }: { summary: DailySummary }) {
  const activities: Activity[] = [];
  if (summary.dueToday > 0) {
    activities.push({
      className: "text-sky-500 dark:text-sky-300",
      highlight: pluralTasks(summary.dueToday),
      suffix: " due today",
    });
  }
  if (summary.inProgress > 0) {
    activities.push({
      className: "text-violet-500 dark:text-violet-300",
      highlight: `${summary.inProgress} in progress`,
      suffix: "",
    });
  }
  if (summary.overdue > 0) {
    activities.push({
      className: "text-amber-500 dark:text-amber-300",
      highlight: `${summary.overdue} overdue`,
      suffix: "",
    });
  }

  if (activities.length === 0) {
    return <>Your day is clear. Make room for something good.</>;
  }

  return (
    <>
      You have{" "}
      {activities.map((activity, index) => (
        <span key={activity.highlight}>
          <ActivitySeparator index={index} total={activities.length} />
          <span className={activity.className}>{activity.highlight}</span>
          {activity.suffix}
        </span>
      ))}
      .
    </>
  );
}

function HomeMessage({
  data,
  error,
  isLoading,
}: {
  data: DailySummary | undefined;
  error: string | null;
  isLoading: boolean;
}): ReactNode {
  if (data) return <DailyMessage summary={data} />;
  if (isLoading) return "I’m checking what’s on.";
  if (error) return "I couldn’t read your tasks just now.";
  return "Your day is ready when you are.";
}

function TasksHomePanelContent() {
  const now = new Date();
  const date = localDateKey(now);
  const summary = useTasksQuery(
    async (rpc) => rpc.call("dailySummary", { date }),
    ["tasks:changed"],
    [date],
  );

  return (
    <main className="flex h-full min-h-0 overflow-auto bg-background text-foreground">
      <div className="m-auto w-full max-w-6xl px-8 py-20 sm:px-14 lg:px-20">
        <h1 className="text-5xl font-medium tracking-tight sm:text-7xl lg:text-8xl">
          {greetingFor(now)}
        </h1>
        <p
          className="mt-10 max-w-5xl text-2xl leading-tight font-normal text-muted-foreground sm:mt-14 sm:text-4xl lg:text-5xl"
          aria-live="polite"
        >
          <HomeMessage {...summary} />
        </p>
      </div>
    </main>
  );
}

export function TasksHomePanel(_props: PluginNavPanelProps) {
  return (
    <TasksRefreshProvider>
      <TasksHomePanelContent />
    </TasksRefreshProvider>
  );
}
