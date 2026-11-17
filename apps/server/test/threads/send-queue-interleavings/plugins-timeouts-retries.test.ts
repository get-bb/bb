import {
  describeInterleavings,
  send,
  steer,
  retry,
  type Scenario,
} from "./harness.js";

const scenarios: Scenario[] = [
  {
    name: "an RPC timeout against steers and the turn end",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), steer("msg-B")],
    events: ["timeout"],
  },
  {
    name: "a plugin that holds a queued message against the turn end and a drain wake",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: ["msg-A"],
    pluginHeldLabels: [],
    user: [send("msg-A"), send("msg-B")],
    events: ["drain"],
  },
  {
    name: "a plugin recheck for a held message on a thread that also holds a draft",
    start: "idle",
    holdPreparation: false,
    pluginGatedLabels: ["msg-H"],
    pluginHeldLabels: ["msg-D"],
    user: [send("msg-D"), send("msg-H")],
    events: [],
  },
  {
    name: "a retry of a failed turn against a steer and a queued send",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), send("msg-B"), retry],
    events: ["fail-turn"],
  },
];

describeInterleavings("plugin, RPC timeout and retry interleavings", scenarios);
