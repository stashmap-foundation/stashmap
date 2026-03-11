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

const { runCli } = nodeRequire("./main") as typeof import("./main");

runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
  process.exit(1);
});
