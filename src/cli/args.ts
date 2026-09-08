export function requireValue(
  args: string[],
  index: number,
  flag: string
): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export type ConfigCliArgs = {
  configPath?: string;
  help: boolean;
};

export function parseConfigArgs(
  command: string,
  args: string[]
): ConfigCliArgs {
  const parse = (index: number, current: ConfigCliArgs): ConfigCliArgs => {
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
      default:
        throw new Error(`Unknown ${command} argument: ${arg}`);
    }
  };

  return parse(0, { help: false });
}
