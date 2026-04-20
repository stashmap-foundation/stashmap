import { UnsignedEvent } from "nostr-tools";

export type DesktopWorkspaceLoad = {
  pubkey: string;
  workspaceDir: string;
  events: UnsignedEvent[];
};

export type DesktopShellBridge = {
  isElectron: boolean;
  platform?: string;
  workspace?: {
    load: () => Promise<DesktopWorkspaceLoad>;
  };
};

export function getDesktopBridgeFromWindow(source: {
  knowstrDesktop?: DesktopShellBridge;
}): DesktopShellBridge | undefined {
  return source.knowstrDesktop;
}

export function getDesktopBridge(): DesktopShellBridge | undefined {
  return getDesktopBridgeFromWindow(window);
}

export function isElectronDesktopShell(): boolean {
  return getDesktopBridge()?.isElectron === true;
}

export function supportsExtensionLogin(): boolean {
  return !isElectronDesktopShell();
}

export function shouldUseHashRouter(): boolean {
  return isElectronDesktopShell();
}
