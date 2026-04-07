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

const { formatCliError } = nodeRequire("./output") as typeof import("./output");
const { runCli } = nodeRequire("./main") as typeof import("./main");

runCli(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(formatCliError(error));
  process.exit(1);
});
