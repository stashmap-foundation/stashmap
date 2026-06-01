/**
 * Automated branch review loop for pi.
 *
 * Usage:
 *   /review-loop
 *   /review-loop main
 *   /review-loop --base master --levels low,medium,high,xhigh --max-passes 8
 *
 * Each pass starts a fresh pi process with --no-session and the requested
 * thinking level. The child agent reviews the current branch against the base
 * ref, fixes actionable issues, runs the mandatory project checks, and emits a
 * status marker. The parent verifies npm run test, npm run lint, and
 * npm run typescript after every pass. If a successful pass changed code, the
 * parent creates a `wip: ...` commit before starting the next fresh-context pass.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ReviewStatus = "CLEAN" | "FIXED" | "BLOCKED" | "UNKNOWN";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface ReviewLoopOptions {
  base: string;
  levels: ThinkingLevel[];
  maxPassesPerLevel: number;
  model?: string;
  noChildExtensions: boolean;
}

interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  turns: number;
}

interface ReviewPassResult {
  status: ReviewStatus;
  output: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  usage: UsageStats;
  model?: string;
}

interface ValidationCommandResult {
  name: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface ValidationResult {
  ok: boolean;
  commands: ValidationCommandResult[];
}

interface RecordedPass extends ReviewPassResult {
  level: ThinkingLevel;
  pass: number;
  effectiveStatus: ReviewStatus;
  workingTreeChanged: boolean;
  validation?: ValidationResult;
  commitHash?: string;
}

const DEFAULT_LEVELS: ThinkingLevel[] = ["low", "medium", "high", "xhigh"];
const VALID_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".swift",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".graphql",
  ".gql",
  ".yml",
  ".yaml",
  ".toml",
  ".xml",
  ".snap",
]);

const CODE_BASENAMES = new Set([
  "dockerfile",
  "makefile",
  "rakefile",
  "gemfile",
  "podfile",
  "procfile",
  "jenkinsfile",
  "brewfile",
  ".babelrc",
  ".eslintrc",
  ".prettierrc",
  ".swcrc",
]);

function usage(): string {
  return [
    "Usage: /review-loop [base-ref] [options]",
    "",
    "Options:",
    "  --base <ref>              Base ref to review against (default: master)",
    "  --levels <csv>            Thinking levels (default: low,medium,high,xhigh)",
    "  --max-passes <n>          Safety cap per level (default: 8)",
    "  --model <pattern>         Model for child review agents (default: current model)",
    "  --no-child-extensions     Start child agents with --no-extensions",
    "",
    "The loop ignores idea.md, implementation.md, and .idea/**, verifies npm run test/lint/typescript after each pass, and creates wip: commits for successful code changes.",
  ].join("\n");
}

function splitArgs(input: string): string[] {
  return (input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((token) => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

function parseArgs(args: string): ReviewLoopOptions | { help: true } {
  const tokens = splitArgs(args);
  const options: ReviewLoopOptions = {
    base: "master",
    levels: [...DEFAULT_LEVELS],
    maxPassesPerLevel: 8,
    noChildExtensions: false,
  };

  let positionalBaseSet = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token === "--help" || token === "-h") return { help: true };

    if (token === "--base") {
      options.base = requireValue(tokens, ++i, token);
      positionalBaseSet = true;
      continue;
    }
    if (token.startsWith("--base=")) {
      options.base = token.slice("--base=".length);
      positionalBaseSet = true;
      continue;
    }

    if (token === "--levels") {
      options.levels = parseLevels(requireValue(tokens, ++i, token));
      continue;
    }
    if (token.startsWith("--levels=")) {
      options.levels = parseLevels(token.slice("--levels=".length));
      continue;
    }

    if (token === "--max-passes") {
      options.maxPassesPerLevel = parseMaxPasses(
        requireValue(tokens, ++i, token)
      );
      continue;
    }
    if (token.startsWith("--max-passes=")) {
      options.maxPassesPerLevel = parseMaxPasses(
        token.slice("--max-passes=".length)
      );
      continue;
    }

    if (token === "--model") {
      options.model = requireValue(tokens, ++i, token);
      continue;
    }
    if (token.startsWith("--model=")) {
      options.model = token.slice("--model=".length);
      continue;
    }

    if (token === "--no-child-extensions") {
      options.noChildExtensions = true;
      continue;
    }

    if (!token.startsWith("-") && !positionalBaseSet) {
      options.base = token;
      positionalBaseSet = true;
      continue;
    }

    throw new Error(`Unknown review-loop argument: ${token}\n\n${usage()}`);
  }

  if (!options.base.trim()) throw new Error("Base ref cannot be empty.");
  return options;
}

function requireValue(tokens: string[], index: number, flag: string): string {
  const value = tokens[index];
  if (!value) throw new Error(`Missing value for ${flag}.\n\n${usage()}`);
  return value;
}

function parseLevels(raw: string): ThinkingLevel[] {
  const levels = raw
    .split(",")
    .map((level) => level.trim())
    .filter(Boolean) as ThinkingLevel[];

  if (levels.length === 0)
    throw new Error("--levels must include at least one thinking level.");

  for (const level of levels) {
    if (!VALID_LEVELS.has(level)) {
      throw new Error(
        `Invalid thinking level: ${level}. Expected one of: ${Array.from(
          VALID_LEVELS
        ).join(", ")}.`
      );
    }
  }
  return levels;
}

function parseMaxPasses(raw: string): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1)
    throw new Error("--max-passes must be a positive integer.");
  return value;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function isExcludedPath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  return (
    basename === "idea.md" ||
    basename === "implementation.md" ||
    normalized === ".idea" ||
    normalized.startsWith(".idea/") ||
    normalized.includes("/.idea/")
  );
}

function isReviewableCodePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  if (!normalized || isExcludedPath(normalized)) return false;
  const basename = path.posix.basename(normalized);
  if (CODE_BASENAMES.has(basename)) return true;
  return CODE_EXTENSIONS.has(path.posix.extname(normalized));
}

function parseNulList(output: string): string[] {
  return output.split("\0").map(normalizeRelativePath).filter(Boolean);
}

async function git(
  pi: ExtensionAPI,
  cwd: string,
  args: string[]
): Promise<string> {
  const result = await pi.exec("git", ["-C", cwd, ...args]);
  if (result.code !== 0) {
    const message = (
      result.stderr ||
      result.stdout ||
      "git command failed"
    ).trim();
    throw new Error(`git ${args.join(" ")} failed: ${message}`);
  }
  return result.stdout;
}

async function gitMaybe(
  pi: ExtensionAPI,
  cwd: string,
  args: string[]
): Promise<string> {
  const result = await pi.exec("git", ["-C", cwd, ...args]);
  return result.stdout || result.stderr || "";
}

async function getChangedReviewFiles(
  pi: ExtensionAPI,
  root: string,
  base: string
): Promise<string[]> {
  const outputs = await Promise.all([
    git(pi, root, [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMRTUXB",
      `${base}...HEAD`,
      "--",
      ".",
    ]),
    git(pi, root, [
      "diff",
      "--name-only",
      "-z",
      "--cached",
      "--diff-filter=ACMRTUXB",
      "--",
      ".",
    ]),
    git(pi, root, [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMRTUXB",
      "--",
      ".",
    ]),
    git(pi, root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]),
  ]);

  const files = new Set<string>();
  for (const output of outputs) {
    for (const file of parseNulList(output)) {
      if (isReviewableCodePath(file)) files.add(file);
    }
  }
  return Array.from(files).sort();
}

async function getWorkingTreeFingerprint(
  pi: ExtensionAPI,
  root: string
): Promise<string> {
  const hash = createHash("sha256");
  const commands = [
    ["rev-parse", "HEAD"],
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    ["diff", "--binary", "--no-ext-diff", "--", "."],
    ["diff", "--cached", "--binary", "--no-ext-diff", "--", "."],
  ];

  for (const args of commands) {
    hash.update(`\n$ git ${args.join(" ")}\0`);
    hash.update(await gitMaybe(pi, root, args));
  }

  const untracked = parseNulList(
    await gitMaybe(pi, root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ])
  );
  for (const file of untracked.sort()) {
    const absolutePath = path.join(root, file);
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) continue;
      hash.update(`\0untracked:${file}:${stat.size}:${stat.mtimeMs}\0`);
      hash.update(await fs.readFile(absolutePath));
    } catch {
      // File may have disappeared between git and fs calls. Ignore and let the
      // next pass fingerprint the current tree.
    }
  }

  return hash.digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function formatFileList(files: string[]): string {
  if (files.length === 0)
    return "(No reviewable code/configuration files detected before this pass.)";
  const visible = files.slice(0, 150).map((file) => `- ${file}`);
  if (files.length > visible.length)
    visible.push(`- ... and ${files.length - visible.length} more`);
  return visible.join("\n");
}

function buildReviewPrompt(input: {
  base: string;
  branch: string;
  root: string;
  level: ThinkingLevel;
  pass: number;
  changedFiles: string[];
  validationFailure?: string;
}): string {
  const range = shellQuote(`${input.base}...HEAD`);
  const exclusions =
    "':(exclude)idea.md' ':(exclude)implementation.md' ':(exclude).idea/**'";
  const validationFailureSection = input.validationFailure
    ? [
        "Previous mandatory validation failure from the immediately preceding pass:",
        truncateTail(input.validationFailure, 8000),
        "",
      ]
    : [];

  return [
    "You are the review-and-fix runner for an automated pi review loop.",
    "This is a fresh-context pass. Do not rely on any previous review pass conversation.",
    "",
    `Repository root: ${input.root}`,
    `Current branch: ${input.branch}`,
    `Base ref: ${input.base}`,
    `Requested thinking level for this pass: ${input.level}`,
    `Pass number at this level: ${input.pass}`,
    "",
    ...validationFailureSection,
    "Review scope:",
    `- Review the current branch against ${input.base}. Include committed branch changes (${input.base}...HEAD), staged changes, unstaged changes, and untracked code/configuration files.`,
    "- Review only code/configuration. Ignore prose/docs unless they are executable inputs or configuration.",
    "- Do not read, review, or edit idea.md, implementation.md, or .idea/**.",
    "- Stay focused on issues introduced by this branch; avoid unrelated cleanup and preference-only refactors.",
    "- Do not create commits; the parent review-loop extension commits successful fixes for you.",
    "",
    "Most important checks:",
    "- Code redundancies introduced by the branch.",
    "- Bugs, edge cases, broken error handling, race/state issues, or incorrect assumptions.",
    "- Violations of the project's coding standards and local conventions.",
    "- Performance regressions, unnecessary repeated work, or avoidable expensive operations.",
    "",
    "Mandatory validation before your final status:",
    "- Run npm run test exactly as written. Do not use --runInBand and do not pass it through after --.",
    "- Run npm run lint.",
    "- Run npm run typescript.",
    "- If any command fails, fix the failure and rerun the failing command. Only report CLEAN or FIXED after all three commands pass.",
    "",
    "Changed reviewable files detected before this pass:",
    formatFileList(input.changedFiles),
    "",
    "Suggested inspection commands (adapt as needed, and still inspect surrounding code when relevant):",
    `git diff --stat --find-renames ${range} -- . ${exclusions}`,
    `git diff --find-renames ${range} -- . ${exclusions}`,
    `git diff --stat --cached -- . ${exclusions}`,
    `git diff --cached -- . ${exclusions}`,
    `git diff --stat -- . ${exclusions}`,
    `git diff -- . ${exclusions}`,
    `git ls-files --others --exclude-standard -- . ${exclusions}`,
    "",
    "Task:",
    "1. If a previous validation failure is shown above, fix that first.",
    "2. Inspect the relevant diff and enough surrounding project code to understand intent and conventions.",
    "3. If you find actionable issues, fix them directly using the available tools.",
    "4. Run all mandatory validation commands listed above; tests must not use --runInBand.",
    "5. If no actionable issue remains and validation passes, leave files unchanged.",
    "6. If an issue or validation failure is real but cannot be safely fixed in this pass, explain why and mark BLOCKED.",
    "",
    "Final status contract:",
    "- Use REVIEW_LOOP_STATUS: CLEAN only if you found no actionable issue in scope, made no file changes in this pass, and npm run test, npm run lint, and npm run typescript all pass.",
    "- Use REVIEW_LOOP_STATUS: FIXED if you fixed at least one issue or validation failure and all three mandatory validation commands pass.",
    "- Use REVIEW_LOOP_STATUS: BLOCKED if you found an actionable issue or validation failure but could not fix it safely.",
    "",
    "End your final answer with exactly one of these marker lines, on its own line:",
    "REVIEW_LOOP_STATUS: CLEAN",
    "REVIEW_LOOP_STATUS: FIXED",
    "REVIEW_LOOP_STATUS: BLOCKED",
  ].join("\n");
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };

  return { command: "pi", args };
}

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function statusFromOutput(output: string): ReviewStatus {
  const matches = Array.from(
    output.matchAll(/REVIEW_LOOP_STATUS:\s*(CLEAN|FIXED|BLOCKED)\b/gi)
  );
  if (matches.length === 0) return "UNKNOWN";
  return matches[matches.length - 1][1].toUpperCase() as ReviewStatus;
}

function emptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
  };
}

async function runReviewPass(input: {
  root: string;
  prompt: string;
  level: ThinkingLevel;
  model?: string;
  noChildExtensions: boolean;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}): Promise<ReviewPassResult> {
  const started = Date.now();
  const args = ["--mode", "json", "-p", "--no-session"];
  if (input.model) args.push("--model", input.model);
  args.push("--thinking", input.level);
  if (input.noChildExtensions) args.push("--no-extensions");
  args.push(input.prompt);

  const invocation = getPiInvocation(args);
  const usage = emptyUsage();
  const assistantOutputs: string[] = [];

  return await new Promise<ReviewPassResult>((resolve) => {
    const proc = spawn(invocation.command, invocation.args, {
      cwd: input.root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdoutBuffer = "";
    let stderr = "";
    let model: string | undefined;
    let aborted = false;

    const processLine = (line: string) => {
      if (!line.trim()) return;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        assistantOutputs.push(line);
        return;
      }

      if (event.type === "tool_execution_start") {
        input.onProgress?.(`tool ${event.toolName}`);
      } else if (
        event.type === "message_end" &&
        event.message?.role === "assistant"
      ) {
        const text = messageText(event.message);
        if (text.trim()) assistantOutputs.push(text);
        usage.turns++;
        const eventUsage = event.message.usage;
        if (eventUsage) {
          usage.input += eventUsage.input || 0;
          usage.output += eventUsage.output || 0;
          usage.cacheRead += eventUsage.cacheRead || 0;
          usage.cacheWrite += eventUsage.cacheWrite || 0;
          usage.cost += eventUsage.cost?.total || 0;
        }
        if (event.message.model) model = event.message.model;
      } else if (event.type === "auto_retry_start") {
        input.onProgress?.(`retry ${event.attempt}/${event.maxAttempts}`);
      }
    };

    proc.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    const killProc = () => {
      aborted = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000).unref?.();
    };

    if (input.signal) {
      if (input.signal.aborted) killProc();
      else input.signal.addEventListener("abort", killProc, { once: true });
    }

    proc.on("error", (error) => {
      stderr += `\n${error.message}`;
    });

    proc.on("close", (code) => {
      if (input.signal) input.signal.removeEventListener("abort", killProc);
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      const output = assistantOutputs.join("\n\n").trim();
      resolve({
        status: aborted ? "UNKNOWN" : statusFromOutput(output),
        output,
        stderr,
        exitCode: aborted ? 130 : code ?? 1,
        durationMs: Date.now() - started,
        usage,
        model,
      });
    });
  });
}

const VALIDATION_COMMANDS = [
  { name: "npm run test", args: ["run", "test"], timeoutMs: 20 * 60 * 1000 },
  { name: "npm run lint", args: ["run", "lint"], timeoutMs: 10 * 60 * 1000 },
  {
    name: "npm run typescript",
    args: ["run", "typescript"],
    timeoutMs: 10 * 60 * 1000,
  },
];

async function runValidation(
  pi: ExtensionAPI,
  root: string,
  signal: AbortSignal | undefined,
  onProgress?: (commandName: string) => void
): Promise<ValidationResult> {
  const commands: ValidationCommandResult[] = [];

  for (const command of VALIDATION_COMMANDS) {
    onProgress?.(command.name);
    const started = Date.now();
    const result = await pi.exec("npm", ["--prefix", root, ...command.args], {
      signal,
      timeout: command.timeoutMs,
    });
    commands.push({
      name: command.name,
      args: command.args,
      exitCode: result.code,
      stdout: truncateTail(result.stdout || "", 20000),
      stderr: truncateTail(result.stderr || "", 20000),
      durationMs: Date.now() - started,
    });
  }

  return { ok: commands.every((command) => command.exitCode === 0), commands };
}

async function getUncommittedReviewFiles(
  pi: ExtensionAPI,
  root: string
): Promise<string[]> {
  const outputs = await Promise.all([
    git(pi, root, ["diff", "--name-only", "-z", "--cached", "--", "."]),
    git(pi, root, ["diff", "--name-only", "-z", "--", "."]),
    git(pi, root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ]),
  ]);

  const files = new Set<string>();
  for (const output of outputs) {
    for (const file of parseNulList(output)) {
      if (isReviewableCodePath(file)) files.add(file);
    }
  }
  return Array.from(files).sort();
}

async function getUncommittedReviewFileState(
  pi: ExtensionAPI,
  root: string
): Promise<Map<string, string>> {
  const files = await getUncommittedReviewFiles(pi, root);
  const state = new Map<string, string>();

  for (const file of files) {
    const hash = createHash("sha256");
    hash.update(
      await gitMaybe(pi, root, ["status", "--porcelain=v1", "--", file])
    );
    try {
      hash.update(await fs.readFile(path.join(root, file)));
    } catch {
      hash.update("<missing>");
    }
    state.set(file, hash.digest("hex"));
  }

  return state;
}

async function getChangedUncommittedReviewFilesSince(
  pi: ExtensionAPI,
  root: string,
  beforeState: Map<string, string>
): Promise<string[]> {
  const afterState = await getUncommittedReviewFileState(pi, root);
  const changed: string[] = [];

  for (const [file, fingerprint] of afterState) {
    if (beforeState.get(file) !== fingerprint) changed.push(file);
  }

  return changed.sort();
}

async function commitReviewChanges(
  pi: ExtensionAPI,
  root: string,
  level: ThinkingLevel,
  pass: number,
  files: string[]
): Promise<string | undefined> {
  const reviewFiles = Array.from(
    new Set(files.filter(isReviewableCodePath))
  ).sort();
  if (reviewFiles.length === 0) return undefined;

  await git(pi, root, ["add", "-A", "--", ...reviewFiles]);

  const diffCheck = await pi.exec("git", [
    "-C",
    root,
    "diff",
    "--cached",
    "--quiet",
    "--",
    ...reviewFiles,
  ]);
  if (diffCheck.code === 0) return undefined;
  if (diffCheck.code !== 1) {
    const message = (
      diffCheck.stderr ||
      diffCheck.stdout ||
      "git diff --cached --quiet failed"
    ).trim();
    throw new Error(`Unable to inspect staged review changes: ${message}`);
  }

  const message = `wip: review fixes (${level} pass ${pass})`;
  const commit = await pi.exec("git", [
    "-C",
    root,
    "commit",
    "-m",
    message,
    "--",
    ...reviewFiles,
  ]);
  if (commit.code !== 0) {
    const errorMessage = (
      commit.stderr ||
      commit.stdout ||
      "git commit failed"
    ).trim();
    throw new Error(`Unable to create ${message} commit: ${errorMessage}`);
  }

  return (await git(pi, root, ["rev-parse", "--short", "HEAD"])).trim();
}

function formatValidationSummary(
  validation: ValidationResult | undefined
): string {
  if (!validation) return "validation not run";
  const parts = validation.commands.map(
    (command) =>
      `${command.name.replace(/^npm run /, "")}:${
        command.exitCode === 0 ? "ok" : `failed(${command.exitCode})`
      }`
  );
  return `validation ${validation.ok ? "ok" : "failed"} [${parts.join(", ")}]`;
}

function formatValidationFailure(validation: ValidationResult): string {
  const lines = ["Mandatory validation failed:"];
  for (const command of validation.commands) {
    lines.push(
      "",
      `$ ${command.name}`,
      `exit ${command.exitCode} after ${formatDuration(command.durationMs)}`
    );
    if (command.exitCode === 0) {
      lines.push("passed");
      continue;
    }
    const output = [command.stdout, command.stderr]
      .filter((text) => text.trim())
      .join("\n");
    lines.push(output ? truncateTail(output, 6000) : "(no output)");
  }
  return lines.join("\n");
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function truncateTail(text: string, maxChars = 6000): string {
  if (text.length <= maxChars) return text;
  return `[truncated ${text.length - maxChars} chars]\n${text.slice(
    -maxChars
  )}`;
}

function currentModelPattern(ctx: any): string | undefined {
  const model = ctx.model;
  if (!model || typeof model.id !== "string") return undefined;
  return typeof model.provider === "string" && model.provider
    ? `${model.provider}/${model.id}`
    : model.id;
}

function formatSummary(input: {
  success: boolean;
  base: string;
  branch: string;
  root: string;
  runs: RecordedPass[];
  message: string;
  lastOutput?: string;
  stderr?: string;
}): string {
  const lines = [
    input.success
      ? "Review loop completed successfully."
      : "Review loop stopped before completion.",
    input.message,
    "",
    `Base: ${input.base}`,
    `Branch: ${input.branch}`,
    `Root: ${input.root}`,
    "",
    "Passes:",
  ];

  if (input.runs.length === 0) lines.push("- none");
  for (const run of input.runs) {
    const icon =
      run.effectiveStatus === "CLEAN"
        ? "✓"
        : run.effectiveStatus === "FIXED"
        ? "↻"
        : "!";
    const changed = run.workingTreeChanged ? ", tree changed" : "";
    const committed = run.commitHash ? `, committed ${run.commitHash}` : "";
    const validation = `, ${formatValidationSummary(run.validation)}`;
    const cost = run.usage.cost ? `, $${run.usage.cost.toFixed(4)}` : "";
    lines.push(
      `- ${icon} ${run.level} pass ${run.pass}: ${
        run.effectiveStatus
      } (${formatDuration(
        run.durationMs
      )}${changed}${committed}${validation}${cost})`
    );
  }

  const lastValidationFailure = [...input.runs]
    .reverse()
    .find((run) => run.validation && !run.validation.ok)?.validation;
  if (lastValidationFailure) {
    lines.push(
      "",
      "Last validation failure:",
      truncateTail(formatValidationFailure(lastValidationFailure), 6000)
    );
  }

  if (input.lastOutput?.trim()) {
    lines.push("", "Last child output:", truncateTail(input.lastOutput.trim()));
  }
  if (input.stderr?.trim()) {
    lines.push("", "Child stderr:", truncateTail(input.stderr.trim(), 3000));
  }

  return lines.join("\n");
}

function updateUi(ctx: any, lines: string[]): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget("review-loop", lines);
  ctx.ui.setStatus("review-loop", lines[0]);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("review-loop", {
    description:
      "Review/fix against master in clean-context passes, verify npm checks, and WIP-commit fixes",
    handler: async (args, ctx) => {
      const parsed = parseArgs(args);
      if ("help" in parsed) {
        ctx.ui.notify(usage(), "info");
        return;
      }

      const options = parsed;
      const runs: RecordedPass[] = [];
      let root = ctx.cwd;
      let branch = "unknown";

      try {
        await ctx.waitForIdle();

        root = (
          await git(pi, ctx.cwd, ["rev-parse", "--show-toplevel"])
        ).trim();
        await git(pi, root, [
          "rev-parse",
          "--verify",
          `${options.base}^{commit}`,
        ]);
        branch = (
          await git(pi, root, ["rev-parse", "--abbrev-ref", "HEAD"])
        ).trim();

        const model = options.model ?? currentModelPattern(ctx);
        const initialFiles = await getChangedReviewFiles(
          pi,
          root,
          options.base
        );
        if (initialFiles.length === 0) {
          const summary = formatSummary({
            success: true,
            base: options.base,
            branch,
            root,
            runs,
            message:
              "No reviewable code/configuration changes were detected. Excluded idea.md, implementation.md, and .idea/**.",
          });
          pi.sendMessage({
            customType: "review-loop",
            content: summary,
            display: true,
          });
          return;
        }

        for (const level of options.levels) {
          let levelClean = false;
          let validationFailure: string | undefined;

          for (let pass = 1; pass <= options.maxPassesPerLevel; pass++) {
            const changedFiles = await getChangedReviewFiles(
              pi,
              root,
              options.base
            );
            updateUi(ctx, [
              `review-loop: ${level} pass ${pass}`,
              `base: ${options.base}`,
              `files: ${changedFiles.length}`,
              "starting child review agent...",
            ]);

            const prompt = buildReviewPrompt({
              base: options.base,
              branch,
              root,
              level,
              pass,
              changedFiles,
              validationFailure,
            });
            const beforeReviewState = await getUncommittedReviewFileState(
              pi,
              root
            );
            const beforeFingerprint = await getWorkingTreeFingerprint(pi, root);
            let progress = "running";
            const result = await runReviewPass({
              root,
              prompt,
              level,
              model,
              noChildExtensions: options.noChildExtensions,
              signal: ctx.signal,
              onProgress: (message) => {
                progress = message;
                updateUi(ctx, [
                  `review-loop: ${level} pass ${pass}`,
                  `base: ${options.base}`,
                  `files: ${changedFiles.length}`,
                  progress,
                ]);
              },
            });
            const afterFingerprint = await getWorkingTreeFingerprint(pi, root);
            const workingTreeChanged = beforeFingerprint !== afterFingerprint;
            let effectiveStatus =
              result.status === "CLEAN" && workingTreeChanged
                ? "FIXED"
                : result.status;
            let validation: ValidationResult | undefined;
            let commitHash: string | undefined;

            if (result.exitCode === 0) {
              updateUi(ctx, [
                `review-loop: ${level} pass ${pass}`,
                `base: ${options.base}`,
                `files: ${changedFiles.length}`,
                "running mandatory validation...",
              ]);
              validation = await runValidation(
                pi,
                root,
                ctx.signal,
                (commandName) => {
                  updateUi(ctx, [
                    `review-loop: ${level} pass ${pass}`,
                    `base: ${options.base}`,
                    `files: ${changedFiles.length}`,
                    `validation: ${commandName}`,
                  ]);
                }
              );

              if (!validation.ok) {
                validationFailure = formatValidationFailure(validation);
                if (effectiveStatus === "CLEAN") effectiveStatus = "FIXED";
              } else {
                validationFailure = undefined;
              }
            }

            const changedReviewFiles =
              await getChangedUncommittedReviewFilesSince(
                pi,
                root,
                beforeReviewState
              );
            if (changedReviewFiles.length > 0 && effectiveStatus === "CLEAN")
              effectiveStatus = "FIXED";
            const statusAllowsCommit =
              effectiveStatus !== "BLOCKED" && effectiveStatus !== "UNKNOWN";
            if (
              result.exitCode === 0 &&
              validation?.ok &&
              changedReviewFiles.length > 0 &&
              statusAllowsCommit
            ) {
              updateUi(ctx, [
                `review-loop: ${level} pass ${pass}`,
                `base: ${options.base}`,
                `files: ${changedFiles.length}`,
                "creating wip commit...",
              ]);
              commitHash = await commitReviewChanges(
                pi,
                root,
                level,
                pass,
                changedReviewFiles
              );
              const remainingReviewFiles =
                await getChangedUncommittedReviewFilesSince(
                  pi,
                  root,
                  beforeReviewState
                );
              if (remainingReviewFiles.length > 0) {
                throw new Error(
                  `Review pass left uncommitted reviewable files after WIP commit: ${remainingReviewFiles.join(
                    ", "
                  )}`
                );
              }
            }

            runs.push({
              ...result,
              level,
              pass,
              effectiveStatus,
              workingTreeChanged,
              validation,
              commitHash,
            });

            if (ctx.hasUI) {
              const validationText = validation
                ? validation.ok
                  ? "validation ok"
                  : "validation failed"
                : "validation skipped";
              const commitText = commitHash ? `, committed ${commitHash}` : "";
              ctx.ui.notify(
                `${level} pass ${pass}: ${effectiveStatus}, ${validationText}${commitText}`,
                effectiveStatus === "CLEAN" && validation?.ok
                  ? "info"
                  : "warning"
              );
            }

            if (result.exitCode !== 0) {
              const summary = formatSummary({
                success: false,
                base: options.base,
                branch,
                root,
                runs,
                message: `Child review agent exited with code ${result.exitCode}.`,
                lastOutput: result.output,
                stderr: result.stderr,
              });
              pi.sendMessage({
                customType: "review-loop",
                content: summary,
                display: true,
              });
              return;
            }

            if (
              effectiveStatus === "BLOCKED" ||
              effectiveStatus === "UNKNOWN"
            ) {
              const summary = formatSummary({
                success: false,
                base: options.base,
                branch,
                root,
                runs,
                message:
                  effectiveStatus === "BLOCKED"
                    ? "A child review agent found an issue it could not safely fix."
                    : "Could not determine child review status. Ensure the final marker is present.",
                lastOutput: result.output,
                stderr: result.stderr,
              });
              pi.sendMessage({
                customType: "review-loop",
                content: summary,
                display: true,
              });
              return;
            }

            if (validation && !validation.ok) {
              continue;
            }

            if (effectiveStatus === "CLEAN") {
              levelClean = true;
              break;
            }
          }

          if (!levelClean) {
            const summary = formatSummary({
              success: false,
              base: options.base,
              branch,
              root,
              runs,
              message: `Reached --max-passes (${options.maxPassesPerLevel}) at thinking level ${level} before a clean pass with passing validation.`,
              lastOutput: runs[runs.length - 1]?.output,
              stderr: runs[runs.length - 1]?.stderr,
            });
            pi.sendMessage({
              customType: "review-loop",
              content: summary,
              display: true,
            });
            return;
          }
        }

        const summary = formatSummary({
          success: true,
          base: options.base,
          branch,
          root,
          runs,
          message: `Clean review reached at final configured thinking level (${
            options.levels[options.levels.length - 1]
          }).`,
        });
        pi.sendMessage({
          customType: "review-loop",
          content: summary,
          display: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const summary = formatSummary({
          success: false,
          base: options.base,
          branch,
          root,
          runs,
          message,
        });
        pi.sendMessage({
          customType: "review-loop",
          content: summary,
          display: true,
        });
        if (ctx.hasUI) ctx.ui.notify(`review-loop failed: ${message}`, "error");
      } finally {
        if (ctx.hasUI) {
          ctx.ui.setWidget("review-loop", undefined);
          ctx.ui.setStatus("review-loop", undefined);
        }
      }
    },
  });
}
