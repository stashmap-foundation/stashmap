import React from "react";
import { RenderResult } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { FilesystemBackendProvider } from "./infra/filesystem/FilesystemBackendProvider";
import { FilesystemAppRoot } from "./desktop/FilesystemAppRoot";
import {
  MockWorkspaceIpc,
  mockWorkspaceIpc,
} from "./testFixtures/mockWorkspaceIpc";
import { loadCliProfile } from "./cli/config";
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
  /**
   * Absolute path to a workspace folder. Defaults to a fresh `knowstrInit()`
   * temp dir.
   */
  path?: string;
  /**
   * Navigate pane 0 to the node with this label via the search UI after mount.
   */
  search?: string;
  /**
   * Start the app with no workspace selected (the "no workspace" empty state).
   * Tests must drive the pick/create flow via the returned `ipc`.
   */
  empty?: boolean;
};

type AppRenderResult = RenderResult & {
  ipc: MockWorkspaceIpc;
  path?: string;
  pubkey?: PublicKey;
  npub?: string;
};

export async function renderAppTree(
  options: AppRenderOptions = {}
): Promise<AppRenderResult> {
  const path = options.empty ? undefined : options.path ?? knowstrInit().path;
  const ipc = mockWorkspaceIpc(path ?? null);

  const utils = renderWithTestData(
    <FilesystemAppRoot>
      <RootViewOrPaneIsLoading>
        <PaneView />
      </RootViewOrPaneIsLoading>
    </FilesystemAppRoot>,
    {
      BackendProvider: ({ children }) => (
        <FilesystemBackendProvider ipc={ipc}>
          {children}
        </FilesystemBackendProvider>
      ),
    }
  );

  if (path === undefined) {
    return { ...utils, ipc };
  }

  const profile = loadCliProfile({ cwd: path });
  if (options.search) {
    await navigateToNodeViaSearch(0, options.search);
  }
  return {
    ...utils,
    ipc,
    path,
    pubkey: profile.pubkey,
    npub: nip19.npubEncode(profile.pubkey),
  };
}
