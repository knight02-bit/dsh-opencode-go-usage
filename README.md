# dsh-opencode-go-usage

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/DSH-Web%20plugin-4c8bf5)](https://github.com/knight02-bit/dsh-opencode-go-usage)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](package.json)

**在 DSH（DeepSeek Harness）Web GUI 的输入框下方常驻一条 OpenCode Go 额度条**，实时显示
rolling / weekly / monthly 三个窗口的**剩余**额度百分比；点一下会在上方浮出「配速卡」，
告诉你今天/本周还能花多少才不浪费额度。

> An OpenCode Go quota bar for the DSH Web GUI. Lives above the composer, shows remaining
> percentage for the rolling / weekly / monthly windows, and floats a pacing card that answers
> “how much can I still burn today without wasting quota”. Host-side fetches the upstream API
> (its CORS preflight is broken), so the key never reaches the browser.

```
● OpenCode Go ▸   滚动 ▮▮▮▮ 98%  ·  本周 ▮▮▮▮ 99%  ·  本月 ▮▮▮▮ 100%

        点击整条 ↑ 浮出配速卡（不改变行高）

        ┌ 配速 ──────────────────────────────┐
        │ 每天 ≤14.3% 周额度    今日可用 17.8% │
        │ 每周 ≤23.3% 月额度    本周可用 23.6% │
        │ 刷新                                │
        └────────────────────────────────────┘
```

## 特性

- **三个窗口**：`rolling`（滚动 5 小时窗口）、`weekly`、`monthly`，各自一条进度条 + 百分比。
- **剩余优先**：上游返回的是「已用百分比」，这里统一换算成剩余；`rate-limited` 显示为「已耗尽」。
- **配速卡**：点一下在 dock 上方浮出，给出「每天 ≤X% 周额度 / 每周 ≤Y% 月额度」以及
  「今日可用 / 本周可用」，并对比时间进度算 ▲ / ▼（超速 / 富余）。
- **零跨域**：宿主半在 Node 侧请求上游，浏览器只访问同源 `/opencode-go-usage`，密钥不出宿主。
- **按需刷新**：60 秒自动轮询 + 窗口重获焦点补拉 + 手动刷新（浮层里的 `刷新`，或双击整条）；
  宿主侧 30 秒缓存、5 秒最小间隔、并发去重。
- **主题一致**：只用 `--dsw-alias-*` 主题 token，明暗模式跟 GUI；文案走 Client locale（中/英）。
- **无依赖**：`dependencies` 为空，落地只有 4 个文件。

## 安装

### 方式一：克隆后以 link 方式装入 profile（推荐）

```bash
git clone https://github.com/knight02-bit/dsh-opencode-go-usage.git
```

然后在 DSH 里把该目录装进当前 profile：

- 会话内（Agent 侧）：`plugin_manager` → `action: install_bundle`，`target` 指向克隆下来的
  绝对路径；返回 `application: applied` 即生效。
- 或用 CLI：`dsh plugin --profile <profile> add link:/abs/path/to/dsh-opencode-go-usage`
  （已装过同一包时先 `remove_bundle` / `remove`）。

装好后刷新一次 GUI 页面，输入框下方就会出现额度条。

### 方式二：手动放置（不装插件，仅调试）

把 `index.js` / `client.js` 当作普通模块引入宿主与客户端的做法不受支持，请走方式一。

## 配置密钥

宿主按以下优先级解析，**密钥不会出现在路由响应里**：

1. `$DSH_HOME/opencode-go-usage.json` 或 `~/.dsh/opencode-go-usage.json`：

```json
{ "apiKey": "oc_xxx", "orgId": "wrk_xxx" }
```

`orgId` 可选，会以 `x-opencode-org-id` 头发送（团队/工作区账号用）。

2. 环境变量 `OPENCODE_GO_API_KEY` / `OPENCODE_GO_ORG_ID`
3. DSH 凭据库（`~/.dsh/.credentials.yaml`）里的 `OPENCODE_GO_API_KEY`

> 踩坑记录：`ctx.credentials.resolve(ref)` 返回 `{ value, source } | undefined`，不是裸字符串。
> 直接 `String()` 会得到 `"[object Object]"`，上游回 401。

## 显示与交互

- **单击整条**（或聚焦后按 `Enter` / 空格）：浮出 / 收起配速卡与 ▲▼ 标记，状态记在
  `localStorage['dsh-opencode-go-usage:expanded']`。
- **浮层定位**：挂在 `document.body` 上（composer 卡片会裁剪溢出内容），按 dock 的
  `getBoundingClientRect()` 贴边，上方空间不足自动翻到下方，`resize` / 滚动 / 内容变化都会重贴。
- **关闭**：再点一次整条、点浮层外任意位置、按 `Esc`。
- **刷新**：浮层内 `刷新` 按钮；或双击整条。
- **悬停某个窗口**：显示剩余额度、重置时间、「已用 X% / 时间 Y%」。

颜色：剩余 ≥50% 绿、≥20% 黄、其余红。

| 显示 | 含义 |
| --- | --- |
| 未配置密钥 | 三处来源都没找到 key |
| 密钥被拒 | 上游返回 401/403 |
| 上游不可达 | 网络错误或非 2xx |
| 已耗尽 | 该窗口 `rate-limited` |

## 配速怎么算

| 显示项 | 公式 | 含义 |
| --- | --- | --- |
| 每天 ≤14.3% 周额度 | `100 ÷ 7` | 周额度按 7 天摊平，每天最多烧掉周额度的 14.3% |
| 每周 ≤23.3% 月额度 | `100 ÷ (当月天数 ÷ 7)` | 月额度按当月实际周数摊平 |
| 今日可用 17.8% | `剩余周额度 ÷ 剩余天数` | 按当前剩余量重新摊平，比固定配额更贴近「今天还能花多少」 |
| 本周可用 23.6% | `剩余月额度 ÷ 剩余周数` | 同上，月窗口视角 |

`rolling` 窗口上游不给窗口长度，单点采样推不出来，所以不做配速（`pace.rolling.lengthMs = null`）。

▲ = 已用比时间进度快（有撞限风险）；▼ = 还落后于时间进度（额度富余，可以多用）；
两个阈值是 ±6 个百分点，同步时不画点（避免和分隔符 `·` 撞脸）。

## 架构（为什么必须两半）

上游 `GET https://opencode.ai/zen/go/v1/usage` 需要 `Authorization: Bearer <key>`，
而它的 `OPTIONS` 预检实测返回 **404**（不返回 CORS 头）。`Authorization` 属于非简单请求头，
所以浏览器端直接 `fetch` 必然失败。

因此：

- **宿主半（`index.js`，Node）** 请求上游，并在同源路径 `/opencode-go-usage` 暴露 JSON，
  带 30 秒缓存 + 并发去重。
- **客户端半（`client.js`）** 用页面相对的 base（桌面壳是 `dsh-app://app/`，外壳会把非静态
  路径转发到宿主同源）`fetch('<page base>/opencode-go-usage')`，全程无跨域。

路由的信任栅栏：`sec-fetch-site: cross-site` → 403；有 `Origin` 时必须同 host 或 `dsh-app:`
协议；socket 远端必须是回环地址。响应体里只有百分比，没有任何密钥。

响应形状：

```json
{
  "ok": true,
  "configured": true,
  "error": null,
  "source": "dsh-credentials",
  "fetchedAt": "2026-11-10T10:20:08.088Z",
  "windows": {
    "rolling": { "usedPercent": 2, "remainingPercent": 98,  "status": "ok", "limited": false, "resetsAt": "2026-11-10T10:55:26.000Z" },
    "weekly":  { "usedPercent": 1, "remainingPercent": 99,  "status": "ok", "limited": false, "resetsAt": "2026-11-16T00:00:00.000Z" },
    "monthly": { "usedPercent": 0, "remainingPercent": 100, "status": "ok", "limited": false, "resetsAt": "2026-12-10T02:53:05.000Z" }
  },
  "pace": {
    "weekly":  { "elapsedPercent": 20.44, "deltaPercent": -19.44, "daysLeft": 5.57,
                 "perDayAllowancePercent": 14.29, "remainingPerDayPercent": 17.78 },
    "monthly": { "elapsedPercent": 1.03,  "deltaPercent": -1.03,  "weeksLeft": 4.24,
                 "perWeekAllowancePercent": 23.33, "remainingPerWeekPercent": 23.58 }
  }
}
```

## 开发

```bash
npm run check     # 无浏览器的桩件渲染自检：收起不动 DOM / 展开挂出浮层 / 刷新按钮打 ?refresh=1
```

- 只改 `client.js`：浏览器刷新一次页面即可（宿主不用动）。
- 改 `index.js`：把 Loader 行 `include:opencode-go-usage` 先 `enabled: false` 再 `enabled: true`，
  宿主会以新代码重新 import（不必重启 DSH）。
- 调试路由：`curl "http://127.0.0.1:<port>/opencode-go-usage?refresh=1"`。

## License

[MIT](LICENSE)
