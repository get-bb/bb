import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [, , resultPath, elicitationJson] = process.argv;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "control_request") {
    send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: message.request_id,
        response: { commands: [], models: [], mcp_servers: [] },
      },
    });
    if (message.request.subtype === "initialize") {
      send({
        type: "control_request",
        request_id: "elicitation-1",
        request: JSON.parse(elicitationJson),
      });
    }
  }
  if (
    message.type === "control_response" &&
    message.response.request_id === "elicitation-1"
  ) {
    writeFileSync(resultPath, JSON.stringify(message.response));
  }
});
