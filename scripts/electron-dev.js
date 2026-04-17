const { spawn } = require("child_process");
const path = require("path");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const electronBinary = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron"
);
const electronMain = path.join(__dirname, "..", "electron", "main.js");
const devServerUrl = "http://127.0.0.1:4000";

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForDevServer(retries = 120) {
  const attempt = async (remaining) => {
    if (remaining <= 0) {
      throw new Error(`Timed out waiting for ${devServerUrl}`);
    }
    try {
      const response = await fetch(devServerUrl);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(500);
      return attempt(remaining - 1);
    }
    await delay(500);
    return attempt(remaining - 1);
  };
  return attempt(retries);
}

function terminate(child) {
  if (!child || child.killed) {
    return;
  }
  child.kill("SIGTERM");
}

const devServer = spawn(npmCommand, ["run", "start"], {
  stdio: "inherit",
  env: process.env,
});

const shutdown = () => {
  terminate(devServer);
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

waitForDevServer()
  .then(() => {
    const electron = spawn(electronBinary, [electronMain], {
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_START_URL: devServerUrl,
      },
    });

    electron.on("exit", (code) => {
      shutdown();
      process.exit(code ?? 0);
    });
  })
  .catch((error) => {
    shutdown();
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
