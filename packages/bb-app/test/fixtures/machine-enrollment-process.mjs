import { enrollMachine } from "../../../../apps/cli/src/commands/machine-enrollment.ts";

const env = {
  BB_DATA_DIR: process.env.BB_DATA_DIR,
  BB_ENROLLMENT: process.env.BB_ENROLLMENT,
  PATH: "/nonexistent",
};

await enrollMachine(
  { bootstrapEnv: "BB_ENROLLMENT" },
  {
    env,
    fetchFn: async () =>
      Response.json(
        { hostId: "host_synthetic", hostKey: "synthetic-host-key" },
        { status: 201 },
      ),
    homeDir: process.env.BB_DATA_DIR,
  },
);
