/**
 * dsh-opencode-go-usage — host half.
 *
 * 职责只有一件事：把 OpenCode Go 的额度接口搬到同源 HTTP 路由上。
 *
 * 为什么必须在宿主侧请求：`https://opencode.ai/zen/go/v1/usage` 需要
 * `Authorization: Bearer <key>`（非简单请求头），而它的 OPTIONS 预检实测返回 404
 * （没有 CORS 响应头），浏览器端直接 fetch 一定失败。宿主是 Node，没有 CORS 约束。
 *
 * 客户端（client.js）通过 `fetch('<page base>/opencode-go-usage')` 取 JSON。
 *
 * 密钥来源（按优先级）：
 *   1. $DSH_HOME/opencode-go-usage.json 或 ~/.dsh/opencode-go-usage.json → { "apiKey": "...", "orgId": "wrk_..." }
 *   2. 环境变量 OPENCODE_GO_API_KEY / OPENCODE_GO_ORG_ID
 *   3. DSH 凭据库 OPENCODE_GO_API_KEY（ctx.credentials.resolve）
 *
 * 密钥永远不会出现在这个路由的响应体里，只出现在宿主侧进程内存中。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ROUTE_PATH = '/opencode-go-usage'
const UPSTREAM_URL = 'https://opencode.ai/zen/go/v1/usage'
const WINDOW_KEYS = ['rolling', 'weekly', 'monthly']

/** 上游结果缓存多久算新鲜。 */
const FRESH_MS = 30_000
/** 两次真正打上游之间的最小间隔，避免连点把上游打爆。 */
const MIN_REFRESH_MS = 5_000
/** 单次上游请求超时。 */
const TIMEOUT_MS = 15_000

/** 额度文件名，用于在候选目录里查找。 */
const CREDENTIAL_FILE = 'opencode-go-usage.json'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

function isLoopbackHostname(raw) {
  const host = String(raw || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!parts) return false
  if (Number(parts[1]) !== 127) return false
  return [parts[2], parts[3], parts[4]].every((x) => Number(x) <= 255)
}

/**
 * 只要请求来自页面同源（或本机回环），就放行；跨站一律拒绝。
 * 这个路由只返回百分比，没有密钥，但仍然不该让任意网页读到用量画像。
 */
function isLoopbackSocket(raw) {
  const address = String(raw || '').toLowerCase()
  if (!address) return false
  if (address === '::1') return true
  if (address.startsWith('::ffff:')) return isLoopbackHostname(address.slice(7))
  return isLoopbackHostname(address)
}

function rejectionStatus(req) {
  try {
    // 同源页面在桌面壳里经自定义协议转发，远端地址始终是本机；一旦不是回环就说明
    // 有人从其他主机连到了 dsh web 端口，用量数据没有理由外泄。
    const remote = req && req.socket ? req.socket.remoteAddress : ''
    if (remote && !isLoopbackSocket(remote)) return 403
    const headers = (req && req.headers) || {}
    let authority
    try {
      authority = new URL('http://' + String(headers.host || '')).host
    } catch {
      return 403
    }
    const site = String(headers['sec-fetch-site'] || '').toLowerCase()
    if (site === 'cross-site') return 403
    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      let originUrl
      try {
        originUrl = new URL(origin)
      } catch {
        return 403
      }
      const sameOrigin = originUrl.host.toLowerCase() === authority.toLowerCase()
      // 桌面壳的页面 origin 是 dsh-app://app，协议不同但仍是同一个宿主进程。
      const shellOrigin = originUrl.protocol === 'dsh-app:'
      if (!sameOrigin && !shellOrigin) return 403
      return null
    }
    if (String(headers.host || '').startsWith('app')) return null // dsh-app://app
    if (isLoopbackHostname(new URL('http://' + String(headers.host || '')).hostname)) return null
    return 403
  } catch {
    return 403
  }
}

