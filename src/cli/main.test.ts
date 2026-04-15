/** @jest-environment node */

jest.mock("./apply", () => ({
  applyHelp: () => "apply help",
  runApplyCommand: jest.fn(),
}));

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

test("runCli dispatches knowstr save", async () => {
  const { runCli } = (await import("./main")) as typeof import("./main");
  const { runSaveCommand } = (await import(
    "./save"
  )) as typeof import("./save");
  (runSaveCommand as jest.Mock).mockResolvedValue({
    changed_paths: ["/tmp/doc.md"],
    updated_paths: ["/tmp/doc.md"],
  });
  const writeSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await runCli(["save"]);

  expect(runSaveCommand).toHaveBeenCalledWith([]);
  expect(writeSpy).toHaveBeenCalledWith(
    `${JSON.stringify(
      {
        changed_paths: ["/tmp/doc.md"],
        updated_paths: ["/tmp/doc.md"],
      },
      null,
      2
    )}\n`
  );

  writeSpy.mockRestore();
});

test("runCli dispatches knowstr apply", async () => {
  const { runCli } = (await import("./main")) as typeof import("./main");
  const { runApplyCommand } = (await import(
    "./apply"
  )) as typeof import("./apply");
  (runApplyCommand as jest.Mock).mockResolvedValue({
    dry_run: true,
    graph_additions: [],
    maybe_relevant_paths: [],
    skipped_existing_ids: [],
    conflicting_ids: [],
    invalid_inbox_paths: [],
    changed_paths: [],
    cleared_inbox_paths: [],
  });
  const writeSpy = jest
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await runCli(["apply", "--dry-run"]);

  expect(runApplyCommand).toHaveBeenCalledWith(["--dry-run"]);
  expect(writeSpy).toHaveBeenCalledWith(
    `${JSON.stringify(
      {
        dry_run: true,
        graph_additions: [],
        maybe_relevant_paths: [],
        skipped_existing_ids: [],
        conflicting_ids: [],
        invalid_inbox_paths: [],
        changed_paths: [],
        cleared_inbox_paths: [],
      },
      null,
      2
    )}\n`
  );

  writeSpy.mockRestore();
});
