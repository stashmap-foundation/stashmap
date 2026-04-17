const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const webpackCliPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "webpack-cli",
  "bin",
  "cli.js"
);

const child = spawn(
  process.execPath,
  [webpackCliPath, "--config", "config/webpack/production.config.js"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      WEBPACK_PUBLIC_PATH: "./",
    },
  }
);

function rewriteDesktopHtml() {
  const indexPath = path.join(__dirname, "..", "build", "index.html");
  const content = fs.readFileSync(indexPath, "utf8");
  const rewritten = content
    .replace('href="/favicon.ico"', 'href="./favicon.ico"')
    .replace('href="/manifest.json"', 'href="./manifest.json"');
  fs.writeFileSync(indexPath, rewritten, "utf8");
}

child.on("exit", (code) => {
  if ((code ?? 0) === 0) {
    rewriteDesktopHtml();
  }
  process.exit(code ?? 0);
});