/**
 * 从凭据服务的返回值里取出裸密钥。
 * `ctx.credentials.resolve(ref)` 解析为 `{ value, source } | undefined`；
 * 这里同时容忍旧版的裸字符串与几种常见的对象字段名。
 * @param {unknown} hit
 * @returns {string}
 */
function credentialValue(hit) {
  if (!hit) return ''
  if (typeof hit === 'string') return hit.trim()
  if (typeof hit === 'object') {
    const record = /** @type {Record<string, unknown>} */ (hit)
    for (const field of ['value', 'secret', 'token', 'key']) {
      const candidate = record[field]
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
    }
  }
  return ''
}

async function readCredentialFile(env) {
  const candidates = []
  const dshHome = String(env.DSH_HOME || '').trim()
  if (dshHome) candidates.push(join(dshHome, CREDENTIAL_FILE))
  candidates.push(join(homedir(), '.dsh', CREDENTIAL_FILE))
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      if (parsed && typeof parsed === 'object') return { data: parsed, file }
    } catch {
      // 文件不存在或不是 JSON —— 继续找下一个来源
    }
  }
  return { data: null, file: null }
}

/**
 * 解析出这一轮要用的密钥与工作区 id。
 * @returns {Promise<{apiKey: string|null, orgId: string|null, source: string}>}
 */
async function resolveCredential(ctx, env) {
  const fromFile = await readCredentialFile(env)
  const fileKey = fromFile.data
    ? String(fromFile.data.apiKey || fromFile.data.api_key || fromFile.data.token || '').trim()
    : ''
  const fileOrg = fromFile.data
    ? String(fromFile.data.orgId || fromFile.data.org_id || fromFile.data.workspace || '').trim()
    : ''
  if (fileKey) {
    return {
      apiKey: fileKey,
      orgId: fileOrg || String(env.OPENCODE_GO_ORG_ID || '').trim() || null,
      source: fromFile.file,
    }
  }
  const envKey = String(env.OPENCODE_GO_API_KEY || '').trim()
  if (envKey) {
    return { apiKey: envKey, orgId: String(env.OPENCODE_GO_ORG_ID || '').trim() || null, source: 'env' }
  }
  try {
    const credentials = ctx.get('credentials')
    if (credentials && typeof credentials.resolve === 'function') {
      // resolve() 的返回是 `{ value, source } | undefined`（见 @deepseek-ai/dsh-credentials），
      // 不是裸字符串 —— 早期版本直接 String() 会得到 "[object Object]" 并被上游判 401。
      const key = credentialValue(await credentials.resolve('OPENCODE_GO_API_KEY'))
      if (key) {
        let orgId = null
        try {
          orgId = credentialValue(await credentials.resolve('OPENCODE_GO_ORG_ID')) || null
        } catch {
          orgId = null
        }
        return { apiKey: key, orgId, source: 'dsh-credentials' }
      }
    }
  } catch {
    // 凭据服务不可用 —— 当作未配置
  }
  return { apiKey: null, orgId: null, source: 'none' }
}

function pickNumber(record, keys) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value)
    }
  }
  return null
}

/**
 * 把一个窗口的原始记录整理成「剩余百分比」。
 * 上游的 `percent` 语义是「已用百分比」，剩余 = 100 - percent。
 * @param {unknown} raw
 */
function normalizeWindow(raw) {
  if (!raw || typeof raw !== 'object') return null
  const record = /** @type {Record<string, unknown>} */ (raw)
  let used = pickNumber(record, ['percent', 'usedPercent', 'used_percent', 'usage', 'used'])
  let remaining = pickNumber(record, ['remainingPercent', 'remaining_percent', 'remaining'])
  if (remaining !== null && remaining >= 0 && remaining <= 1 && used === null) remaining *= 100
  if (used !== null && used >= 0 && used <= 1 && pickNumber(record, ['percent', 'usedPercent', 'used_percent']) === null) {
    used *= 100
  }
  if (used === null && remaining !== null) used = 100 - remaining
  if (remaining === null && used !== null) remaining = 100 - used
  if (used === null && remaining === null) return null
  const status = typeof record.status === 'string' ? record.status : 'ok'
  const resetsAt =
    typeof record.resetsAt === 'string'
      ? record.resetsAt
      : typeof record.resets_at === 'string'
        ? record.resets_at
        : null
  const limited = status === 'rate-limited' || status === 'rate_limited' || (remaining !== null && remaining <= 0.0001)
  return {
    usedPercent: Math.max(0, Math.min(100, Number(used ?? 100 - (remaining ?? 0)))),
    remainingPercent: Math.max(0, Math.min(100, Number(remaining ?? 0))),
    status,
    limited,
    resetsAt,
  }
}

