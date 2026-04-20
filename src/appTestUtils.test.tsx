import React from "react";
import { RenderResult } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { FilesystemBackendProvider } from "./FilesystemBackendProvider";
import { FilesystemIdentityProvider } from "./FilesystemIdentityProvider";
import {
  loadFilesystemWorkspaceBeforeReact,
  resetFilesystemBootstrapForTest,
} from "./filesystemBootstrap";
import { loadCliProfile } from "./cli/config";
import { loadWorkspaceAsEvents } from "./core/workspaceBackend";
import { knowstrInit } from "./testFixtures/workspace";
import {
  RootViewOrPaneIsLoading,
  navigateToNodeViaSearch,
  renderWithTestData,
} from "./utils.test";
import { PaneView } from "./components/Workspace";

// eslint-disable-next-line @typescript-eslint/no-empty-function
test.skip("skip", () => {});

type AppRenderOptions = {
  path?: string;
  // Navigate pane 0 to the node with this label via the search UI after mount.
  search?: string;
};

type AppRenderResult = RenderResult & {
  path: string;
  npub: string;
  pubkey: PublicKey;
};

function installDesktopBridge(workspaceDir: string): void {
  // eslint-disable-next-line functional/immutable-data
  (window as unknown as { knowstrDesktop: unknown }).knowstrDesktop = {
    isElectron: true,
    platform: "test",
    workspace: {
      load: async () => {
        const profile = loadCliProfile({ cwd: workspaceDir });
        const events = await loadWorkspaceAsEvents({
          pubkey: profile.pubkey,
          workspaceDir: profile.workspaceDir,
        });
        return {
          pubkey: profile.pubkey,
          workspaceDir: profile.workspaceDir,
          events,
        };
      },
    },
  };
}

function uninstallDesktopBridge(): void {
  // eslint-disable-next-line functional/immutable-data
  delete (window as unknown as { knowstrDesktop?: unknown }).knowstrDesktop;
}

afterEach(() => {
  resetFilesystemBootstrapForTest();
  uninstallDesktopBridge();
});

function readIdentityFromWorkspace(workspaceDir: string): {
  pubkey: PublicKey;
  npub: string;
} {
  const profile = loadCliProfile({ cwd: workspaceDir });
  return { pubkey: profile.pubkey, npub: nip19.npubEncode(profile.pubkey) };
}

export async function renderAppTree(
  options: AppRenderOptions = {}
): Promise<AppRenderResult> {
  const workspaceDir = options.path ?? knowstrInit().path;
  const { pubkey, npub } = readIdentityFromWorkspace(workspaceDir);

  installDesktopBridge(workspaceDir);
  await loadFilesystemWorkspaceBeforeReact();

  const utils = renderWithTestData(
    <RootViewOrPaneIsLoading>
      <PaneView />
    </RootViewOrPaneIsLoading>,
    {
      user: { publicKey: pubkey },
      panes: [{ id: "pane-0", stack: [], author: pubkey }],
      BackendProvider: FilesystemBackendProvider,
      IdentityProvider: FilesystemIdentityProvider,
    }
  );

  if (options.search) {
    await navigateToNodeViaSearch(0, options.search);
  }

  return { ...utils, path: workspaceDir, pubkey, npub };
}
