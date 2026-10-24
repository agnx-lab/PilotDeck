# PilotDeck · Agnx Web Guest wrap

> 上游仓库：https://github.com/OpenBMB/PilotDeck

- **appId:** `pilotdeck`
- **guest:** `kind=web`, `auth=none`（上游默认 `PILOTDECK_DISABLE_LOCAL_AUTH` 关本地登录）
- **sidecar:** supervised `ensure-pilotdeck.mjs` → `launch-pilotdeck.mjs` → `ui/server/webRuntimeSupervisor.js`
- **默认端口:** Web `3011`（避 open-seo `3001`）、Gateway `18791`、Vite(dev) `5311`
- **数据:** `PILOT_HOME` = Agnx work-dir 下 `pilot-home/`（默认 `~/.agnx-dev/apps/data/pilotdeck/pilot-home`）

## 验收

1. 重扫子应用 / 重启 Agnx 后打开 Tab「PilotDeck」
2. 或手测：`node .agnx/tools/ensure-pilotdeck.mjs --supervised --work-dir ~/.agnx-dev/apps/data/pilotdeck --port 3011`
3. 健康：`curl -s http://127.0.0.1:3011/health` → `{"status":"ok",...}`

## 可选

- 需要 computer-use 驱动时：`PILOTDECK_AGNX_PREPARE_COMPUTER_USE=1`（会从 GitHub 下载，可能很慢）
- 若无 `ui/dist`：ensure 会退回 `dev`（Vite）；完整 Tab 建议 `pnpm --dir ui run build`

## Glue 注意

- `panel.tsx` 的 `ensureArgs` 须显式带 `--supervised`（与 anatomy/ekko/snow 一致）；仅 `--port` 时宿主不会注入，会得到 `GUEST_ENSURE_FAILED`。
- 若 Tab iframe 已指向 `http://127.0.0.1:3011/` 但页空白：检查 sidecar 是否在听（`curl -s http://127.0.0.1:3011/health`）；必要时手动：`node .agnx/tools/launch-pilotdeck.mjs start-built`（env: `SERVER_PORT=3011` `PILOT_HOME=.../apps/data/pilotdeck/pilot-home`）。

## Agnx instance mark

`ui/server/index.js` `/health` 在存在 `AGNX_SIDECAR_INSTANCE` 时回声为 `instanceId`（保留 `serverInstanceId` 给 PilotDeck 自身重启）。否则 daemon `waitForSidecarReady` 会因自有 UUID ≠ 注入标记而一直 mismatch，冷启动无 `spawn.ok`。

## Daemon manifest 路径

daemon `ensureLoopbackSidecarFromToolRun` 读的是 **`appDirPath/manifest.json`**（projectRoot），不是 `.agnx/manifest.json`。
缺根目录 `manifest.json` 时会 `delegateToScript`：ensure 只吐 plan+origin，宿主 mount.ok，但 **不会 spawn**，3011 不起。
本仓用 `manifest.json` → `.agnx/manifest.json` 符号链接（与 deepseek-harness/snow-app 一致）。

## Agnx embed env（必设）

ensure `planEnv` 注入：
- `PILOTDECK_SKIP_BROWSER_OPEN=1` — 关掉 ui/server ready 时的 `open`/`xdg-open` 外开
- `PILOTDECK_GATEWAY_URL=ws://127.0.0.1:<gatewayPort>/ws` — 与 `PILOTDECK_GATEWAY_PORT` 对齐（bridge 默认 18789，只设 PORT 会连错口 → projects 永久 loading）
