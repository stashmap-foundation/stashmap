/** @jest-environment node */

import { SimplePool } from "nostr-tools";

jest.mock("./init", () => ({
  initHelp: () => "init help",
  runInitCommand: jest.fn(() => ({
    config_path: "/tmp/profile.json",
    pubkey: "a".repeat(64),
    npub: "npub-test",
    relays: [],
  })),
}));

jest.mock("./save", () => ({
  saveHelp: () => "save help",
  runSaveCommand: jest.fn(),
}));

jest.mock("./publish", () => ({
  publishHelp: () => "publish help",
  runPublishCommand: jest.fn(),
}));

test("runCli prints general help without apply", async () => {
  const { runCli } = await import("./main");
  const writeSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await runCli(["--help"]);

  expect(writeSpy).toHaveBeenCalledWith(
    expect.stringContaining("Usage: knowstr <command>")
  );
  expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("init help"));
  expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("save help"));
  expect(writeSpy).toHaveBeenCalledWith(
    expect.stringContaining("publish help")
  );
  expect(writeSpy).not.toHaveBeenCalledWith(expect.stringContaining("apply"));

  writeSpy.mockRestore();
});

test("runCli dispatches knowstr save", async () => {
  const { runCli } = await import("./main");
  const { runSaveCommand } = await import("./save");
  jest.mocked(runSaveCommand).mockResolvedValue({
    changed_paths: ["/tmp/doc.md"],
    warnings: [],
  });
  const writeSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await runCli(["save"]);

  expect(runSaveCommand).toHaveBeenCalledWith([]);
  expect(writeSpy).toHaveBeenCalledWith(
    `${JSON.stringify(
      { changed_paths: ["/tmp/doc.md"], warnings: [] },
      null,
      2
    )}\n`
  );

  writeSpy.mockRestore();
});

test("runCli dispatches knowstr publish with a relay pool", async () => {
  const { runCli } = await import("./main");
  const { runPublishCommand } = await import("./publish");
  jest.mocked(runPublishCommand).mockResolvedValue({
    changed_paths: [],
    accepted_paths: ["/tmp/doc.md"],
    unaccepted_paths: [],
    rejections: [],
    warnings: [],
  });
  const writeSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await runCli(["publish", "--config", "/tmp/profile.json"]);

  expect(runPublishCommand).toHaveBeenCalledWith(
    ["--config", "/tmp/profile.json"],
    expect.any(SimplePool)
  );
  expect(writeSpy).toHaveBeenCalledWith(
    `${JSON.stringify(
      {
        changed_paths: [],
        accepted_paths: ["/tmp/doc.md"],
        unaccepted_paths: [],
        rejections: [],
        warnings: [],
      },
      null,
      2
    )}\n`
  );

  writeSpy.mockRestore();
});

test("runCli fails knowstr publish when no relay accepted a document", async () => {
  const { runCli } = await import("./main");
  const { runPublishCommand } = await import("./publish");
  jest.mocked(runPublishCommand).mockResolvedValue({
    changed_paths: [],
    accepted_paths: ["/tmp/a.md"],
    unaccepted_paths: ["/tmp/b.md"],
    rejections: [
      { path: "/tmp/b.md", relay: "wss://room.example/", reason: "too large" },
    ],
    warnings: [],
  });
  const writeSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await expect(runCli(["publish"])).rejects.toThrow(
    "No relay accepted: /tmp/b.md"
  );

  expect(writeSpy).toHaveBeenCalledWith(
    expect.stringContaining('"accepted_paths": [\n    "/tmp/a.md"')
  );

  writeSpy.mockRestore();
});

test("runCli rejects knowstr apply as an unknown command", async () => {
  const { runCli } = await import("./main");

  await expect(runCli(["apply"])).rejects.toThrow("Unknown command: apply");
});
