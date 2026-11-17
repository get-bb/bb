import {
  describeInterleavings,
  send,
  steer,
  sendNow,
  type Scenario,
} from "./harness.js";

const scenarios: Scenario[] = [
  {
    name: "steers in flight while their turn ends",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), steer("msg-B")],
    events: [],
  },
  {
    name: "a send-now of a queued message against the turn end while preparation is slow",
    start: "running-turn",
    holdPreparation: true,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [send("msg-A"), send("msg-B"), sendNow("msg-A")],
    events: [],
  },
];

describeInterleavings("steer and send-now interleavings", scenarios);
