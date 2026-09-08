import { z } from "zod";
import { sshDestinationSchema } from "bb-machine-ssh/configuration";

export const sshMachineInputsSchema = z
  .object({ target: sshDestinationSchema })
  .strict();
