import { describeInterleavings, stop, type Scenario } from "./harness.js";

const scenarios: Scenario[] = [
  {
    name: "a turn the agent starts after a stop, across a daemon reconnect",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [stop],
    events: ["provider-turn", "reconnect"],
  },
];

describeInterleavings("agent turn after a stop interleavings", scenarios);
