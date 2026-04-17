export type DesktopShellBridge = {
  isElectron: boolean;
  platform?: string;
};

export function getDesktopBridgeFromWindow(source: {
  knowstrDesktop?: DesktopShellBridge;
}): DesktopShellBridge | undefined {
  return source.knowstrDesktop;
}

function getDesktopBridge(): DesktopShellBridge | undefined {
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
