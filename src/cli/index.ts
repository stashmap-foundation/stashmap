#!/usr/bin/env node
type CssIgnoringRequire = NodeJS.Require & {
  extensions?: Record<
    string,
    (module: NodeJS.Module, filename: string) => void
  >;
};

const nodeRequire = require as CssIgnoringRequire;

if (nodeRequire.extensions && !nodeRequire.extensions[".css"]) {
  // eslint-disable-next-line functional/immutable-data
  nodeRequire.extensions[".css"] = () => undefined;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const { formatCliError } = require("./output") as typeof import("./output");
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const { runCli } = require("./main") as typeof import("./main");

runCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(formatCliError(error));
  process.exit(1);
});
