import {
  describeInterleavings,
  send,
  steer,
  addToQueue,
  stop,
  type Scenario,
} from "./harness.js";

const scenarios: Scenario[] = [
  {
    name: "a stop against a steer, a queued send and the turn end",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [steer("msg-A"), stop, send("msg-B")],
    events: [],
  },
  {
    name: "a stop and a steer across a daemon reconnect",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [stop, steer("msg-A")],
    events: ["reconnect"],
  },
  {
    name: "a message added to the queue after a stop between queued sends",
    start: "running-turn",
    holdPreparation: false,
    pluginGatedLabels: [],
    pluginHeldLabels: [],
    user: [send("msg-A"), stop, addToQueue("msg-B")],
    events: [],
  },
];

describeInterleavings("stop interleavings", scenarios);
