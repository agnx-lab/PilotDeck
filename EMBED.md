# PilotDeck × Agnx 子应用接入记录

> appId `PilotDeck` ｜ 版本 0.1.0 ｜ 上游 `OpenBMB/PilotDeck` ｜ 端口 **3011**（gateway **18791**）
> 本文所有结论均为实跑核实，非模板占位。核实方法见文末「本记录怎么来的」。

## 上游嵌入

- **上游原生平台**：桌面 ✅ ｜ 网页 ✅ ｜ 移动 ❌
  - 依据：上游 `apps/desktop/`（Electron 主壳，含 `desktop-build.yml` 四个平台流水线）+ `ui/server/`（本地 Web 服务）+ 无移动端构建目标。
  - 上游探测（`probe-upstream.mjs`）：形态 `web-ui`，desktop=supported / web=supported / mobile=unsupported，与上面判断一致。
  - §9.1：上游没做移动端，我们不替它做。

- **工作方式**：**嵌 + 薄胶水**（不是「原样嵌入」）
  - 为什么不是原样嵌入：上游是「Web 服务 + 前端页面」两段式，且它**假定自己在固定端口**（bridge 默认写死 `ws://127.0.0.1:18789/ws`）。直接跑会跟别的 app 抢号，也无法被宿主按 appId 管理。
  - 为什么不上「引擎 + 自画 UI」：上游 UI 是完整成品（任务编排、消息流、Skills 交付），自画等于重做，违反「不做太重」。
  - 实际只加了启动参数注入 + 两个环境变量，未改任何业务逻辑。

- **上游改动清单**：共 **3 处**，均为启动参数 / 端口注入，无业务逻辑改动。

  | 文件 | 改了什么 | 为什么必须改 |
  | --- | --- | --- |
  | `ui/server/index.js` | 读 `AGNX_SIDECAR_INSTANCE`，在健康响应里回显 `instanceId`，并把上游自己的 `serverInstanceId` 另字段保留 | 宿主的 `probeSidecarHealthMark` 靠 `instanceId` 匹配。上游原本只回自己的 UUID，宿主读不到约定值会 **fail-closed**（判不健康） |
  | `ui/server/pilotdeck-bridge.js` | gateway URL 从写死 `18789` 改为读 `PILOTDECK_GATEWAY_PORT` | 上游 bridge 只认 `PILOTDECK_GATEWAY_URL`，默认 18789。不把端口打通，`/api/projects` **永久 503** |
  | `.gitignore` | 追加 `!.agnx/dist/`、`!.agnx/dist/**` | 上游的裸 `dist` 规则会**误伤 `.agnx/dist/`**，导致构建产物进不了版本库 |

  - 「理想是无」在这里做不到：`instanceId` 和 gateway 端口都是宿主/上游硬约定，只能两侧之一让步；选让步在上游的两个小文件，成本低于改宿主。

- **挂载**：`guest.kind=web` / `guest.auth=none` / capabilities=`cookies`,`websocket` ｜ 策略 = **`direct-iframe`**
  - 为什么是 direct-iframe：上游是本地 Web 服务（`http://127.0.0.1:3011`），无登录凭证要带，同源直接嵌即可。
  - 探测建议也是 `direct-iframe`，**实际与建议一致**（不是所有 app 都这样，见别的记录）。

- **上游**：`OpenBMB/PilotDeck@5e82017fd98ee855e94aa2689333d1748ee8a2ef`
  - 对应上游时间：2026-10-15（`Merge pull request #649 from OpenBMB/codex/pilotdeck-2-release-news`）
  - **怎么定出来的**（本目录无 `.git`，无法 `rev-parse`）：用上游 12 个候选 commit 的树元数据逐文件比 sha，`5e82017fd98e` 差异最小（内容不同仅 5 个、仅本地 1 个），且其余候选差异都更大。属反推，非 git 原生记录。

