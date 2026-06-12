import { useUserRelayContext } from "./UserRelayContext";
import { useDefaultRelays } from "./NostrAuthContext";
import { getReadRelays, getWriteRelays } from "./relayUtils";

export {
  flattenRelays,
  getWriteRelays,
  mergeRelays,
  sanitizeRelays,
  sanitizeRelayUrl,
} from "./relayUtils";

export function usePreloadRelays({
  defaultRelays,
  user,
}: WriteRelayConf): Relays {
  const def = useDefaultRelays();
  const { userRelays } = useUserRelayContext();
  return getReadRelays([
    ...(defaultRelays ? def : []),
    ...(user ? userRelays : []),
  ]);
}

export function applyWriteRelayConfig(
  defaultRelays: Relays,
  userRelays: Relays,
  config?: WriteRelayConf
): Relays {
  if (!config) {
    return getWriteRelays(userRelays);
  }
  return getWriteRelays([
    ...(config.defaultRelays ? defaultRelays : []),
    ...(config.user ? userRelays : []),
    ...(config.extraRelays ? config.extraRelays : []),
  ]);
}

export function useRelaysToCreatePlan(): AllRelays {
  const defaultRelays = useDefaultRelays();
  const { userRelays } = useUserRelayContext();
  return {
    defaultRelays,
    userRelays,
  };
}

export function useRelaysForRelayManagement(): Relays {
  const { userRelays } = useUserRelayContext();
  return userRelays || [];
}
