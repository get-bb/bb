#!/usr/bin/env node
import {
  BB_APP_PROCESS_NAME,
  setLinuxProcessName,
} from "@bb/config/machine-service";
import { runBbApp, runLauncherEntry } from "../launcher.js";

setLinuxProcessName(BB_APP_PROCESS_NAME);
runLauncherEntry(runBbApp);
