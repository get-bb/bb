import { createContext, useContext, type ReactNode } from "react";
import {
  usePluginActionServices,
  type BindPluginActionServices,
  type PluginActionServices,
} from "@/lib/plugin-navigation-hooks";

function unavailable<T extends object>(pluginId: string, name: string): T {
  return new Proxy({} as T, {
    get(_target, property) {
      throw new Error(
        `Plugin ${pluginId} used ${name}.${String(property)} outside PluginActionServicesProvider`,
      );
    },
  });
}

export function unavailablePluginActionServices(
  pluginId: string,
): PluginActionServices {
  return {
    sdk: unavailable(pluginId, "sdk"),
    navigate: unavailable(pluginId, "navigate"),
  };
}

const PluginActionServicesContext = createContext<BindPluginActionServices>(
  unavailablePluginActionServices,
);

export function PluginActionServicesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const bind = usePluginActionServices();
  return (
    <PluginActionServicesContext.Provider value={bind}>
      {children}
    </PluginActionServicesContext.Provider>
  );
}

export function useBindPluginActionServices(): BindPluginActionServices {
  return useContext(PluginActionServicesContext);
}
