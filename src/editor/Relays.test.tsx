import fs from "fs";
import os from "os";
import path from "path";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAppTree } from "../appTestUtils.test";
import { loadCliProfile } from "../cli/config";

function localWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-settings-"));
}

async function addRelay(
  channel: "storage" | "room",
  url: string
): Promise<void> {
  await userEvent.type(screen.getByLabelText(`add ${channel} relay`), url);
  await userEvent.click(screen.getByLabelText(`save ${channel} relay`));
}

test("filesystem settings bind a room with the exact profile shape", async () => {
  const workspaceDir = localWorkspace();
  const { relayPool } = await renderAppTree({
    path: workspaceDir,
    initialRoute: "/relays",
  });

  expect(screen.queryByLabelText("add storage relay")).toBeNull();
  await addRelay("room", "wss://one.example/");
  await addRelay("room", "wss://two.example/");
  await userEvent.click(screen.getByText("Save"));

  await waitFor(() => {
    expect(loadCliProfile({ cwd: workspaceDir }).workspaceConfig).toEqual({
      storageRelays: [],
      roomRelays: ["wss://one.example/", "wss://two.example/"],
    });
  });
  expect(
    JSON.parse(
      fs.readFileSync(
        path.join(workspaceDir, ".knowstr", "profile.json"),
        "utf8"
      )
    )
  ).toEqual({
    nsec_file: "./.knowstr/me.nsec",
    shared: {
      relays: ["wss://one.example/", "wss://two.example/"],
    },
  });
  expect(
    fs.statSync(path.join(workspaceDir, ".knowstr", "me.nsec")).mode % 0o1000
  ).toBe(0o600);
  expect(relayPool.getEvents()).toEqual([]);
});

test("filesystem settings reload, edit, and remove the room", async () => {
  const workspaceDir = localWorkspace();
  const { unmount: unmountFirst } = await renderAppTree({
    path: workspaceDir,
    initialRoute: "/relays",
  });
  await addRelay("room", "wss://old.example/");
  await userEvent.click(screen.getByText("Save"));
  const nsecPath = path.join(workspaceDir, ".knowstr", "me.nsec");
  await waitFor(() => expect(fs.existsSync(nsecPath)).toBe(true));
  const nsec = fs.readFileSync(nsecPath, "utf8");
  unmountFirst();

  const { unmount: unmountSecond } = await renderAppTree({
    path: workspaceDir,
    initialRoute: "/relays",
  });
  await screen.findByLabelText("room relay wss://old.example/");
  await userEvent.click(
    screen.getByLabelText("delete room relay wss://old.example/")
  );
  await addRelay("room", "wss://new.example/");
  await userEvent.click(screen.getByText("Save"));
  await waitFor(() =>
    expect(
      loadCliProfile({ cwd: workspaceDir }).workspaceConfig.roomRelays
    ).toEqual(["wss://new.example/"])
  );
  unmountSecond();

  await renderAppTree({ path: workspaceDir, initialRoute: "/relays" });
  await screen.findByLabelText("room relay wss://new.example/");
  await userEvent.click(
    screen.getByLabelText("delete room relay wss://new.example/")
  );
  await userEvent.click(screen.getByText("Save"));

  await waitFor(() =>
    expect(
      fs.existsSync(path.join(workspaceDir, ".knowstr", "profile.json"))
    ).toBe(false)
  );
  expect(fs.readFileSync(nsecPath, "utf8")).toBe(nsec);
});
