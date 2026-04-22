import fs from "fs";
import os from "os";
import path from "path";
import { runInitCommand } from "../cli/init";
import { runSaveCommand } from "../cli/save";
import { runApplyCommand } from "../cli/apply";

type InitResult = {
  nsec: string;
  npub: string;
  path: string;
  profilePath: string;
};

type InitOptions = {
  relays?: string[];
  doc?: string;
};

export function knowstrInit(options: InitOptions = {}): InitResult {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "knowstr-test-"));
  const relayArgs = (options.relays ?? []).flatMap((url) => ["--relay", url]);
  const docArgs = options.doc ? ["--doc", options.doc] : [];
  const result = runInitCommand([...relayArgs, ...docArgs], tempDir);
  if ("help" in result) {
    throw new Error("knowstrInit: unexpected help output");
  }
  const nsecPath = path.join(tempDir, ".knowstr", "me.nsec");
  const nsec = fs.readFileSync(nsecPath, "utf8").trim();
  return {
    nsec,
    npub: result.npub,
    path: tempDir,
    profilePath: result.config_path,
  };
}

export function write(
  workspaceDir: string,
  relativePath: string,
  content: string
): void {
  const full = path.join(workspaceDir, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function profilePathFor(workspaceDir: string): string {
  return path.join(workspaceDir, ".knowstr", "profile.json");
}

export async function knowstrSave(
  workspaceDir: string
): Promise<{ changed_paths: string[] }> {
  const result = await runSaveCommand([
    "--config",
    profilePathFor(workspaceDir),
  ]);
  if ("help" in result) {
    throw new Error("knowstrSave: unexpected help output");
  }
  return result;
}

type ApplyResult = Exclude<
  Awaited<ReturnType<typeof runApplyCommand>>,
  { help: true; text: string }
>;

export async function knowstrApply(
  workspaceDir: string,
  options: { dryRun?: boolean } = {}
): Promise<ApplyResult> {
  const args = [
    "--config",
    profilePathFor(workspaceDir),
    ...(options.dryRun ? ["--dry-run"] : []),
  ];
  const result = await runApplyCommand(args);
  if ("help" in result) {
    throw new Error("knowstrApply: unexpected help output");
  }
  return result;
}

function maskIdValues(content: string): string {
  return content.replace(/<!--\s*id:[^>]+-->/gu, "<!-- id:... -->");
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, "");
}

function normalizeMarkdownForComparison(content: string): string {
  return maskIdValues(stripFrontmatter(content))
    .replace(/^\n+/u, "")
    .replace(/\n+$/u, "");
}

// Reads the assigned id from the line that contains `needle` in the given
// workspace file. Use after knowstrSave to pick up ids that knowstr generated.
export function readNodeId(
  workspaceDir: string,
  relativePath: string,
  needle: string
): string {
  const full = path.join(workspaceDir, relativePath);
  const content = fs.readFileSync(full, "utf8");
  const line = content
    .split("\n")
    .find((candidate) => candidate.includes(needle));
  if (!line) {
    throw new Error(
      `readNodeId: no line containing "${needle}" in ${relativePath}`
    );
  }
  const match = line.match(/<!--\s*id:(\S+)\s*-->/u);
  if (!match?.[1]) {
    throw new Error(`readNodeId: no id in line "${line}"`);
  }
  return match[1];
}

async function pollUntil(
  check: () => void,
  deadline: number,
  intervalMs = 10
): Promise<void> {
  try {
    check();
  } catch (err) {
    if (Date.now() >= deadline) throw err;
    await new Promise((resolve) => {
      setTimeout(resolve, intervalMs);
    });
    await pollUntil(check, deadline, intervalMs);
  }
}

export async function expectMarkdown(
  workspaceDir: string,
  relativePath: string,
  expected: string
): Promise<void> {
  const full = path.join(workspaceDir, relativePath);
  const expectedNormalized = normalizeMarkdownForComparison(expected);
  const read = (): string =>
    fs.existsSync(full)
      ? normalizeMarkdownForComparison(fs.readFileSync(full, "utf8"))
      : "";
  try {
    await pollUntil(() => {
      expect(read()).toBe(expectedNormalized);
    }, Date.now() + 1000);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.log(`ACTUAL MARKDOWN (${relativePath}):\n${read()}`);
    // eslint-disable-next-line no-console
    console.log(`EXPECTED MARKDOWN:\n${expectedNormalized}`);
    throw error;
  }
}

const ALWAYS_HIDDEN_ENTRIES = new Set([".knowstr", ".knowstrignore"]);

export function ls(workspaceDir: string, relativeDir = ""): string[] {
  const dirPath = path.join(workspaceDir, relativeDir);
  const entries = fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => !ALWAYS_HIDDEN_ENTRIES.has(entry.name))
    .flatMap((entry) => {
      const relativeEntryPath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        return ls(workspaceDir, relativeEntryPath);
      }
      return [relativeEntryPath];
    });
  return [...entries].sort();
}
