import { loadCliProfile } from "./config";
import { parseConfigArgs } from "./args";
import { saveEditedWorkspaceDocuments } from "../infra/filesystem/workspaceSave";

export function saveHelp(): string {
  return [
    "Usage: knowstr save [--config <path>]",
    "",
    "Runs local integrity checks and assigns IDs without publishing.",
    "",
    "Ignoring files:",
    "  Place a .knowstrignore file in the workspace root to exclude",
    "  files and directories. Uses gitignore syntax.",
    "",
    "  .git, .knowstr, and node_modules are always ignored.",
  ].join("\n");
}

export async function runSaveCommand(
  args: string[]
): Promise<
  { help: true; text: string } | { changed_paths: string[]; warnings: string[] }
> {
  const parsed = parseConfigArgs("save", args);
  if (parsed.help) {
    return {
      help: true,
      text: saveHelp(),
    };
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const saved = await saveEditedWorkspaceDocuments(profile);
  return { changed_paths: saved.changed_paths, warnings: saved.warnings };
}