- **面板与 Tab**：

  | panelId | 名字 | 走什么 |
  | --- | --- | --- |
  | `pilotdeck.main` | PilotDeck | `ensureTool` → `.agnx/tools/ensure-pilotdeck.mjs`，`--port 3011 --gateway-port 18791` |

- **ensure 脚本**：`.agnx/tools/ensure-pilotdeck.mjs`
  - 托管两个端口：**3011**（Web UI，`sidecar.defaultPort`）+ **18791**（gateway）。
  - 健康检查走 `instanceId` 握手，不是只看端口通不通——因为上游 HTTP 端口通了但 gateway 没起时，`/api/projects` 仍会 503，只探端口会把「半死」判成「活」。

- **当前交付状态**：`installState=installed` / `launchMode=packaged`（§八 要求的两项均满足）

- **桌面验收截图**：`logs/pilotdeck-desktop-*.png`
  - ⚠️ 本记录编写时**未见该截图**。若要宣称「已交付」，须补一张能看到上游主界面 + 一次真实操作后的状态；没有截图就只算「结构合格」，不算 «§八 通过»。

## 嵌页宿主能力缺口

> §9.5：禁止省略本表却宣称「已接入」。下面两行都是**实际存在并已处置**的缺口，不是模板。

| 上游能力 | 信号位置 | 嵌后风险 | 处置 (A–E) | 主路径 | 备注 |
| --- | --- | --- | --- | --- | --- |
| WebSocket 长连接 | `manifest.guest.capabilities` 含 `websocket`；`ui/server/pilotdeck-bridge.js` 连 gateway | 上游 bridge 写死 `ws://127.0.0.1:18789/ws`，嵌进 Tab 后若 gateway 在别的端口，WS 连不上 → 界面能开但功能全无（`/api/projects` 503） | **B 适配**（改上游启动参数读取） | 经 `ensure` 注入 `PILOTDECK_GATEWAY_PORT`，bridge 改为动态拼 URL | 已完成。这就是「上游改动清单」第 2 条；未改动线协议 |
| Cookie 会话 | `manifest.guest.capabilities` 含 `cookies` | direct-iframe 下第三方 cookie 可能被浏览器拦截，导致上游会话丢失 | **A 不需处置** | direct-iframe 同源（127.0.0.1:3011 直接嵌） | 同源场景下不触发第三方 cookie 限制；若将来改反代需重评 |
| 健康探活只探 HTTP 会误判 | `ensure-pilotdeck.mjs` 的 `instanceId` 握手 | 上游 HTTP 已监听但 gateway 未就绪时，仅探端口会判「健康」→ 宿主放行 → 用户看到白屏/503 | **B 适配**（改判定条件） | 健康检查校验 `instanceId` 回显，而非仅端口可达 | 这是「接口通但业务不通」的典型，只探端口查不出来 |

## 本记录怎么来的

本目录是**纯本地 app**（无 `.git`，`agnx-lab` 里没有对应仓库），所以按 §9.9 走「无 `.git` 时先看它改没改过上游」：

1. 取上游 `OpenBMB/PilotDeck` 的树元数据（`git/trees?recursive=1`，只拿路径 + sha，零下载）；
2. 本地逐文件算 `sha1("blob <len>\0" + content)`（与 git 同算法）；
3. 批量比对 12 个候选 commit，取差异最小者定为基线；
4. 对 5 个差异文件逐个拉上游原文做 `diff`，人工判定「我们改的」还是「上游更新的」。

判定结果：3 个是我们改的（见改动清单），2 个是上游在基线之后自己更新的（`README.md`、`README.zh.md` 的 2026.10.15 发版说明）——**这两个不要提交**，否则会把上游更新误记成我们的补丁。

> 这套反推方法是「无 `.git` 时的兜底」，不如 git 原生 `rev-parse` 可靠（无法证明基线唯一）。根治办法是给该 app 建仓并把本文一并入库，见待办。
