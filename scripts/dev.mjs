import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const children = [];

function killChildren() {
  for (const c of children) {
    try {
      c.kill();
    } catch {
      // ignore
    }
  }
}

function cleanup() {
  killChildren();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", killChildren);

function run(command, args, extra = {}) {
  const { env: envExtra, ...rest } = extra;
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: envExtra ? { ...process.env, ...envExtra } : process.env,
    ...rest,
  });
  children.push(child);
  return child;
}

/** Wait for Vite on 5174 first, then scan upward (matches --strictPort false fallback). */
function waitForViteDevServer(timeoutMs) {
  const minPort = 5174;
  const maxPort = 5220;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const checkPort = (port) =>
      new Promise((res, rej) => {
        const req = http.get(`http://localhost:${port}/`, (resHttp) => {
          resHttp.resume();
          if (
            resHttp.statusCode &&
            resHttp.statusCode >= 200 &&
            resHttp.statusCode < 500
          ) {
            res(port);
          } else {
            rej();
          }
        });
        req.on("error", () => rej());
      });

    const poll = async () => {
      for (let port = minPort; port <= maxPort; port++) {
        try {
          const p = await checkPort(port);
          resolve(`http://localhost:${p}`);
          return;
        } catch {
          // try next port
        }
      }
      if (Date.now() - started > timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for Vite (tried ports ${minPort}-${maxPort})`,
          ),
        );
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.main.json"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

if (compile.status !== 0) {
  process.exit(compile.status ?? 1);
}

const bundlePreload = spawnSync(
  "npx",
  [
    "esbuild",
    "src/main/preload.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    "--external:electron",
    "--outfile=dist/main/preload.js",
  ],
  { cwd: root, stdio: "inherit", shell: true, env: process.env },
);
if (bundlePreload.status !== 0) {
  process.exit(bundlePreload.status ?? 1);
}

const tscWatch = run("npx", ["tsc", "-p", "tsconfig.main.json", "--watch"]);
const preloadWatch = run("npx", [
  "esbuild",
  "src/main/preload.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  "--external:electron",
  "--outfile=dist/main/preload.js",
  "--watch",
]);
const vite = run("npx", [
  "vite",
  "--port",
  "5174",
  "--strictPort",
  "false",
]);

waitForViteDevServer(60_000)
  .then((viteUrl) => {
    const electron = run("npx", ["electron", "."], {
      env: {
        ...process.env,
        SPIRE_VITE_DEV_SERVER_URL: viteUrl,
      },
    });

    electron.on("close", () => {
      cleanup();
    });
  })
  .catch((err) => {
    console.error(err);
    killChildren();
    process.exit(1);
  });
