import { text as readStreamText } from "stream/consumers";
import { loadCliProfile } from "./config";
import { requireValue } from "./args";
import { WriteCreateRootCliArgs } from "./types";
import { writeCreateRoot } from "../core/writeCreateRoot";

async function readStdin(): Promise<string> {
  return readStreamText(process.stdin);
}

export function parseWriteCreateRootArgs(
  args: string[]
): WriteCreateRootCliArgs {
  const parse = (
    index: number,
    current: WriteCreateRootCliArgs
  ): WriteCreateRootCliArgs => {
    const arg = args[index];
    if (!arg) {
      return current;
    }

    switch (arg) {
      case "--help":
      case "-h":
        return parse(index + 1, {
          ...current,
          help: true,
        });
      case "--config":
        return parse(index + 2, {
          ...current,
          configPath: requireValue(args, index, "--config"),
        });
      case "--relay":
        return parse(index + 2, {
          ...current,
          relayUrls: [
            ...current.relayUrls,
            requireValue(args, index, "--relay"),
          ],
        });
      case "--title":
        return parse(index + 2, {
          ...current,
          title: requireValue(args, index, "--title"),
        });
      case "--file":
        return parse(index + 2, {
          ...current,
          filePath: requireValue(args, index, "--file"),
        });
      case "--stdin":
        return parse(index + 1, {
          ...current,
          stdin: true,
        });
      case "--include-markdown":
        return parse(index + 1, {
          ...current,
          includeMarkdown: true,
        });
      default:
        throw new Error(`Unknown write create-root argument: ${arg}`);
    }
  };

  return parse(0, {
    relayUrls: [],
    help: false,
  });
}

export function writeCreateRootHelp(): string {
  return [
    "Usage: knowstr write create-root (--title <text> | --file <path> | --stdin) [--config <path>] [--relay <url> ...] [--include-markdown]",
    "",
    "Creates a new standalone Knowstr root locally, updates the workspace immediately, and queues it for `knowstr push`.",
  ].join("\n");
}

export async function runWriteCreateRootCommand(
  args: string[]
): Promise<
  { help: true; text: string } | Awaited<ReturnType<typeof writeCreateRoot>>
> {
  const parsed = parseWriteCreateRootArgs(args);
  if (parsed.help) {
    return {
      help: true,
      text: writeCreateRootHelp(),
    };
  }
  if (
    (parsed.title ? 1 : 0) +
      (parsed.filePath ? 1 : 0) +
      (parsed.stdin ? 1 : 0) !==
    1
  ) {
    throw new Error("Provide exactly one of --title, --file, or --stdin");
  }

  const profile = loadCliProfile({ configPath: parsed.configPath });
  const markdownText = parsed.stdin ? await readStdin() : undefined;
  const result = await writeCreateRoot(profile, {
    title: parsed.title,
    filePath: parsed.filePath,
    markdownText,
    relayUrls: parsed.relayUrls,
    includeMarkdown: parsed.includeMarkdown,
  });
  return result;
}
