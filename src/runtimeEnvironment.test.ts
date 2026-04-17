import {
  getDesktopBridgeFromWindow,
  isElectronDesktopShell,
  shouldUseHashRouter,
  supportsExtensionLogin,
} from "./runtimeEnvironment";

test("web environment does not use electron routing or disable extension login", () => {
  expect(getDesktopBridgeFromWindow({})).toBeUndefined();
  expect(isElectronDesktopShell()).toBe(false);
  expect(shouldUseHashRouter()).toBe(false);
  expect(supportsExtensionLogin()).toBe(true);
});

test("electron bridge data is read correctly", () => {
  expect(
    getDesktopBridgeFromWindow({
      knowstrDesktop: {
        isElectron: true,
        platform: "darwin",
      },
    })
  ).toEqual({
    isElectron: true,
    platform: "darwin",
  });
});
