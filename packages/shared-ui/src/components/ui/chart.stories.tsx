import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./chart.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Chart",
};

const chartData = [
  { day: "Mon", threads: 12 },
  { day: "Tue", threads: 18 },
  { day: "Wed", threads: 9 },
  { day: "Thu", threads: 21 },
  { day: "Fri", threads: 15 },
];

const chartConfig = {
  threads: { label: "Threads", color: "var(--color-primary)" },
} satisfies ChartConfig;

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Bar chart with tooltip">
        <ChartContainer config={chartConfig} className="h-48 w-96">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="threads" fill="var(--color-threads)" radius={4} />
          </BarChart>
        </ChartContainer>
      </StoryRow>
    </StoryCard>
  );
}
