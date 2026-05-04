import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

function run(command, args, extra = {}) {
  const { env: envExtra, ...rest } = extra;
  return spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: envExtra ? { ...process.env, ...envExtra } : process.env,
    ...rest,
  });
}

function waitForHttpOk(url, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", () => retry());
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
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

const tscWatch = run("npx", ["tsc", "-p", "tsconfig.main.json", "--watch"]);
const vite = run("npx", ["vite"]);

waitForHttpOk("http://localhost:5173/", 60_000)
  .then(() => {
    const electron = run("npx", ["electron", "."], {
      env: {
        ...process.env,
        SPIRE_VITE_DEV_SERVER_URL: "http://localhost:5173",
      },
    });

    const shutdown = () => {
      electron.kill();
      vite.kill();
      tscWatch.kill();
    };

    electron.on("exit", (code) => {
      shutdown();
      process.exit(code ?? 0);
    });

    process.on("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      shutdown();
      process.exit(0);
    });
  })
  .catch((err) => {
    console.error(err);
    vite.kill();
    tscWatch.kill();
    process.exit(1);
  });
