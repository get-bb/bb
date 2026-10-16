if (process.env.BB_TEST_BEFORE_READY === "1") {
  process.exit(2);
} else {
  process.on("message", (message) => {
    if (message?.type === "shutdown") process.exit(0);
    if (message?.type === "forget-terminal") process.exit(1);
  });
  process.send?.({ type: "ready", pid: process.pid });
}
