/*
 * Factory Skill: discrete event simulation engine.
 *
 * Pure, deterministic (seeded) and renderer free. It runs in the browser and
 * in Node (scripts/check.mjs). Everything the HUD shows comes from here:
 * throughput, takt, utilization, WIP, lead time and the bottleneck.
 *
 * Model
 *   A factory is a tree of stations that flows into one sink (the last
 *   station). A station has `servers` identical machines that each process
 *   `batch` tokens per cycle. The cycle time is lognormal around `ct` with a
 *   coefficient of variation `cv`. Every edge into a station is a finite FIFO
 *   buffer of `buffer` tokens. A finished machine that cannot hand its output
 *   to a full buffer is BLOCKED (blocking after service). A station with
 *   several predecessors is an assembly join: it needs `batch` tokens from
 *   every input to start.
 *   Breakdowns are operation dependent: each machine fails after an
 *   exponential amount of BUSY time (mean `mtbf`) and is repaired after an
 *   exponential time (mean `mttr`); the interrupted cycle resumes.
 *   Units can be scrapped at a station with probability 1 - `yield`.
 *   The clock is production time: shifts * hoursPerShift per day, mapped back
 *   to a wall clock for display.
 *
 * Release
 *   'capacity': raw material is always there, the line runs as fast as its
 *               constraint allows (find the capacity and the bottleneck).
 *   'takt':     raw material is released at the demand rate.
 *
 * Bottleneck
 *   The station with the highest active fraction (busy + down, per machine)
 *   over a sliding window. In capacity mode that is the constraint; machines
 *   upstream of it block and machines downstream starve.
 */
