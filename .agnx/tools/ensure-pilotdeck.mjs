#!/usr/bin/env node
/**
 * 场景：受管启动 PilotDeck Web UI — loopback SERVER_PORT，guest.auth=none（默认关本地登录）。
 * 用法：node .agnx/tools/ensure-pilotdeck.mjs [--work-dir <dataRoot>] [--port 3011]
 *       [--gateway-port 18791] [--supervised] [--force-restart]
 * stdout：一行 JSON。--supervised 且需新进程时带 plan，由 daemon 拉起。
 */
import { access, constants as fsConstants, mkdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const launchScript = path.join(__dirname, "launch-pilotdeck.mjs");
const defaultPort = 3011;
const defaultGatewayPort = 18791;
const defaultVitePort = 5311;

function emit(payload) {
  console.log(JSON.stringify(payload));
}

function parseArgs(argv) {
  let workDir = process.env.AGNX_APP_DATA_ROOT || "";
  let port = defaultPort;
  let gatewayPort = defaultGatewayPort;
  let vitePort = defaultVitePort;
  let forceRestart = false;
  let supervised = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--work-dir" || arg === "--workDir") && next) {
      workDir = String(next).trim();
      i += 1;
    } else if (arg === "--port" && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) port = Math.floor(n);
      i += 1;
    } else if ((arg === "--gateway-port" || arg === "--gatewayPort") && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) gatewayPort = Math.floor(n);
      i += 1;
    } else if ((arg === "--vite-port" || arg === "--vitePort") && next) {
      const n = Number(next);
      if (Number.isFinite(n) && n > 0) vitePort = Math.floor(n);
      i += 1;
    } else if (arg === "--force-restart" || arg === "--forceRestart") {
      forceRestart = true;
    } else if (arg === "--supervised") {
      supervised = true;
    }
  }
  const fallback = path.join(
    process.env.AGNX_HOME || path.join(process.env.HOME || "", ".agnx-dev"),
    "apps",
    "data",
    "pilotdeck",
  );
  return {
    workDir: workDir || fallback,
    port,
    gatewayPort,
    vitePort,
    forceRestart,
    supervised,
  };
}

