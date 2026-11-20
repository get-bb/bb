import {
  buildAgentInstructions,
  enabledContexts,
  loadPluginAgentContexts,
  skillListing,
} from "./agent-context.js";
import { measureAgentContext } from "./budget.js";

const contexts = await loadPluginAgentContexts();
const enabled = enabledContexts(contexts);
const measured = measureAgentContext(enabled);
const tokens = (chars: number) =>
  `${chars} chars (~${Math.round(chars / 4)} tokens)`;
console.log(
  "Agent context that bb's default-enabled plugins add to every thread:\n",
);
for (const row of measured.plugins.filter((plugin) => plugin.total > 0)) {
  console.log(
    `${row.pluginId.padEnd(28)} ${String(row.total).padStart(6)}  instructions ${row.instructions}, skills ${row.skills}, tools ${row.tools}`,
  );
}
console.log(`\nSystem text: ${tokens(buildAgentInstructions(enabled).length)}`);
console.log(
  `Skill listing: ${tokens(
    enabled
      .flatMap((context) => context.skills)
      .map(skillListing)
      .join("\n").length,
  )}`,
);
console.log(`Tool descriptions and schemas: ${tokens(measured.tools)}`);
console.log(`Total: ${tokens(measured.total)}`);
if (process.argv.includes("--text")) {
  console.log(`\n${buildAgentInstructions(enabled)}`);
}
