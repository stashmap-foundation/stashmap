import fs from "fs";
import path from "path";
import { cleanup } from "@testing-library/react";
import {
  expandOverlayWorkspace,
  reloadOverlayWorkspace,
  writeOverlayWorkspace,
} from "./OverlayScenario.test";
import { expectTree } from "../utils.test";

const corpusPath = path.resolve(__dirname, "../../test/corpus");
const fixtures = fs
  .readdirSync(corpusPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d+-recursive-/u.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => parseInt(left, 10) - parseInt(right, 10));

function fixtureWorkspace(fixture: string): string {
  const fixturePath = path.join(corpusPath, fixture);
  const sourcesPath = path.join(fixturePath, "sources");
  const files = {
    "note.md": fs.readFileSync(path.join(fixturePath, "diff.md"), "utf8"),
    "source.md": fs.readFileSync(path.join(fixturePath, "source.md"), "utf8"),
  };
  return writeOverlayWorkspace(
    fs.existsSync(sourcesPath)
      ? fs.readdirSync(sourcesPath).reduce(
          (current, name) => ({
            ...current,
            [name]: fs.readFileSync(path.join(sourcesPath, name), "utf8"),
          }),
          files
        )
      : files
  );
}

function visibleTree(fixture: string): string {
  const expected = fs.readFileSync(
    path.join(corpusPath, fixture, "expected.tree"),
    "utf8"
  );
  return expected
    .trimEnd()
    .split("\n")
    .map((line) => {
      const dead = /flag:(dangling|orphan-source)/u.test(line);
      const visible = line.replace(/ <!-- .* -->$/u, "");
      return dead ? `${visible}†` : visible;
    })
    .join("\n");
}

afterEach(cleanup);

test.each(fixtures)(
  "recursive corpus renders and reloads: %s",
  async (fixture) => {
    const workspacePath = fixtureWorkspace(fixture);
    const expected = visibleTree(fixture);
    await expandOverlayWorkspace(workspacePath, "note.md");
    await expectTree(expected, {
      showGutter: true,
      withoutReferenceRows: true,
    });
    await reloadOverlayWorkspace(workspacePath, "note.md");
    await expectTree(expected, {
      showGutter: true,
      withoutReferenceRows: true,
    });
  }
);