async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseNodeVersion(versionRaw) {
  const m = String(versionRaw).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function isNode22Ok(v) {
  if (!v) return false;
  if (v.major !== 22) return false;
  if (v.minor > 13) return true;
  if (v.minor === 13) return true; // >=22.13.0
  return false;
}

function findNode22() {
  const candidates = [];
  const which = process.env.PATH || "";
  for (const dir of which.split(path.delimiter)) {
    if (!dir) continue;
    candidates.push(path.join(dir, "node"));
  }
  // Prefer known nvm 22 if present
  const nvmRoot = path.join(process.env.HOME || "", ".nvm", "versions", "node");
  if (existsSync(nvmRoot)) {
    try {
      for (const name of readdirSyncSafe(nvmRoot)) {
        if (name.startsWith("v22.")) {
          candidates.unshift(path.join(nvmRoot, name, "bin", "node"));
        }
      }
    } catch {
      /* ignore */
    }
  }
  candidates.unshift(process.execPath);

  const seen = new Set();
  for (const bin of candidates) {
    if (!bin || seen.has(bin) || !existsSync(bin)) continue;
    seen.add(bin);
    try {
      const out = execFileSync(bin, ["-p", "process.version"], {
        encoding: "utf8",
        timeout: 4000,
      }).trim();
      const v = parseNodeVersion(out);
      if (isNode22Ok(v) && v.major < 23) {
        return { bin, version: out };
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function readdirSyncSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 4000) res.destroy();
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function isHealthy(body) {
  return Boolean(body && typeof body === "object" && body.status === "ok");
}

function fingerprint(cfg, mode, nodeBin) {
  return JSON.stringify({
    repoRoot,
    port: cfg.port,
    gatewayPort: cfg.gatewayPort,
    gatewayUrl: `ws://127.0.0.1:${cfg.gatewayPort}/ws`,
    skipBrowserOpen: true,
    vitePort: cfg.vitePort,
    mode,
    nodeBin,
  });
}

function resolveMode() {
  const uiDist = path.join(repoRoot, "ui", "dist", "index.html");
  if (existsSync(uiDist)) return "start-built";
  return "dev";
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  const warnings = [];
  await mkdir(cfg.workDir, { recursive: true });
  const pilotHome = path.join(cfg.workDir, "pilot-home");
  await mkdir(pilotHome, { recursive: true });

  const origin = `http://127.0.0.1:${cfg.port}`;
  const healthUrl = `${origin}/health`;

  const node = findNode22();
  if (!node) {
    emit({
      ok: false,
      error:
        "未找到 Node.js ≥22.13 <23。请用 nvm/fnm 安装 Node 22 后再打开 PilotDeck。",
      warnings,
    });
    process.exitCode = 1;
    return;
  }

  if (!(await pathExists(path.join(repoRoot, "node_modules")))) {
    emit({
      ok: false,
      error:
        "未安装依赖。在 ~/.agnx-dev/apps/pilotdeck 执行：pnpm install（需 Node ≥22.13 <23）",
      warnings,
      repoRoot,
    });
    process.exitCode = 1;
    return;
  }

  if (!(await pathExists(path.join(repoRoot, "ui", "node_modules"))) &&
      !(await pathExists(path.join(repoRoot, "node_modules", "vite")))) {
    warnings.push("ui/node_modules 可能未装齐；若启动失败请在仓根再跑 pnpm install");
  }

  const mode = resolveMode();
  if (mode === "dev") {
    warnings.push(
      "未找到 ui/dist（生产前端）。将以 webRuntimeSupervisor dev 启动（含 Vite）；完整 Tab 建议先：pnpm --dir ui run build",
    );
  }

  if (!cfg.forceRestart) {
    const body = await httpGetJson(healthUrl);
    if (isHealthy(body)) {
      emit({
        ok: true,
        reused: true,
        origin,
        port: cfg.port,
        mode,
        warnings,
        healthUrl,
        fingerprint: fingerprint(cfg, mode, node.bin),
      });
      return;
    }
  }

  if (!cfg.supervised) {
    const body = await httpGetJson(healthUrl);
    if (isHealthy(body)) {
      emit({
        ok: true,
        reused: true,
        origin,
        port: cfg.port,
        mode,
        warnings,
        healthUrl,
      });
      return;
    }
    emit({
      ok: false,
      error: "PilotDeck ensure 只交给宿主以 --supervised 拉起，脚本自己不启动进程。",
      warnings,
    });
    process.exitCode = 1;
    return;
  }

  if (!(await pathExists(launchScript))) {
    emit({ ok: false, error: `找不到启动器 ${launchScript}`, warnings });
    process.exitCode = 1;
    return;
  }

  const wantedFp = fingerprint(cfg, mode, node.bin);
  const gatewayUrl = `ws://127.0.0.1:${cfg.gatewayPort}/ws`;
  const planEnv = {
    HOST: "127.0.0.1",
    SERVER_PORT: String(cfg.port),
    VITE_PORT: String(cfg.vitePort),
    PILOTDECK_GATEWAY_PORT: String(cfg.gatewayPort),
    // bridge 只认 PILOTDECK_GATEWAY_URL（默认 18789）；必须与 GATEWAY_PORT 对齐，否则 /api/projects 永久 503
    PILOTDECK_GATEWAY_URL: gatewayUrl,
    // Agnx 内嵌 Tab：禁止 ui/server ready 后 `open`/`xdg-open` 外开系统浏览器
    PILOTDECK_SKIP_BROWSER_OPEN: "1",
    PILOT_HOME: pilotHome,
    // 默认关本地登录（与上游 constants 一致）；显式写出便于排查
    // 不设 PILOTDECK_DISABLE_LOCAL_AUTH=0 → DISABLE_LOCAL_AUTH=true → guest.auth=none
    PATH: `${path.dirname(node.bin)}:${process.env.PATH || ""}`,
  };

  emit({
    ok: true,
    reused: false,
    origin,
    port: cfg.port,
    mode,
    warnings,
    healthUrl,
    repoRoot,
    fingerprint: wantedFp,
    plan: {
      command: node.bin,
      args: [launchScript, mode],
      cwd: repoRoot,
      env: planEnv,
      fingerprint: wantedFp,
      healthUrl,
      port: cfg.port,
      launchMode: mode === "start-built" ? "packaged" : "dev",
    },
  });
}

main().catch((error) => {
  emit({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});