;(function (root) {
  'use strict'
  const FS = (root.FactorySkill = root.FactorySkill || {})

  /* ------------------------------------------------------------ random */
  function mulberry32(seed) {
    let a = seed >>> 0
    return function () {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function normal(r) {
    let u = 0, v = 0
    while (u === 0) u = r()
    while (v === 0) v = r()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  function lognormal(r, mean, cv) {
    if (!(cv > 0)) return mean
    const s2 = Math.log(1 + cv * cv)
    return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * normal(r))
  }
  function expo(r, mean) { return -Math.log(1 - r()) * mean }

  /* -------------------------------------------------------------- heap */
  class Heap {
    constructor() { this.a = [] }
    get size() { return this.a.length }
    peek() { return this.a[0] }
    push(e) {
      const a = this.a
      a.push(e)
      let i = a.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (less(a[p], a[i])) break
        ;[a[p], a[i]] = [a[i], a[p]]
        i = p
      }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop()
      if (a.length) {
        a[0] = last
        let i = 0
        for (;;) {
          const l = 2 * i + 1, r = l + 1
          let m = i
          if (l < a.length && less(a[l], a[m])) m = l
          if (r < a.length && less(a[r], a[m])) m = r
          if (m === i) break
          ;[a[m], a[i]] = [a[i], a[m]]
          i = m
        }
      }
      return top
    }
  }
  const less = (x, y) => x.t < y.t || (x.t === y.t && x.seq < y.seq)

  /* -------------------------------------------------------------- plan */
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)

  /**
   * Normalise a spec and size every station from demand:
   *   machines = CEIL(rate_in * ct / (batch * A * targetUtil))
   * where rate_in is the token rate the station must START (demand divided by
   * the yield of this and every downstream station) and A = MTBF/(MTBF+MTTR).
   */
  FS.plan = function plan(spec) {
    const cal = Object.assign({ shifts: 2, hoursPerShift: 8, startHour: 6 }, spec.calendar || {})
    const daySec = cal.shifts * cal.hoursPerShift * 3600
    const perToken = num(spec.product && spec.product.perToken, 1)
    const d = spec.demand || {}
    const perDay = d.perDay != null ? d.perDay : d.perHour != null ? d.perHour * daySec / 3600 : d.perWeek != null ? d.perWeek / 5 : 1000
    const targetUtil = num(spec.sizing && spec.sizing.targetUtil, 0.85)
    const tokRate = perDay / perToken / daySec // tokens per production second
    const byId = {}
    const stations = spec.stations.map((s, i) => {
      const st = Object.assign({ cv: 0.1, batch: 1, buffer: 6, yield: 1, after: null, servers: 'auto' }, s)
      st.index = i
      // a station that names raw `input` starts a branch; otherwise it follows the previous station
      if (!st.after) st.after = i === 0 || s.input ? [] : [spec.stations[i - 1].id]
      if (!Array.isArray(st.after)) st.after = [st.after]
      st.mtbf = num(st.mtbf, 0)
      st.mttr = num(st.mttr, 0)
      st.A = st.mtbf > 0 && st.mttr > 0 ? st.mtbf / (st.mtbf + st.mttr) : 1
      byId[st.id] = st
      return st
    })
    for (const st of stations) {
      for (const p of st.after) if (!byId[p]) throw new Error(`station ${st.id}: unknown predecessor ${p}`)
      st.succ = null
    }
    for (const st of stations) for (const p of st.after) {
      if (byId[p].succ) throw new Error(`station ${p} feeds two stations; the model is a tree into one sink`)
      byId[p].succ = st.id
    }
    const sinks = stations.filter((s) => !s.succ)
    if (sinks.length !== 1) throw new Error(`need exactly one last station, found ${sinks.map((s) => s.id).join(', ')}`)
    const sink = sinks[0]
    // yield chain: rate a station must start = demand / product of yields from it to the sink
    for (const st of stations) {
      let y = 1, c = st
      while (c) { y *= c.yield; c = c.succ ? byId[c.succ] : null }
      st.rateIn = tokRate / y
      st.need = st.rateIn * st.ct / st.batch / st.A // machines at 100 %
      st.autoServers = Math.max(1, Math.ceil(st.need / targetUtil - 1e-9))
      // a continuous machine (tunnel oven, spiral, formation rack) holds perMachine units: whole machines only
      const pm = Math.max(1, st.perMachine || 1)
      const slotsNeeded = st.autoServers
      if (pm > 1) st.autoServers = Math.ceil(st.autoServers / pm) * pm
      st.servers = st.servers === 'auto' || st.servers == null ? st.autoServers : Math.max(1, Math.round(st.servers))
      st.sizing = `CEIL(${fmt(st.rateIn * daySec * perToken)} ${spec.product && spec.product.unit || 'units'}/day x ${fmt(st.ct)} s / (${fmt(daySec)} s x ${st.batch > 1 ? st.batch + ' per batch x ' : ''}${st.A < 1 ? st.A.toFixed(2) + ' avail x ' : ''}${targetUtil}${perToken > 1 ? ' x ' + perToken + ' per token' : ''})) = ${pm > 1 ? `${slotsNeeded} places = ${st.autoServers / pm} machines of ${pm}` : st.autoServers}`
    }
    // depth from sources, for layout
    const depth = {}
    const dep = (st) => depth[st.id] != null ? depth[st.id] : (depth[st.id] = st.after.length ? 1 + Math.max(...st.after.map((p) => dep(byId[p]))) : 0)
    stations.forEach(dep)
    for (const st of stations) st.depth = depth[st.id]
    // longest raw processing path (seconds): how long an empty line takes to fill
    const path = {}
    const pt = (st) => path[st.id] != null ? path[st.id] : (path[st.id] = st.ct + (st.after.length ? Math.max(...st.after.map((p) => pt(byId[p]))) : 0))
    const pathCT = Math.max(...stations.map(pt))
    return {
      spec, stations, byId, sink: sink.id, pathCT, daySec, perDay, perToken, tokRate, targetUtil, cal,
      taktToken: 1 / tokRate, // production seconds per token
      takt: daySec / perDay, // production seconds per unit
      release: spec.release || 'capacity',
      seed: num(spec.seed, 7),
    }
  }

  function fmt(v) {
    if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('en-US')
    if (Math.abs(v) >= 100) return String(Math.round(v))
    if (Math.abs(v) >= 10) return v.toFixed(1).replace(/\.0$/, '')
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  }
  FS.fmt = fmt

  /* --------------------------------------------------------------- sim */
  const STATES = ['busy', 'blocked', 'idle', 'down']

  class Sim {
    constructor(plan, opts = {}) {
      this.plan = plan
      this.r = mulberry32(opts.seed != null ? opts.seed : plan.seed)
      this.t = 0
      this.seq = 0
      this.q = new Heap()
      this.jobSeq = 0
      this.shipped = 0
      this.scrapped = 0
      this.started = 0
      this.release = opts.release || plan.release
      this.windowSec = opts.windowSec || 4 * 3600
      this.snapEvery = opts.snapEvery || 300
      this.snaps = []
      this.leadEw = 0
      this.leadN = 0
      this.pending = new Set()
      this.st = {}
      this.list = plan.stations.map((d) => {
        const s = {
          def: d, id: d.id, ct: d.ct, cv: d.cv, batch: d.batch, cap: d.buffer, yield: d.yield,
          mtbf: d.mtbf, mttr: d.mttr, succ: d.succ, after: d.after.slice(),
          inputs: {}, servers: [], failures: 0, done: 0, scrap: 0,
          acc: { busy: 0, blocked: 0, idle: 0, down: 0 }, // closed totals of removed servers
        }
        if (d.after.length) for (const p of d.after) s.inputs[p] = []
        else s.inputs.$src = []
        this.st[d.id] = s
        for (let i = 0; i < d.servers; i++) this._addServer(s)
        return s
      })
      this.sink = this.st[plan.sink]
      this.sources = this.list.filter((s) => !s.after.length)
      this.releaseInterval = plan.taktToken
      if (this.release === 'takt') for (const s of this.sources) this._at(0, () => this._release(s))
      this._at(0, () => this._snap())
      for (const s of this.list) this._kick(s)
      this._flush()
    }

    /* ---- scheduling */
    _at(t, fn) { this.q.push({ t, seq: this.seq++, fn }) }
    _addServer(s) {
      const sv = { st: s, i: s.servers.length, state: 'idle', since: this.t, acc: { busy: 0, blocked: 0, idle: 0, down: 0 }, jobs: [], out: [], ttf: s.mtbf > 0 ? expo(this.r, s.mtbf) : Infinity, cycle: 0, done: 0, segStart: 0, gen: 0, retire: false, born: this.t }
      s.servers.push(sv)
      return sv
    }
    _set(sv, state) {
      const now = this.t
      sv.acc[sv.state] += now - sv.since
      sv.since = now
      sv.state = state
    }

    /* ---- release (takt mode) */
    _release(s) {
      s.inputs.$src.push(this._job())
      this._kick(s)
      this._flush()
      this._at(this.t + this.releaseInterval, () => this._release(s))
    }
    _job() { return { id: ++this.jobSeq, born: -1, stage: null, parts: 0 } }

    /* ---- the agenda: hand blocked output on, then start what can start */
    _kick(s) { if (s) this.pending.add(s) }
    _flush() {
      let guard = 0
      while (this.pending.size) {
        const s = this.pending.values().next().value
        this.pending.delete(s)
        this._unblock(s)
        this._tryStart(s)
        if (++guard > 1e6) throw new Error('agenda did not settle')
      }
    }
    _unblock(s) {
      const blocked = s.servers.filter((sv) => sv.state === 'blocked').sort((a, b) => a.since - b.since)
      for (const sv of blocked) this._push(sv)
    }
    _tryStart(s) {
      for (const sv of s.servers) {
        if (sv.state !== 'idle' || sv.retire) continue
        // every input must hold a full batch
        const keys = Object.keys(s.inputs)
        const cap = this.release === 'capacity' && keys[0] === '$src'
        if (!cap && !keys.every((k) => s.inputs[k].length >= s.batch)) break
        const jobs = []
        for (let b = 0; b < s.batch; b++) {
          let main = null, parts = 0
          for (const k of keys) {
            const j = cap ? this._job() : s.inputs[k].shift()
            if (!main) main = j
            else parts += 1 + (j.parts || 0)
          }
          main.parts += parts
          if (main.born < 0) { main.born = this.t; this.started++ }
          jobs.push(main)
        }
        for (const k of keys) if (k !== '$src') this._kick(this.st[k])
        sv.jobs = jobs
        sv.gen++
        this._set(sv, 'busy')
        sv.cycle = lognormal(this.r, s.ct, s.cv)
        sv.done = 0
        this._work(sv, sv.cycle)
      }
    }
    _work(sv, dur) {
      const s = sv.st, gen = sv.gen
      sv.segStart = this.t
      if (sv.ttf <= dur) {
        const fail = sv.ttf
        sv.remaining = dur - fail
        sv.ttf = 0
        this._at(this.t + fail, () => { if (sv.gen === gen) this._fail(sv, fail) })
      } else {
        sv.ttf -= dur
        this._at(this.t + dur, () => { if (sv.gen === gen) this._finish(sv) })
      }
    }
    _fail(sv, worked) {
      const s = sv.st
      sv.done += worked
      s.failures++
      this._set(sv, 'down')
      sv.downUntil = this.t + expo(this.r, s.mttr)
      const gen = sv.gen
      this._at(sv.downUntil, () => {
        if (sv.gen !== gen) return
        sv.ttf = expo(this.r, s.mtbf)
        this._set(sv, 'busy')
        this._work(sv, sv.remaining)
        this._flush()
      })
      this._flush()
    }
    _finish(sv) {
      const s = sv.st
      sv.done = sv.cycle
      const out = []
      for (const j of sv.jobs) {
        if (s.yield < 1 && this.r() > s.yield) { s.scrap++; this.scrapped++; continue }
        j.stage = s.id
        out.push(j)
      }
      s.done += sv.jobs.length
      sv.jobs = []
      sv.out = out
      this._set(sv, 'blocked')
      this._push(sv)
      this._flush()
    }
    _push(sv) {
      const s = sv.st
      if (!s.succ) {
        for (const j of sv.out) {
          this.shipped++
          const lt = this.t - j.born
          this.leadN++
          this.leadEw = this.leadN === 1 ? lt : this.leadEw + (lt - this.leadEw) * 0.02
        }
        sv.out = []
      } else {
        const nx = this.st[s.succ], qq = nx.inputs[s.id]
        while (sv.out.length && qq.length < nx.cap) qq.push(sv.out.shift())
        this._kick(nx)
      }
      if (!sv.out.length) {
        this._set(sv, 'idle')
        if (sv.retire) this._dropServer(sv)
        else this._kick(s)
      }
    }
    _dropServer(sv) {
      const s = sv.st
      this._set(sv, 'idle')
      for (const k of STATES) s.acc[k] += sv.acc[k]
      sv.gen++
      s.servers.splice(s.servers.indexOf(sv), 1)
      s.servers.forEach((x, i) => (x.i = i))
    }

    /* ---- running */
    runUntil(t) {
      while (this.q.size && this.q.peek().t <= t) {
        const e = this.q.pop()
        this.t = e.t
        e.fn()
      }
      this.t = t
    }
    step(dt) { this.runUntil(this.t + dt) }
    _snap() {
      const snap = { t: this.t, shipped: this.shipped, st: {} }
      for (const s of this.list) snap.st[s.id] = this.totals(s)
      this.snaps.push(snap)
      const keep = Math.ceil((24 * 3600) / this.snapEvery) + 2
      if (this.snaps.length > keep) this.snaps.shift()
      this._at(this.t + this.snapEvery, () => this._snap())
    }

    /* ---- measurement */
    totals(s) {
      const a = { busy: s.acc.busy, blocked: s.acc.blocked, idle: s.acc.idle, down: s.acc.down, n: 0 }
      for (const sv of s.servers) {
        for (const k of STATES) a[k] += sv.acc[k]
        a[sv.state] += this.t - sv.since
      }
      a.n = s.servers.length
      return a
    }
    /** the snapshot at least `w` seconds old (or the oldest) */
    _base(w) {
      const want = this.t - w
      let b = this.snaps[0]
      for (const sn of this.snaps) { if (sn.t <= want) b = sn; else break }
      return b
    }
    /** per station state fractions over the window (or since the last reset) */
    window(w = this.windowSec) {
      const b = this._base(w)
      const span = Math.max(1e-9, this.t - b.t)
      const res = {}
      for (const s of this.list) {
        const now = this.totals(s), was = b.st[s.id] || { busy: 0, blocked: 0, idle: 0, down: 0 }
        const tot = STATES.reduce((x, k) => x + (now[k] - was[k]), 0) || 1e-9
        const f = {}
        for (const k of STATES) f[k] = Math.max(0, (now[k] - was[k]) / tot)
        // idle in a line that has work upstream is starvation
        f.starved = f.idle
        f.active = f.busy + f.down
        f.util = f.busy
        res[s.id] = f
      }
      return { span, shipped: this.shipped - b.shipped, st: res }
    }
    /** units per production day over the window */
    perDay(w = this.windowSec) {
      const b = this._base(w)
      const span = this.t - b.t
      if (span < 60) return 0
      return ((this.shipped - b.shipped) / span) * this.plan.daySec * this.plan.perToken
    }
    bottleneck(w = this.windowSec) {
      const win = this.window(w)
      let best = null, bv = -1
      for (const s of this.list) {
        const v = win.st[s.id].active
        if (v > bv + 1e-6) { bv = v; best = s.id }
      }
      return { id: best, active: bv, win }
    }
    wip() {
      let n = 0
      for (const s of this.list) {
        for (const k in s.inputs) if (k !== '$src') n += s.inputs[k].length
        for (const sv of s.servers) n += sv.jobs.length + sv.out.length
      }
      return n
    }
    /** wall clock of the production clock */
    clock() {
      const c = this.plan.cal, day = Math.floor(this.t / this.plan.daySec), off = this.t - day * this.plan.daySec
      const h = c.startHour + off / 3600
      const shift = Math.min(c.shifts - 1, Math.floor(off / (c.hoursPerShift * 3600)))
      return { day: day + 1, hh: Math.floor(h) % 24, mm: Math.floor((h * 60) % 60), shift: 'ABC'[shift] || String(shift + 1) }
    }
    /** progress 0..1 of a machine's current cycle */
    progress(sv) {
      if (sv.state === 'busy') return Math.min(1, (sv.done + (this.t - sv.segStart)) / (sv.cycle || 1))
      if (sv.state === 'down') return Math.min(1, sv.done / (sv.cycle || 1))
      return sv.state === 'blocked' ? 1 : 0
    }

    /* ---- what-if, applied live */
    setServers(id, n) {
      const s = this.st[id]
      n = Math.max(1, Math.round(n))
      for (const sv of s.servers) if (sv.retire && s.servers.filter((x) => !x.retire).length < n) sv.retire = false
      let live = s.servers.filter((x) => !x.retire).length
      while (live < n) { this._addServer(s); live++ }
      while (live > n) {
        const idle = s.servers.find((x) => !x.retire && x.state === 'idle')
        const sv = idle || [...s.servers].reverse().find((x) => !x.retire)
        if (sv.state === 'idle') this._dropServer(sv)
        else sv.retire = true
        live--
      }
      this._kick(s)
      this._flush()
    }
    setCT(id, ct) { this.st[id].ct = Math.max(0.01, ct) }
    setBuffer(id, cap) {
      const s = this.st[id]
      s.cap = Math.max(1, Math.round(cap))
      for (const p of s.after) this._kick(this.st[p])
      this._flush()
    }
    setRelease(mode) {
      if (mode === this.release) return
      this.release = mode
      if (mode === 'takt') for (const s of this.sources) this._at(this.t, () => this._release(s))
    }
    /** forget the measurement window, so the HUD shows the new line quickly */
    resetWindow() {
      this.snaps = [{ t: this.t, shipped: this.shipped, st: Object.fromEntries(this.list.map((s) => [s.id, this.totals(s)])) }]
    }
    /** the current parameters as overrides for a forecast */
    overrides() {
      const o = {}
      for (const s of this.list) o[s.id] = { servers: s.servers.filter((x) => !x.retire).length, ct: s.ct, buffer: s.cap }
      return o
    }
  }
  FS.Sim = Sim

  /**
   * Run a fresh simulation for `days` production days (after `warm` days of
   * warm up) with optional per station overrides and return the result.
   * This is what the inspector's "forecast" line and scripts/check.mjs use.
   */
  FS.forecast = function forecast(plan, over = {}, opts = {}) {
    const days = opts.days || 5, warm = Math.max(opts.warm != null ? opts.warm : 0.5, (plan.pathCT * 2.5) / plan.daySec)
    const p = Object.assign({}, plan, {
      stations: plan.stations.map((d) => Object.assign({}, d, over[d.id] || {})),
    })
    const sim = new Sim(p, { seed: opts.seed != null ? opts.seed : plan.seed, release: opts.release, snapEvery: 600 })
    sim.runUntil(warm * plan.daySec)
    sim.resetWindow()
    const t0 = sim.t, s0 = sim.shipped, scrap0 = sim.scrapped
    sim.runUntil(t0 + days * plan.daySec)
    const span = sim.t - t0
    const w = sim.window(span + 1)
    const bn = sim.bottleneck(span + 1)
    return {
      perDay: ((sim.shipped - s0) / span) * plan.daySec * plan.perToken,
      scrapPerDay: ((sim.scrapped - scrap0) / span) * plan.daySec * plan.perToken,
      bottleneck: bn.id,
      st: w.st,
      servers: Object.fromEntries(sim.list.map((s) => [s.id, s.servers.length])),
      wip: sim.wip(),
      leadTime: sim.leadEw,
      failures: Object.fromEntries(sim.list.map((s) => [s.id, s.failures])),
      days,
    }
  }

  FS.rng = mulberry32
  FS.lognormal = lognormal
})(typeof globalThis !== 'undefined' ? globalThis : window)
