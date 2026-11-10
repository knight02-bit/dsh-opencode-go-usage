/**
 * 无浏览器验证：最小 DOM + React 桩件跑 UsageDock()。
 * 断言：收起时不动 DOM；展开时 body 上挂出悬浮卡，内容/定位正确，刷新按钮能触发 ?refresh=1。
 */
const fs = require('fs')
const path = require('path')
const CLIENT = path.join(__dirname, '..', 'client.js')

const payload = {
  ok: true,
  configured: true,
  error: null,
  source: 'dsh-credentials',
  fetchedAt: new Date().toISOString(),
  windows: {
    rolling: { usedPercent: 2, remainingPercent: 98, status: 'ok', limited: false, resetsAt: '2026-11-10T10:55:26.000Z' },
    weekly: { usedPercent: 1, remainingPercent: 99, status: 'ok', limited: false, resetsAt: '2026-11-16T00:00:00.000Z' },
    monthly: { usedPercent: 0, remainingPercent: 100, status: 'ok', limited: false, resetsAt: '2026-12-10T02:53:05.000Z' },
  },
  pace: {
    rolling: { lengthMs: null, deltaPercent: null, elapsedPercent: null },
    weekly: {
      elapsedPercent: 20.2,
      deltaPercent: -19.3,
      daysLeft: 5.59,
      perDayAllowancePercent: 14.29,
      remainingPerDayPercent: 17.75,
    },
    monthly: {
      elapsedPercent: 1.01,
      deltaPercent: -1.01,
      weeksLeft: 4.24,
      perWeekAllowancePercent: 23.33,
      remainingPerWeekPercent: 23.57,
    },
  },
}

// ── 最小 DOM ────────────────────────────────────────────────────────────────
function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attrs: {},
    listeners: {},
    className: '',
    textContent: '',
    offsetHeight: 72,
    isConnected: true,
    parentNode: null,
    setAttribute(key, value) {
      this.attrs[key] = value
    },
    appendChild(child) {
      this.children.push(child)
      if (child && typeof child === 'object') child.parentNode = this
      return child
    },
    replaceChildren() {
      this.children = Array.prototype.slice.call(arguments)
      for (const child of this.children) if (child && typeof child === 'object') child.parentNode = this
    },
    remove() {
      this.isConnected = false
    },
    contains(target) {
      if (target === this) return true
      return this.children.some(
        (child) => child && typeof child === 'object' && typeof child.contains === 'function' && child.contains(target),
      )
    },
    getBoundingClientRect() {
      return { left: 40, top: 600, right: 400, bottom: 620, width: 360, height: 20 }
    },
    addEventListener(type, handler) {
      this.listeners[type] = this.listeners[type] || []
      this.listeners[type].push(handler)
    },
    removeEventListener() {},
    dispatch(type, event) {
      for (const handler of this.listeners[type] || []) handler(event)
    },
  }
}

const body = makeEl('body')
const dockNode = makeEl('div')
dockNode.className = 'ogu-dock'

const docStub = {
  head: makeEl('head'),
  body,
  baseURI: 'dsh-app://app/',
  visibilityState: 'visible',
  createElement: (tag) => makeEl(tag),
  createTextNode: (text) => ({ nodeValue: String(text), contains: () => false }),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
}

const winStub = {
  innerWidth: 1200,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
}

// ── React 桩件（effect 立即执行；第 4 个 useRef 视为 dockRef，挂上锚点）────────
const effects = []
const fetchCalls = []
const store = new Map()
let refCursor = 0
let dataReady = false

function makeReact() {
  return {
    Fragment: 'Fragment',
    createElement(type, props) {
      const flat = []
      const push = (value) => {
        if (value === null || value === undefined || value === false || value === true) return
        if (Array.isArray(value)) {
          value.forEach(push)
          return
        }
        flat.push(value)
      }
      for (let index = 2; index < arguments.length; index += 1) push(arguments[index])
      return { type, props: Object.assign({}, props || {}, { children: flat }) }
    },
    useState(init) {
      // useUsage 的首个 state 用 { phase: ... } 形状：第二遍渲染时让它进入 ready。
      if (init && typeof init === 'object' && typeof init.phase === 'string') {
        return [dataReady ? { phase: 'ready', data: payload, at: Date.now() } : init, () => {}]
      }
      return [typeof init === 'function' ? init() : init, () => {}]
    },
    useEffect(fn) {
      effects.push(fn())
    },
    useCallback(fn) {
      return fn
    },
    useRef(init) {
      refCursor += 1
      // 真实 React 在 effect 运行前就写好 ref：UsageDock 的 dockRef 是本次渲染第 4 个 ref。
      if (refCursor === 4) return { current: dockNode }
      return { current: init }
    },
  }
}

