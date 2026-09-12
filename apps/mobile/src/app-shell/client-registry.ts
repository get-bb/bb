import {
  createProfileClientRegistry,
  type ProfileClientRegistry,
} from "@/lib/sdk";

let instance: ProfileClientRegistry | null = null;

export function getAppProfileClientRegistry(): ProfileClientRegistry {
  if (!instance) {
    instance = createProfileClientRegistry();
  }
  return instance;
}