function normalizePayload(body) {
  const usage = body && typeof body === 'object' && body.usage && typeof body.usage === 'object' ? body.usage : body
  const windows = {}
  for (const key of WINDOW_KEYS) {
    const normalized = normalizeWindow(usage ? usage[key] : null)
    if (normalized) windows[key] = normalized
  }
  return windows
}

function round2(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.round(value * 100) / 100
}

/**
 * 推断一个额度窗口的长度与起点。
 * - `weekly`：固定 7 天（上游 resetsAt 落在周一 00:00Z）。
 * - `monthly`：一个自然月（起点 = resetsAt 往前推一个月，跨月天数差自动处理）。
 * - `rolling`：上游不给窗口长度，单次采样推不出来，返回 null（前端不做配速判断）。
 * @param {string} key
 * @param {string|null} resetsAt
 */
function windowSpan(key, resetsAt) {
  if (typeof resetsAt !== 'string' || resetsAt === '') return null
  const end = Date.parse(resetsAt)
  if (!Number.isFinite(end)) return null
  if (key === 'weekly') {
    return { lengthMs: WEEK_MS, startedAt: end - WEEK_MS, resetsAt: end }
  }
  if (key === 'monthly') {
    const start = new Date(end)
    start.setUTCMonth(start.getUTCMonth() - 1)
    const lengthMs = end - start.getTime()
    if (!(lengthMs > 0)) return null
    return { lengthMs, startedAt: start.getTime(), resetsAt: end }
  }
  return null
}

/**
 * 每个窗口的「配速」：时间走了多少、额度用了多少、按剩余时间摊下来每天/每周还能用多少。
 * 用户要的那两个数就是这里的 `perDayAllowancePercent`（周额度 ÷ 7 天）
 * 与 `perWeekAllowancePercent`（月额度 ÷ 当月周数）。
 * @param {Record<string, any>} windows
 * @param {number} now
 */
function computePace(windows, now) {
  const pace = {}
  for (const key of WINDOW_KEYS) {
    const win = windows ? windows[key] : null
    if (!win) continue
    const span = windowSpan(key, win.resetsAt)
    const entry = {
      lengthMs: null,
      startedAt: null,
      resetsAt: win.resetsAt || null,
      elapsedPercent: null,
      expectedUsedPercent: null,
      deltaPercent: null,
      daysLeft: null,
      weeksLeft: null,
      perDayAllowancePercent: null,
      remainingPerDayPercent: null,
      perWeekAllowancePercent: null,
      remainingPerWeekPercent: null,
    }
    if (span) {
      const elapsedMs = Math.max(0, Math.min(span.lengthMs, now - span.startedAt))
      const elapsedPercent = (elapsedMs / span.lengthMs) * 100
      const days = span.lengthMs / DAY_MS
      const daysLeft = Math.max(0, span.resetsAt - now) / DAY_MS
      const weeksLeft = daysLeft / 7
      entry.lengthMs = span.lengthMs
      entry.startedAt = new Date(span.startedAt).toISOString()
      entry.elapsedPercent = round2(elapsedPercent)
      entry.expectedUsedPercent = round2(elapsedPercent)
      entry.deltaPercent = round2(win.usedPercent - elapsedPercent)
      entry.daysLeft = round2(daysLeft)
      entry.weeksLeft = round2(weeksLeft)
      entry.perDayAllowancePercent = round2(100 / days)
      entry.perWeekAllowancePercent = round2(700 / days)
      // 剩余额度按剩余时间摊平：这就是「今天还能用多少」「这周还能用多少」。
      entry.remainingPerDayPercent = round2(
        daysLeft > 0.02 ? win.remainingPercent / daysLeft : win.remainingPercent,
      )
      entry.remainingPerWeekPercent = round2(
        weeksLeft > 0.02 ? win.remainingPercent / weeksLeft : win.remainingPercent,
      )
    }
    pace[key] = entry
  }
  return pace
}

