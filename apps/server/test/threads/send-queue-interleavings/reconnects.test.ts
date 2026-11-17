import {
  describeInterleavings,
  send,
  steer,
  stop,
  type Scenario,
} from "./harness.js";

const scenarios: Scenario[] = [
  {
    name: "a steer, a queued send and the turn end across a daemon reconnect",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), send("msg-B")],
    events: ["reconnect"],
  },
  {
    name: "a stop aimed at a message still on its way, across a daemon reconnect",
    start: "idle",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), stop],
    events: ["reconnect"],
  },
];

describeInterleavings(
  "send and stop interleavings across a daemon reconnect",
  scenarios,
);
