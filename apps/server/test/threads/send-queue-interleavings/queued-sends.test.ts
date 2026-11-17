import {
  describeInterleavings,
  send,
  steer,
  type Scenario,
} from "./harness.js";

const scenarios: Scenario[] = [
  {
    name: "a new turn in flight while a provider-initiated turn ends",
    start: "idle",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), steer("msg-B")],
    events: ["provider-turn"],
  },
  {
    name: "a queued send, a steer and a drain wake while preparation is slow",
    start: "running-turn",
    holdPreparation: true,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [send("msg-A"), steer("msg-B")],
    events: ["drain"],
  },
];

describeInterleavings("queued send interleavings", scenarios);