export function apply(ctx) {
  const state = {
    cache: null,
    lastAttemptAt: 0,
    inFlight: null,
  }

  async function collect(force) {
    const env = process.env
    // 配速随「现在」变化（剩余额度摊到剩余时间），所以每次出站都重算，不跟着缓存走。
    const respond = (payload) => ({ ...payload, pace: computePace(payload.windows, Date.now()) })
    const credential = await resolveCredential(ctx, env)
    if (!credential.apiKey) {
      return respond({
        ok: false,
        configured: false,
        error: 'missing-key',
        source: credential.source,
        fetchedAt: new Date().toISOString(),
        windows: {},
      })
    }

    const now = Date.now()
    const fresh = state.cache && state.cache.apiKey === credential.apiKey && now - state.cache.at < FRESH_MS
    if (fresh && !force) return respond(state.cache.payload)
    const throttled = now - state.lastAttemptAt < MIN_REFRESH_MS
    if (throttled && state.cache) return respond(state.cache.payload)

    if (state.inFlight) return respond(await state.inFlight)

    state.lastAttemptAt = now
    state.inFlight = (async () => {
      const headers = {
        authorization: 'Bearer ' + credential.apiKey,
        accept: 'application/json',
        'user-agent': 'dsh-opencode-go-usage/0.1',
      }
      if (credential.orgId) headers['x-opencode-org-id'] = credential.orgId
      let payload
      try {
        const response = await fetch(UPSTREAM_URL, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
        const text = await response.text()
        let body = null
        try {
          body = text ? JSON.parse(text) : null
        } catch {
          body = null
        }
        if (!response.ok) {
          const hint = body && body.error && body.error.message ? String(body.error.message) : ''
          payload = {
            ok: false,
            configured: true,
            error: response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream-' + response.status,
            detail: hint || text.slice(0, 200),
            source: credential.source,
            fetchedAt: new Date().toISOString(),
            windows: state.cache ? state.cache.payload.windows : {},
          }
        } else {
          const windows = normalizePayload(body)
          payload = {
            ok: Object.keys(windows).length > 0,
            configured: true,
            error: Object.keys(windows).length > 0 ? null : 'empty-payload',
            source: credential.source,
            fetchedAt: new Date().toISOString(),
            windows,
          }
        }
      } catch (error) {
        payload = {
          ok: false,
          configured: true,
          error: 'network',
          detail: String((error && error.message) || error),
          source: credential.source,
          fetchedAt: new Date().toISOString(),
          windows: state.cache ? state.cache.payload.windows : {},
        }
      }
      state.cache = { apiKey: credential.apiKey, at: Date.now(), payload }
      return payload
    })()

    try {
      return respond(await state.inFlight)
    } finally {
      state.inFlight = null
    }
  }

  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() =>
      scoped.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          const deny = rejectionStatus(req)
          if (deny) {
            res.statusCode = deny
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: 'forbidden' }))
            return
          }
          if (req.method === 'OPTIONS') {
            res.statusCode = 204
            res.end()
            return
          }
          const url = new URL('http://placeholder' + (req.url || ROUTE_PATH))
          const force = url.searchParams.get('refresh') === '1'
          let payload
          try {
            payload = await collect(force)
          } catch (error) {
            payload = {
              ok: false,
              configured: true,
              error: 'collector',
              detail: String((error && error.message) || error),
              fetchedAt: new Date().toISOString(),
              windows: {},
            }
          }
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(payload))
        },
      }),
    )
  })
}
