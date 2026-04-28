import React from "react";
import { RenderResult, screen } from "@testing-library/react";
import { nip19 } from "nostr-tools";
import { FilesystemBackendProvider } from "./infra/filesystem/FilesystemBackendProvider";
import { FilesystemDataProvider } from "./infra/filesystem/FilesystemDataProvider";
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

/* eslint-disable functional/immutable-data */
const PENDING_IPCS: MockWorkspaceIpc[] = [];

afterEach(async () => {
  const pending = PENDING_IPCS.splice(0);
  await Promise.all(pending.map((ipc) => ipc.dispose()));
});
/* eslint-enable functional/immutable-data */

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
  // eslint-disable-next-line functional/immutable-data
  PENDING_IPCS.push(ipc);

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
      DataProvider: FilesystemDataProvider,
    }
  );

  if (path === undefined) {
    await screen.findByLabelText("Open Folder as Workspace");
    return { ...utils, ipc };
  }

  const profile = loadCliProfile({ cwd: path });
  await screen.findByLabelText("Search to change pane 0 content");
  if (options.search) {
    await navigateToNodeViaSearch(0, options.search, {
      waitForFullscreen: true,
    });
  }
  return {
    ...utils,
    ipc,
    path,
    pubkey: profile.pubkey,
    npub: nip19.npubEncode(profile.pubkey),
  };
}
