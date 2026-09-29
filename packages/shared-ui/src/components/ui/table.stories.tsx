import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Table",
};

const ROWS = [
  { plugin: "tasks", installs: 1020, status: "active" },
  { plugin: "github", installs: 817, status: "active" },
  { plugin: "theme-preview", installs: 42, status: "active" },
];

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Plugin install counts">
        <Table className="w-96">
          <TableHeader>
            <TableRow>
              <TableHead>Plugin</TableHead>
              <TableHead>Installs</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((row) => (
              <TableRow key={row.plugin}>
                <TableCell className="font-medium">{row.plugin}</TableCell>
                <TableCell>{row.installs.toLocaleString()}</TableCell>
                <TableCell>{row.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </StoryRow>
    </StoryCard>
  );
}