function mount(expanded) {
  effects.length = 0
  fetchCalls.length = 0
  store.clear()
  refCursor = 0
  body.children.length = 0
  if (expanded) store.set('dsh-opencode-go-usage:expanded', '1')

  let captured = null
  winStub.__ModuleLoader__ = {
    load(spec) {
      captured = spec
    },
  }
  winStub.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  }

  const code = fs.readFileSync(CLIENT, 'utf8')
  const sandboxRequire = (name) => {
    if (name === 'react') return makeReact()
    throw new Error('unexpected require: ' + name)
  }
  new Function('require', 'module', 'window', 'document', 'navigator', 'fetch', 'console', code)(
    sandboxRequire,
    { exports: {} },
    winStub,
    docStub,
    { language: 'zh-CN' },
    async (url) => {
      fetchCalls.push(String(url))
      return { ok: true, json: async () => payload }
    },
    { log() {}, error() {} },
  )

  const mod = captured.factory(sandboxRequire)
  let entry = null
  mod.apply({
    effect(fn) {
      fn()
    },
    get: () => undefined,
    slots: {
      inject(slot, fn) {
        fn()
      },
      register(config, component) {
        entry = { config, component }
      },
    },
  })
  // 每次渲染前重置 ref 计数：真实 React 每轮渲染都按同样顺序取用同一批 ref。
  return {
    config: entry.config,
    component(props) {
      refCursor = 0
      return entry.component(props)
    },
  }
}

function dump(node, depth) {
  const pad = '  '.repeat(depth || 0)
  const cls = node.className ? '.' + String(node.className).split(' ').join('.') : ''
  const text = node.textContent ? ' "' + node.textContent + '"' : ''
  console.log(pad + (node.tagName || '?') + cls + text)
  for (const child of node.children || []) {
    if (child === null || child === undefined) continue
    if (typeof child === 'string') console.log(pad + '  "' + child + '"')
    else if (child.nodeValue !== undefined) console.log(pad + '  #text "' + child.nodeValue + '"')
    else dump(child, depth + 1)
  }
}

// ── 收起 ────────────────────────────────────────────────────────────────────
const collapsed = mount(false)
const collapsedTree = collapsed.component({})
console.log('=== collapsed ===')
console.log('aria-expanded:', collapsedTree.props['aria-expanded'], '| data-expanded:', collapsedTree.props['data-expanded'])
console.log('body children:', body.children.length, '(expect 0)')
console.log('dock children tags:', collapsedTree.props.children.map((child) => child.type || typeof child).join(','))

// ── 展开 ────────────────────────────────────────────────────────────────────
const expanded = mount(true)
const expandedTree = expanded.component({})
dataReady = true
const expandedTree2 = expanded.component({})
console.log('\n=== expanded ===')
console.log('aria-expanded:', expandedTree.props['aria-expanded'], '| data-expanded:', expandedTree.props['data-expanded'])
console.log('dock ref is anchor:', Boolean(expandedTree.props.ref && expandedTree.props.ref.current === dockNode))
console.log('body children:', body.children.length, '(expect 1)')

const host = body.children[body.children.length - 1]
console.log('host className:', host && host.className)
console.log('host style:', host && JSON.stringify(host.style))
console.log('--- popover tree ---')
if (host) dump(host, 0)

setTimeout(() => {
  const popover = host && host.children[0]
  const button = popover && popover.children.find((child) => child && child.tagName === 'BUTTON')
  const before = fetchCalls.length
  if (button) {
    button.dispatch('click', { stopPropagation() {}, preventDefault() {} })
    console.log('\nrefresh click -> new fetch:', fetchCalls.length - before, '| url:', fetchCalls[fetchCalls.length - 1])
  } else {
    console.log('\n!! refresh button missing')
  }
  console.log('initial fetch url:', fetchCalls[0])
  for (const dispose of effects) {
    if (typeof dispose === 'function') {
      try {
        dispose()
      } catch (error) {
        console.log('dispose error:', String(error))
      }
    }
  }
  console.log('host removed after dispose:', host && host.isConnected === false)
  process.exit(0)
}, 20)



