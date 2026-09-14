import { apiDesign } from "./api-design.js";
import { dataAnalysis } from "./data-analysis.js";
import { incidentWriteup } from "./incident-writeup.js";
import { longResponse } from "./long-response.js";
import { pathological } from "./pathological.js";
import { refactorPlan } from "./refactor-plan.js";

export const STREAMING_MARKDOWN_FIXTURES = [
  { name: "long-response", text: longResponse },
  { name: "incident-writeup", text: incidentWriteup },
  { name: "refactor-plan", text: refactorPlan },
  { name: "api-design", text: apiDesign },
  { name: "data-analysis", text: dataAnalysis },
  { name: "pathological", text: pathological },
] as const;
