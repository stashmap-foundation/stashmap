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

export function expectMarkdown(
  workspaceDir: string,
  relativePath: string,
  expected: string
): void {
  const full = path.join(workspaceDir, relativePath);
  const raw = fs.readFileSync(full, "utf8");
  expect(normalizeMarkdownForComparison(raw)).toBe(
    normalizeMarkdownForComparison(expected)
  );
}
