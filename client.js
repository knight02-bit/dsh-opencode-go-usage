/**
 * dsh-opencode-go-usage — client half.
 *
 * 挂在 `conversation.composer.dock`（输入框下方的常驻条目区），
 * 定时向宿主同源路由 `opencode-go-usage` 取一次额度快照，渲染成一条极简状态栏。
 *
 * 为什么不在浏览器里直连上游：`opencode.ai` 的 OPTIONS 预检返回 404，
 * 带 `Authorization` 头的跨域请求必挂，所以取数放在宿主（Node）侧。
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-usage',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const ROUTE = 'opencode-go-usage'
    const NS = 'opencode-go-usage'
    const POLL_MS = 60_000
    const STALE_MS = 20_000
    const PLACEHOLDER_ORIGIN = 'http://dsh.internal/'
    const WINDOWS = [
      { key: 'rolling', label: 'labelRolling' },
      { key: 'weekly', label: 'labelWeekly' },
      { key: 'monthly', label: 'labelMonthly' },
    ]

    const DICTS = {
      en: {
        title: 'OpenCode Go',
        labelRolling: 'Rolling',
        labelWeekly: 'Weekly',
        labelMonthly: 'Monthly',
        loading: 'reading quota',
        missingKey: 'no API key',
        unauthorized: 'key rejected',
        network: 'upstream unreachable',
        empty: 'no data',
        exhausted: 'exhausted',
        left: 'left',
        revealPace: 'Click to show pace',
        hidePace: 'Click to hide pace',
        refreshNow: 'refresh',
        resets: 'resets',
        soon: 'resetting',
        minutesShort: 'm',
        hoursShort: 'h',
        daysShort: 'd',
        hint: 'Set OPENCODE_GO_API_KEY, or write ~/.dsh/opencode-go-usage.json as {"apiKey":"oc_sk_..."}',
        paceTitle: 'Spend per',
        perDay: 'per day',
        perWeek: 'per week',
        ofWeekly: 'of weekly',
        ofMonthly: 'of monthly',
        todayLeft: 'left for today',
        weekLeft: 'left for this week',
        used: 'used',
        timeProgress: 'time',
        ahead: 'ahead of time',
        behind: 'behind time',
        onPace: 'on pace',
      },
      zh: {
        title: 'OpenCode Go',
        labelRolling: '滚动',
        labelWeekly: '本周',
        labelMonthly: '本月',
        loading: '读取额度',
        missingKey: '未配置密钥',
        unauthorized: '密钥被拒',
        network: '上游不可达',
        empty: '无数据',
        exhausted: '已耗尽',
        left: '剩余',
        revealPace: '点击显示配速',
        hidePace: '点击隐藏配速',
        refreshNow: '刷新',
        resets: '重置于',
        soon: '即将重置',
        minutesShort: ' 分钟后',
        hoursShort: ' 小时后',
        daysShort: ' 天后',
        hint: '设置 OPENCODE_GO_API_KEY，或写 ~/.dsh/opencode-go-usage.json：{"apiKey":"oc_sk_..."}',
        paceTitle: '配速',
        perDay: '每天',
        perWeek: '每周',
        ofWeekly: '周额度',
        ofMonthly: '月额度',
        todayLeft: '今日可用',
        weekLeft: '本周可用',
        used: '已用',
        timeProgress: '时间',
        ahead: '快于时间',
        behind: '慢于时间',
        onPace: '与时间同步',
      },
    }

    // ── 文案：优先走 Client locale service，缺失时退回浏览器语言 ────────────────
    let translate = null
    let useZh = detectZh()
    const textListeners = new Set()

    function detectZh() {
      try {
        return !/^en/i.test(String((typeof navigator !== 'undefined' && navigator.language) || 'zh'))
      } catch {
        return true
      }
    }

    function localeIsZh(locale) {
      try {
        const snapshot = typeof locale.getLocale === 'function' ? locale.getLocale() : null
        const active = snapshot && typeof snapshot.active === 'string' ? snapshot.active : ''
        if (active !== '') return /^zh/i.test(active)
      } catch {
        /* 快照不可读时退回浏览器语言 */
      }
      return detectZh()
    }

    function t(key) {
      if (typeof translate === 'function') {
        try {
          const value = translate(key)
          if (typeof value === 'string' && value !== '' && value !== key) return value
        } catch {
          /* 翻译未就绪：走内置字典 */
        }
      }
      const dict = DICTS[useZh ? 'zh' : 'en']
      return dict[key] || key
    }

    function bumpText() {
      for (const listener of Array.from(textListeners)) {
        try {
          listener()
        } catch {
          /* 单个订阅者异常不影响其余重渲染 */
        }
      }
    }

    function useTextRevision() {
      const [, setRevision] = React.useState(0)
      React.useEffect(() => {
        const listener = () => setRevision((value) => value + 1)
        textListeners.add(listener)
        return () => {
          textListeners.delete(listener)
        }
      }, [])
    }

    // ── 样式：只用主题 token ─────────────────────────────────────────────────
    const CSS = `
.ogu-dock {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 3px 10px 1px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
  cursor: pointer;
  border-radius: 6px;
  transition: background-color .15s ease, color .15s ease;
}
.ogu-dock:hover { background: var(--dsw-alias-bg-layer-1); }
.ogu-dock[data-expanded="true"] { background: var(--dsw-alias-bg-layer-1); }
.ogu-dock:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ogu-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.ogu-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dsw-alias-state-idle-primary);
  flex: none;
  transition: background-color .3s ease;
}
.ogu-dot[data-tone="ok"] { background: var(--dsw-alias-state-success-primary); }
.ogu-dot[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
.ogu-dot[data-tone="bad"] { background: var(--dsw-alias-state-error-primary); }
.ogu-dot[data-busy="true"] { animation: ogu-pulse 1.1s ease-in-out infinite; }
@keyframes ogu-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
.ogu-window {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.ogu-label { color: var(--dsw-alias-label-secondary); }
.ogu-track {
  position: relative;
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-bg-layer-2);
  overflow: hidden;
  flex: none;
}
.ogu-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 2px;
  background: var(--dsw-alias-state-success-primary);
  transition: width .4s cubic-bezier(.22,.61,.36,1), background-color .3s ease;
}
.ogu-fill[data-tone="idle"] { background: var(--dsw-alias-state-idle-primary); }
.ogu-fill[data-tone="warn"] { background: var(--dsw-alias-state-warn-primary); }
.ogu-fill[data-tone="bad"] { background: var(--dsw-alias-state-error-primary); }
.ogu-pct {
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
  min-width: 28px;
  text-align: right;
}
.ogu-pct[data-tone="warn"] { color: var(--dsw-alias-state-warn-primary); }
.ogu-pct[data-tone="bad"] { color: var(--dsw-alias-state-error-primary); }
.ogu-note { color: var(--dsw-alias-label-secondary); }
.ogu-sep { color: var(--dsw-alias-border-l2); }
.ogu-mark {
  font-size: 9px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  flex: none;
}
.ogu-mark[data-tone="ahead"] { color: var(--dsw-alias-state-warn-primary); }
.ogu-mark[data-tone="behind"] { color: var(--dsw-alias-state-success-primary); }
/* 悬浮卡：宿在 document.body 上，位置由 client.js 按锚点写内联样式 */
.ogu-popover-host {
  position: fixed;
  z-index: 2147483000;
  pointer-events: auto;
}
.ogu-popover {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px 8px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 10px 28px rgba(0, 0, 0, .22);
  animation: ogu-pop .14s cubic-bezier(.22,.61,.36,1) both;
  transform-origin: bottom left;
}
.ogu-popover-head {
  font-size: 10.5px;
  line-height: 14px;
  letter-spacing: .04em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
  opacity: .85;
}
.ogu-popover .ogu-chip {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  box-sizing: border-box;
}
.ogu-popover .ogu-note { font-size: 10.5px; line-height: 15px; }
.ogu-popover .ogu-refresh { align-self: flex-start; }
@keyframes ogu-pop {
  from { opacity: 0; transform: translateY(3px) scale(.99); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.ogu-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 1px 7px;
  border-radius: 5px;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  font-size: 10.5px;
  line-height: 15px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.ogu-chip strong {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.ogu-chip[data-tone="ahead"] strong { color: var(--dsw-alias-state-warn-primary); }
.ogu-chip[data-tone="behind"] strong { color: var(--dsw-alias-state-success-primary); }
.ogu-chip-sep { color: var(--dsw-alias-border-l2); }
.ogu-caret {
  font-size: 8px;
  line-height: 1;
  color: var(--dsw-alias-label-secondary);
  opacity: .7;
  flex: none;
  transition: transform .15s ease, opacity .15s ease;
}
.ogu-dock:hover .ogu-caret { opacity: 1; color: var(--dsw-alias-label-primary); }
.ogu-refresh {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 5px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 10.5px;
  line-height: 15px;
  white-space: nowrap;
  cursor: pointer;
}
.ogu-refresh:hover {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
}
.ogu-refresh:focus-visible {
  outline: 1px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.ogu-refresh[data-busy="true"] { opacity: .5; cursor: default; }
@media (prefers-reduced-motion: reduce) {
  .ogu-dot[data-busy="true"] { animation: none; }
  .ogu-fill { transition: none; }
  .ogu-caret { transition: none; }
  .ogu-popover { animation: none; }
}
`

    let styleOwner = null

    function insertStyles() {
      if (typeof document === 'undefined' || !document.head) return () => {}
      if (styleOwner) return () => {}
      const element = document.createElement('style')
      element.id = 'dsh-opencode-go-usage'
      element.dataset.plugin = 'dsh-opencode-go-usage'
      element.textContent = CSS
      document.head.appendChild(element)
      styleOwner = element
      return () => {
        try {
          element.remove()
        } catch {
          /* 外壳可能已清理 */
        }
        if (styleOwner === element) styleOwner = null
      }
    }

    // ── 宿主路由：桌面壳是 dsh-app://app/，外壳把非静态路径转发到宿主同源 ───────
    function pageBase() {
      try {
        if (typeof document !== 'undefined' && typeof document.baseURI === 'string' && document.baseURI) {
          return document.baseURI
        }
      } catch {
        /* 非 DOM 环境 */
      }
      return PLACEHOLDER_ORIGIN
    }

    function directoryBase(raw) {
      const url = new URL(raw || PLACEHOLDER_ORIGIN, PLACEHOLDER_ORIGIN)
      url.search = ''
      url.hash = ''
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      return url.href
    }

    function routeUrl(path) {
      return new URL(String(path).replace(/^\/+/, ''), directoryBase(pageBase()))
    }

    // ── 展开状态：默认收起，点一下展开配速行；选择记在 localStorage ─────────────
    const EXPAND_KEY = 'dsh-opencode-go-usage:expanded'

    function readExpanded() {
      try {
        return window.localStorage.getItem(EXPAND_KEY) === '1'
      } catch {
        return false
      }
    }

    function writeExpanded(value) {
      try {
        window.localStorage.setItem(EXPAND_KEY, value ? '1' : '0')
      } catch {
        /* 隐私模式下写不进去就算了 */
      }
    }

    // ── 取值 ────────────────────────────────────────────────────────────────
    function toneOf(percent) {
      if (typeof percent !== 'number' || !Number.isFinite(percent)) return 'idle'
      if (percent >= 50) return 'ok'
      if (percent >= 20) return 'warn'
      return 'bad'
    }

    function formatReset(value) {
      if (typeof value !== 'string' || value === '') return ''
      const at = new Date(value)
      if (Number.isNaN(at.getTime())) return ''
      const diff = at.getTime() - Date.now()
      if (diff <= 0) return t('soon')
      const minutes = Math.round(diff / 60_000)
      if (minutes < 90) return minutes + t('minutesShort')
      const hours = Math.round(minutes / 60)
      if (hours < 36) return hours + t('hoursShort')
      return Math.round(hours / 24) + t('daysShort')
    }

    function useUsage() {
      const [state, setState] = React.useState({ phase: 'loading', data: null, at: 0 })
      const mounted = React.useRef(true)
      const busy = React.useRef(false)
      const lastFetch = React.useRef(0)

      const load = React.useCallback(async (force) => {
        if (busy.current) return
        busy.current = true
        lastFetch.current = Date.now()
        try {
          const url = routeUrl(ROUTE)
          if (force) url.searchParams.set('refresh', '1')
          const response = await fetch(url.href, {
            headers: { accept: 'application/json' },
            cache: 'no-store',
            credentials: 'same-origin',
          })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          const data = await response.json()
          if (mounted.current) setState({ phase: 'ready', data, at: Date.now() })
        } catch (error) {
          if (mounted.current) {
            setState((previous) =>
              previous.phase === 'ready'
                ? { ...previous, at: Date.now(), message: String((error && error.message) || error) }
                : { phase: 'error', data: null, at: Date.now(), message: String((error && error.message) || error) },
            )
          }
        } finally {
          busy.current = false
        }
      }, [])

      React.useEffect(() => {
        mounted.current = true
        load(false)
        const timer = setInterval(() => load(false), POLL_MS)
        const onFocus = () => {
          if (Date.now() - lastFetch.current >= STALE_MS) load(true)
        }
        const onVisible = () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'visible') onFocus()
        }
        window.addEventListener('focus', onFocus)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          mounted.current = false
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load])

      return [state, load]
    }

    /** 小数位自适应：14.3 / 100 / 0.7 都能读。 */
    function fmtPercent(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const rounded = Math.round(value * 10) / 10
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    }

    /** 配速判断：已用百分比比时间进度快还是慢。 */
    function paceVerdict(pace) {
      if (!pace || typeof pace.deltaPercent !== 'number') return null
      const delta = pace.deltaPercent
      if (delta > 6) return { tone: 'ahead', glyph: '▲', text: t('ahead') + ' ' + fmtPercent(Math.abs(delta)) + '%' }
      if (delta < -6) return { tone: 'behind', glyph: '▼', text: t('behind') + ' ' + fmtPercent(Math.abs(delta)) + '%' }
      return { tone: 'flat', glyph: '·', text: t('onPace') }
    }

    function WindowCell(props) {
      const { labelKey, entry, pace, showPace } = props
      if (!entry) return null
      const remaining = entry.limited ? 0 : entry.remainingPercent
      const percent = typeof remaining === 'number' && Number.isFinite(remaining) ? Math.max(0, Math.min(100, remaining)) : null
      const tone = toneOf(percent)
      const reset = formatReset(entry.resetsAt)
      const label = t(labelKey)
      const amount =
        percent === null ? '—' : entry.limited ? t('exhausted') : Math.round(percent) + '%'
      const verdict = paceVerdict(pace)
      const paceText =
        pace && typeof pace.elapsedPercent === 'number'
          ? ' · ' + t('used') + ' ' + fmtPercent(entry.usedPercent) + '% / ' + t('timeProgress') + ' ' + fmtPercent(pace.elapsedPercent) + '%'
          : ''
      const tooltip =
        label +
        ' · ' +
        (entry.limited ? t('exhausted') : amount + ' ' + t('left')) +
        (reset ? ' · ' + t('resets') + ' ' + reset : '') +
        paceText +
        (verdict ? ' · ' + verdict.text : '')

      return h(
        'span',
        { className: 'ogu-window', title: tooltip },
        h('span', { className: 'ogu-label' }, label),
        h(
          'span',
          { className: 'ogu-track' },
          h('span', { className: 'ogu-fill', 'data-tone': tone, style: { width: (percent || 0) + '%' } }),
        ),
        h('span', { className: 'ogu-pct', 'data-tone': tone }, amount),
        // 「·」和分隔符撞脸，节奏同步时干脆不画标记，只在 tooltip 里说明。
        showPace && verdict && verdict.tone !== 'flat'
          ? h('span', { className: 'ogu-mark', 'data-tone': verdict.tone, 'aria-hidden': 'true' }, verdict.glyph)
          : null,
      )
    }

    /**
     * 用户真正要的两个数：
     *   - 周额度 ÷ 7 天        → 每天可以用掉周额度的百分之多少（今日可用 = 剩余周额度 ÷ 剩余天数）
     *   - 月额度 ÷ 当月周数    → 每周可以用掉月额度的百分之多少（本周可用 = 剩余月额度 ÷ 剩余周数）
     */
    function paceChips(pace) {
      const chips = []
      const safe = pace || {}

      const weekly = safe.weekly
      if (weekly && typeof weekly.perDayAllowancePercent === 'number') {
        const verdict = paceVerdict(weekly)
        chips.push({
          key: 'weekly',
          main: t('perDay') + ' ≤' + fmtPercent(weekly.perDayAllowancePercent) + '% ' + t('ofWeekly'),
          sub: t('todayLeft') + ' ' + fmtPercent(weekly.remainingPerDayPercent) + '%',
          tone: verdict ? verdict.tone : 'flat',
        })
      }

      const monthly = safe.monthly
      if (monthly && typeof monthly.perWeekAllowancePercent === 'number') {
        const verdict = paceVerdict(monthly)
        chips.push({
          key: 'monthly',
          main: t('perWeek') + ' ≤' + fmtPercent(monthly.perWeekAllowancePercent) + '% ' + t('ofMonthly'),
          sub: t('weekLeft') + ' ' + fmtPercent(monthly.remainingPerWeekPercent) + '%',
          tone: verdict ? verdict.tone : 'flat',
        })
      }

      return chips
    }

    // ── 悬浮卡：挂在 document.body 上（composer 卡片会裁剪溢出内容）────────────
    function el(tag, props, ...children) {
      const node = document.createElement(tag)
      if (props) {
        for (const [key, value] of Object.entries(props)) {
          if (value === undefined || value === null || value === false) continue
          if (key === 'text') node.textContent = String(value)
          else if (key === 'className') node.className = String(value)
          else if (key === 'dataset') Object.assign(node.dataset, value)
          else if (key === 'style') Object.assign(node.style, value)
          else node.setAttribute(key, String(value))
        }
      }
      for (const child of children) {
        if (child === null || child === undefined || child === false) continue
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      }
      return node
    }

    function buildPopover(pace, busy, refresh) {
      const chips = paceChips(pace)
      const root = el('div', { className: 'ogu-popover', role: 'dialog', 'aria-label': t('paceTitle') })

      root.appendChild(el('div', { className: 'ogu-popover-head' }, t('paceTitle')))

      if (chips.length === 0) {
        root.appendChild(el('div', { className: 'ogu-note' }, t('loading')))
      }
      for (const chip of chips) {
        root.appendChild(
          el(
            'div',
            { className: 'ogu-chip', dataset: { tone: chip.tone }, title: chip.main + ' · ' + chip.sub },
            el('span', { text: chip.main }),
            el('strong', { text: chip.sub }),
          ),
        )
      }

      root.appendChild(makeRefreshButton(busy, refresh))

      return root
    }

    function makeRefreshButton(busy, refresh) {
      const button = el('button', { className: 'ogu-refresh', type: 'button', dataset: { busy: busy ? 'true' : 'false' } })
      button.textContent = busy ? '···' : t('refreshNow')
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        if (!busy) refresh()
      })
      return button
    }

    function UsageDock() {
      useTextRevision()
      const [state, load] = useUsage()
      const [expanded, setExpanded] = React.useState(readExpanded)
      const [pending, setPending] = React.useState(false)
      const dockRef = React.useRef(null)
      const popoverRef = React.useRef(null)
      const placeRef = React.useRef(null)
      const data = state.phase === 'ready' ? state.data : null
      const windows = (data && data.windows) || {}
      const keys = Object.keys(windows).filter((key) => windows[key])
      const paceMap = (data && data.pace) || {}

      const toggle = React.useCallback(() => {
        setExpanded((previous) => {
          writeExpanded(!previous)
          return !previous
        })
      }, [])

      const close = React.useCallback(() => {
        setExpanded(false)
        writeExpanded(false)
      }, [])

      const refresh = React.useCallback(() => {
        setPending(true)
        Promise.resolve(load(true)).finally(() => setPending(false))
      }, [load])

      // 悬浮卡：挂到 document.body（composer 卡片会裁剪溢出内容），并跟随锚点定位。
      React.useEffect(() => {
        if (!expanded) return () => {}
        if (typeof document === 'undefined' || !document.body) return () => {}

        const host = document.createElement('div')
        host.className = 'ogu-popover-host'
        document.body.appendChild(host)
        popoverRef.current = host

        const place = () => {
          const anchor = dockRef.current
          if (!anchor || !host.isConnected) return
          const rect = anchor.getBoundingClientRect()
          const width = Math.min(Math.max(rect.width, 250), 380)
          const left = Math.max(8, Math.min(rect.left, (window.innerWidth || 0) - width - 8))
          host.style.width = Math.round(width) + 'px'
          host.style.left = Math.round(left) + 'px'
          const height = host.offsetHeight || 0
          const gap = 8
          if (rect.top - gap - height >= 8) {
            host.style.top = 'auto'
            host.style.bottom = Math.round((window.innerHeight || 0) - rect.top + gap) + 'px'
          } else {
            host.style.bottom = 'auto'
            host.style.top = Math.round(rect.bottom + gap) + 'px'
          }
        }

        place()
        placeRef.current = place

        const onPointerDown = (event) => {
          const target = event.target
          if (host.contains(target)) return
          if (dockRef.current && dockRef.current.contains(target)) return
          close()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') close()
        }
        const onReflow = () => place()

        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', onReflow)
        window.addEventListener('scroll', onReflow, true)

        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('resize', onReflow)
          window.removeEventListener('scroll', onReflow, true)
          popoverRef.current = null
          placeRef.current = null
          try {
            host.remove()
          } catch {
            /* 外壳可能已清理 */
          }
        }
      }, [expanded, close])

      // 内容随数据/文案/进行中状态刷新；高度变了就重新贴一次锚点。
      React.useEffect(() => {
        const host = popoverRef.current
        if (!host || !host.isConnected) return
        host.replaceChildren(buildPopover(paceMap, pending, refresh))
        if (typeof placeRef.current === 'function') placeRef.current()
      })

      let tone = 'idle'
      let note = t('loading')
      if (data) {
        if (!data.configured) note = t('missingKey')
        else if (data.error === 'unauthorized') note = t('unauthorized')
        else if (data.error === 'network') note = t('network')
        else if (data.error === 'empty-payload') note = t('empty')
        else if (keys.length === 0) note = t('network')
      } else if (state.phase === 'error') {
        note = t('network')
      }
      if (keys.length > 0) {
        tone = toneOf(
          Math.min(...keys.map((key) => (typeof windows[key].remainingPercent === 'number' ? windows[key].remainingPercent : 0))),
        )
      }

      const action = expanded ? t('hidePace') : t('revealPace')

      const children = [
        h(
          'span',
          { className: 'ogu-title', key: 'title' },
          h('span', { className: 'ogu-dot', 'data-tone': tone, 'data-busy': keys.length === 0 ? 'true' : 'false' }),
          t('title'),
          h('span', { className: 'ogu-caret', key: 'caret', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
        ),
      ]

      if (keys.length > 0) {
        for (const spec of WINDOWS) {
          if (!windows[spec.key]) continue
          children.push(
            h(WindowCell, {
              key: spec.key,
              labelKey: spec.label,
              entry: windows[spec.key],
              pace: paceMap[spec.key],
              showPace: expanded,
            }),
            h('span', { className: 'ogu-sep', key: spec.key + '-sep' }, '·'),
          )
        }
        children.pop()
      } else {
        children.push(h('span', { className: 'ogu-note', key: 'note' }, note))
      }

      return h(
        'div',
        {
          ref: dockRef,
          className: 'ogu-dock',
          'data-expanded': expanded ? 'true' : 'false',
          title: keys.length > 0 ? action : t('hint'),
          onClick: toggle,
          onDoubleClick: () => {
            if (keys.length > 0) refresh()
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggle()
            }
          },
          role: 'button',
          tabIndex: 0,
          'aria-expanded': expanded,
          'aria-haspopup': 'dialog',
          'aria-label': t('title') + ' · ' + (keys.length > 0 ? action : note),
        },
        children,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => insertStyles())

        // 文案字典 + 语言切换订阅：locale service 缺失时保持内置回退。
        ctx.effect(() => {
          const locale = (() => {
            try {
              return ctx.get('locale')
            } catch {
              return undefined
            }
          })()
          if (!locale) return () => {}

          const disposers = []
          for (const [id, dict] of Object.entries(DICTS)) {
            try {
              const dispose = locale.register(NS, id, dict)
              if (typeof dispose === 'function') disposers.push(dispose)
            } catch (error) {
              console.error('dictionary registration failed for', id, error)
            }
          }
          try {
            if (typeof locale.bind === 'function') translate = locale.bind(NS)
          } catch {
            /* 保留内置回退 */
          }

          useZh = localeIsZh(locale)
          bumpText()

          let unsubscribe = () => {}
          if (typeof locale.subscribe === 'function') {
            try {
              unsubscribe = locale.subscribe(() => {
                useZh = localeIsZh(locale)
                bumpText()
              })
            } catch {
              /* 语言切换只影响文案，失败不致命 */
            }
          }

          return () => {
            try {
              unsubscribe()
            } catch {
              /* 已释放 */
            }
            translate = null
            for (const dispose of disposers.reverse()) {
              try {
                dispose()
              } catch {
                /* 已释放 */
              }
            }
            bumpText()
          }
        })

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'opencode-go-usage',
              order: 2,
              label: () => t('title'),
            },
            UsageDock,
          ),
        )
      },
    }
  },
})
