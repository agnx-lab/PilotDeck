#!/usr/bin/env node
/**
 * 场景：daemon 拉起的 PilotDeck sidecar 入口 — 可选 prepare 后交给 webRuntimeSupervisor。
 * 用法：node .agnx/tools/launch-pilotdeck.mjs <dev|start-built>
 *
 * AGNX 嵌页默认跳过 computer-use 驱动下载（会卡 GitHub）；需要时设
 * PILOTDECK_AGNX_PREPARE_COMPUTER_USE=1。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const uiRoot = path.join(repoRoot, "ui");
const mode = process.argv[2] === "dev" ? "dev" : "start-built";
const prepare = path.join(repoRoot, "scripts", "prepare-computer-use.mjs");
const supervisor = path.join(uiRoot, "server", "webRuntimeSupervisor.js");

if (!existsSync(supervisor)) {
  console.error(`[launch-pilotdeck] missing ${supervisor}`);
  process.exit(1);
}

const wantPrepare =
  process.env.PILOTDECK_AGNX_PREPARE_COMPUTER_USE === "1" ||
  process.env.PILOTDECK_AGNX_PREPARE_COMPUTER_USE === "true";

if (wantPrepare && existsSync(prepare)) {
  const prep = spawnSync(process.execPath, [prepare], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (prep.status !== 0) {
    console.error("[launch-pilotdeck] prepare-computer-use failed (continuing)");
  }
}

const require = createRequire(path.join(uiRoot, "package.json"));
try {
  require.resolve("tsx/package.json");
} catch {
  try {
    createRequire(path.join(repoRoot, "package.json")).resolve("tsx/package.json");
  } catch {
    console.error("[launch-pilotdeck] tsx not found; run pnpm install in PilotDeck root");
    process.exit(1);
  }
}

const child = spawnSync(process.execPath, [supervisor, mode], {
  cwd: uiRoot,
  env: process.env,
  stdio: "inherit",
});
process.exit(child.status == null ? 1 : child.status);
