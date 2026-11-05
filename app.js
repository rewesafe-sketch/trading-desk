/* Grok Bot trading desk — plan B. Data from R2 (or same-origin on localhost). No secrets. */
(function () {
  'use strict';

  const ASSET_V = '4';
  const R2_PUBLIC = 'https://pub-67fc5fdcfd5b42d7a94ba3a2ed6cf5ae.r2.dev';
  const POLL_MS = 15000;
  const LS_PATH = 'desk_data_path';
  const LS_UNREAD = 'desk_unread_pushes';

  const state = {
    path: null,
    dataBase: null,
    state: null,
    chart: null,
    activity: null,
    account: null,
    events: null,
    agents: {},
    range: 'LIVE',
    tab: 'home',
    lastOkAt: null,
    offline: false,
    retryIn: 5,
    search: '',
  };

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  function isLocalHost() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
  }

  /** Resolve DATA_PATH from the page URL only. Never restore a stored path. */
  function resolvePath() {
    const parts = location.pathname.split('/').filter(Boolean);
    // expect …/trading-desk/d/<path>/ or …/d/<path>/
    const di = parts.indexOf('d');
    if (di >= 0 && parts[di + 1] && parts[di + 1] !== '__PATH__') {
      return parts[di + 1];
    }
    const hash = new URLSearchParams((location.hash || '').replace(/^#/, ''));
    if (hash.get('d')) return hash.get('d');
    return null;
  }

  function persistPath(p) {
    try { localStorage.setItem(LS_PATH, p); } catch (_) {}
  }

  function dataBaseFor(path) {
    if (isLocalHost()) {
      // same-origin mirror for proof / local
      return `${location.origin}/d/${path}/`;
    }
    return `${R2_PUBLIC}/d/${path}/`;
  }

  async function fetchJson(rel) {
    const url = state.dataBase + rel.replace(/^\//, '');
    const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  function fmtMoney(n) {
    if (n == null || Number.isNaN(n)) return '—';
    const abs = Math.abs(n);
    const s = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-$' : '$') + s;
  }

  function fmtPct(n, signed) {
    if (n == null || Number.isNaN(n)) return '—';
    const s = Math.abs(n).toFixed(2) + '%';
    if (!signed) return s;
    return (n >= 0 ? '+' : '−') + s;
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }

  function setOdometer(el, value) {
    if (!el) return;
    const text = fmtMoney(value);
    if (window.DeskCharts && DeskCharts.prefersReduced()) {
      el.textContent = text;
      return;
    }
    // simple digit roll: replace content with spans
    const prev = el.dataset.v || '';
    el.dataset.v = text;
    if (prev === text) { el.textContent = text; return; }
    el.textContent = '';
    const chars = text.split('');
    chars.forEach((ch, i) => {
      if (!/[0-9]/.test(ch)) {
        el.appendChild(document.createTextNode(ch));
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'odometer-digit';
      const inner = document.createElement('span');
      inner.textContent = ch;
      const delay = (chars.length - i) * 30;
      inner.style.transitionDelay = delay + 'ms';
      wrap.appendChild(inner);
      el.appendChild(wrap);
      requestAnimationFrame(() => {
        inner.style.transform = 'translateY(0)';
      });
    });
  }

  function showError(show) {
    const bar = $('#error-bar');
    if (!bar) return;
    if (!show) { bar.classList.remove('show'); return; }
    const t = state.lastOkAt ? fmtTime(state.lastOkAt) : '—';
    bar.textContent = `Desk offline · retrying in ${state.retryIn}s · last update ${t}`;
    bar.classList.add('show');
  }

  function paperBadge(on) {
    $$('.paper-pill').forEach((el) => el.classList.toggle('hidden', !on));
  }

  /* ---------- renderers ---------- */

  function renderHome() {
    const s = state.state;
    if (!s) return;
    paperBadge(s.mode === 'PAPER');
    setOdometer($('#balance-odometer'), s.balance);
    const today = $('#today-pct');
    if (today) {
      today.textContent = fmtPct(s.today_pct, true);
      today.className = 'tabular ' + (s.today_pct >= 0 ? 'today-up' : 'today-down');
    }
    const mult = $('#mult-pill');
    if (mult) mult.textContent = (s.multiplier != null ? Number(s.multiplier).toFixed(2) : '—') + '×';

    const chartEmpty = $('#chart-empty');
    const pts = (state.chart && state.chart.points) || [];
    if (chartEmpty) chartEmpty.style.display = pts.length ? 'none' : 'flex';
    if (window.DeskCharts) {
      DeskCharts.drawHomeLine($('#home-chart'), {
        points: pts,
        marks: (state.chart && state.chart.marks) || [],
        startValue: state.chart ? state.chart.start_value : s.balance,
      });
    }

    // agent carousel
    const car = $('#agent-carousel');
    if (car && s.agents) {
      car.innerHTML = '';
      ['scanner', 'auditor', 'analyst', 'executor', 'risk'].forEach((name) => {
        car.appendChild(buildAgentCard(name, s.agents[name], s.settings || {}));
      });
    }

    // activity preview
    const list = $('#home-activity');
    if (list) {
      const rows = ((state.activity && state.activity.rows) || []).slice(0, 5);
      list.innerHTML = '';
      if (!rows.length) {
        list.innerHTML = '<div class="empty-note">Nothing yet tonight</div>';
      } else {
        rows.forEach((r) => list.appendChild(buildActRow(r)));
      }
    }

    const running = Object.values(s.paused || {}).filter((p) => !p).length;
    const ah = $('#agents-heading');
    if (ah) ah.textContent = `Agents · ${running || 5} running`;
  }

  function buildAgentCard(name, a, settings) {
    a = a || {};
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'agent-card';
    el.dataset.agent = name;
    const accent = a.color || '#64d2ff';
    let body = '';
    if (name === 'scanner') {
      const feed = (a.feed || []).slice(0, 6).map((f) => {
        const killed = f.verdict === 'kill';
        return `<div class="feed-row ${killed ? 'killed' : ''}"><span class="feed-name">${esc(f.text || f.name || '')}</span>` +
          (killed ? `<span class="feed-reason">${esc(f.reason || '')}</span>` : '') + `</div>`;
      }).join('') || `<div class="empty-note">Listening for graduations</div>`;
      body = `<div class="ac-feed">${feed}</div>`;
    } else if (name === 'auditor') {
      const strips = [];
      for (let i = 1; i <= 8; i++) {
        const L = (a.layers || []).find((x) => x.n === i);
        let cls = 'pending';
        if (L && L.pass === true) cls = 'pass';
        if (L && L.pass === false) cls = 'fail';
        strips.push(`<div class="layer-strip ${cls}"></div>`);
      }
      body = `<div class="layer-grid">${strips.join('')}</div>
        <div style="color:var(--secondary);font-size:13px">${esc(a.status_text || 'idle')}</div>
        <div style="color:var(--secondary);font-size:13px">${a.rejected || 0} rejected</div>`;
    } else if (name === 'analyst') {
      body = `<div class="score-ring-wrap"><canvas id="score-ring-home" width="120" height="120"></canvas></div>`;
    } else if (name === 'executor') {
      const pct = (a.bar && a.bar.pct) || 0;
      body = `<div style="color:var(--secondary);font-size:14px">${esc(a.size_label || '')}</div>
        <div class="exec-bar"><span style="width:${pct}%"></span></div>
        <div style="font-size:13px;color:var(--secondary)">${esc((a.bar && a.bar.text) || '')}</div>`;
    } else if (name === 'risk') {
      const stop = (a.pills && a.pills.stop_text) || `stop -${(settings.stop_pct != null ? settings.stop_pct : 6)}%`;
      const trail = (a.pills && a.pills.trail_text) || `trail ${(settings.trail_pct != null ? settings.trail_pct : 12)}%`;
      body = `<div style="color:var(--secondary);font-size:14px">${esc(a.last_exit || '')}</div>
        <div class="risk-pills"><span class="pill pill-stop">${esc(stop)}</span><span class="pill pill-trail">${esc(trail)}</span></div>`;
    }
    el.innerHTML = `
      <div class="ac-top"><span class="ac-name">${esc(a.name || name)}</span><span class="ac-accent" style="background:${accent}"></span></div>
      <div class="ac-label">${esc(a.label || '')}</div>
      ${body}`;
    el.addEventListener('click', () => openAgentsTab(name));
    if (name === 'analyst') {
      requestAnimationFrame(() => {
        const c = el.querySelector('canvas');
        if (c && window.DeskCharts) DeskCharts.drawScoreRing(c, a.score, a.ring_green_from || 70);
      });
    }
    return el;
  }

  function buildActRow(r) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'act-row';
    btn.innerHTML = `<div class="act-main"><div class="act-title">${esc(r.title || '')}</div>
      <div class="act-sub">${esc(r.subtitle || '')}</div></div>
      <div class="act-val tabular">${esc(r.value || '')}</div>`;
    btn.addEventListener('click', () => {
      if (!r.mint) return;
      if (r.kind === 'rejected') openAudit(r.mint);
      else openCoin(r.mint);
    });
    return btn;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderAgents() {
    const root = $('#agents-list');
    if (!root || !state.state) return;
    root.innerHTML = '';
    const order = ['scanner', 'auditor', 'analyst', 'executor', 'risk'];
    const paused = state.state.paused || {};
    const cards = state.state.agents || {};
    const riskLocked = cards.risk && cards.risk.pause_locked;
    order.forEach((name) => {
      const a = cards[name] || {};
      const dec = (state.agents[name] && state.agents[name].decisions) || [];
      const card = document.createElement('div');
      card.className = 'agent-full';
      card.id = 'agent-full-' + name;
      const isPaused = !!paused[name];
      const lock = name === 'risk' && riskLocked;
      card.innerHTML = `
        <div class="af-head">
          <span class="status-dot ${isPaused ? 'paused' : ''}"></span>
          <strong style="flex:1">${esc(a.name || name)}</strong>
          <span class="tabular" style="color:var(--secondary)">${a.today_count != null ? a.today_count : 0} today</span>
          <div class="switch ${isPaused ? '' : 'on'} ${lock ? 'locked' : ''}" title="Change via Telegram" data-readonly="1"></div>
        </div>
        <div class="af-decisions"></div>
        <button type="button" class="link af-settings" data-agent="${name}" style="color:var(--blue);font-size:14px;min-height:44px">Settings</button>
        <div class="af-note">Pause / resume via Telegram on plan B</div>`;
      const box = card.querySelector('.af-decisions');
      if (!dec.length) {
        box.innerHTML = '<div class="empty-note" style="padding:8px 0;text-align:left">No decisions yet</div>';
      } else {
        dec.slice(0, 20).forEach((d) => {
          const row = document.createElement('div');
          row.className = 'decision-row';
          const href = d.coin_url || '#';
          row.innerHTML = `<span class="tabular" style="color:var(--tertiary)">${esc(fmtTime(d.ts))}</span>
            <a href="${esc(href)}" target="_blank" rel="noopener">${esc(d.coin || d.mint || '')}</a>
            <span>${esc(d.verdict || '')}</span>
            <span style="color:var(--secondary);flex:1">${esc(d.reason || '')}</span>`;
          box.appendChild(row);
        });
      }
      card.querySelector('.af-settings').addEventListener('click', () => {
        switchTab('account');
        const g = document.getElementById('settings-' + name);
        if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      root.appendChild(card);
    });
  }

  function renderActivity() {
    const list = $('#activity-list');
    if (!list) return;
    const rows = (state.activity && state.activity.rows) || [];
    list.innerHTML = '';
    if (!rows.length) {
      list.innerHTML = '<div class="empty-note">Nothing yet tonight</div>';
      return;
    }
    rows.forEach((r) => list.appendChild(buildActRow(r)));
  }

  function renderAccount() {
    const a = state.account;
    if (!a) return;
    paperBadge(a.mode === 'PAPER');
    const mode = $('#acct-mode');
    if (mode) {
      mode.innerHTML = `<span class="${a.mode === 'PAPER' ? 'on' : ''}">PAPER</span><span class="${a.mode === 'LIVE' ? 'on' : ''}">LIVE</span>`;
    }
    const stack = $('#acct-stack');
    if (stack) stack.textContent = fmtMoney(a.stack);
    const profile = $('#acct-profile');
    if (profile) {
      profile.href = a.profile_url || '#';
      profile.querySelector('.value').textContent = a.fomo_handle ? '@' + a.fomo_handle : '—';
    }
    const invite = $('#acct-invite');
    if (invite) invite.dataset.url = a.signup_url || '';
    const tg = $('#acct-telegram');
    if (tg) tg.textContent = a.telegram_connected ? 'Connected' : 'Not connected';
    const note = $('#web-push-note');
    if (note) note.textContent = a.web_push_note || 'web push not available on plan B, Telegram only';
    const planNote = $('#planb-settings-note');
    if (planNote) planNote.textContent = 'Settings are read-only here. Change them via Telegram.';

    const root = $('#settings-groups');
    if (root && a.settings) {
      root.innerHTML = '';
      Object.keys(a.settings).forEach((group) => {
        const wrap = document.createElement('div');
        wrap.className = 'settings-group';
        wrap.id = 'settings-' + group;
        wrap.innerHTML = `<h3>${esc(group)}</h3>`;
        const entries = a.settings[group] || {};
        Object.keys(entries).forEach((k) => {
          const row = document.createElement('div');
          row.className = 'set-row';
          const short = k.indexOf('.') >= 0 ? k.slice(k.indexOf('.') + 1) : k;
          row.innerHTML = `<span class="sk">${esc(short)}</span><span class="sv mono">${esc(String(entries[k]))}</span>`;
          wrap.appendChild(row);
        });
        root.appendChild(wrap);
      });
    }
  }

  async function openCoin(mint) {
    const ov = $('#coin-overlay');
    ov.classList.add('open');
    ov.dataset.mint = mint;
    $('#coin-body').innerHTML = '<div class="skel" style="height:200px;margin:16px"></div>';
    try {
      const coin = await fetchJson(`coin/${mint}.json`);
      paintCoin(coin);
    } catch (e) {
      $('#coin-body').innerHTML = '<div class="empty-note">Could not load coin</div>';
    }
  }

  function paintCoin(coin) {
    const body = $('#coin-body');
    const age = coin.age_min != null ? (coin.age_min >= 60 ? Math.floor(coin.age_min / 60) + 'h old' : coin.age_min + 'm old') : '';
    const pnl = coin.pnl_pct_since_entry;
    const pnlHtml = pnl == null ? '' :
      `<div class="coin-pnl ${pnl >= 0 ? 'today-up' : 'today-down'}">${pnl >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(pnl), false)} since entry</div>`;
    const st = coin.stats || {};
    const pos = coin.position;
    const exitHtml = pos ? `
      <div class="exit-card">
        <h4>Your position · ${fmtMoney(pos.size_usd)} in · Executor</h4>
        <div class="exit-line"><span>Stop line</span><strong class="tabular">${pos.stop_line != null ? pos.stop_line.toPrecision(6) : '—'}</strong></div>
        <div class="exit-line"><span>Trail line</span><strong class="tabular">${pos.trail_line != null ? pos.trail_line.toPrecision(6) : '—'}</strong></div>
        <div class="exit-line"><span>Timeout left</span><strong class="tabular">${pos.timeout_left_s != null ? Math.round(pos.timeout_left_s / 60) + 'm' : '—'}</strong></div>
      </div>` : '';
    const fomoLabel = pos ? 'Sell on FOMO' : 'Buy on FOMO';
    const fomoHref = coin.coin_url || '#';
    body.innerHTML = `
      <div class="screen-scroll">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:22px;font-weight:700">${esc(coin.name || coin.symbol || coin.mint)}</div>
          <span class="paper-pill ${state.state && state.state.mode === 'PAPER' ? '' : 'hidden'}">PAPER</span>
          ${coin.shield ? `<span class="shield-chip">${esc(coin.shield)}</span>` : ''}
        </div>
        <div class="coin-meta">${esc(coin.symbol || '')} · ${esc(coin.chain || 'Solana')} · ${esc(age)}</div>
        <div class="coin-price tabular">${coin.price != null ? Number(coin.price).toPrecision(6) : '—'}</div>
        ${pnlHtml}
        <div class="candle-wrap"><canvas id="coin-candles"></canvas></div>
        <div class="stats-grid">
          <div class="stat"><div class="sl">Market cap</div><div class="sv">${st.market_cap != null ? fmtMoney(st.market_cap) : 'n/a'}</div></div>
          <div class="stat"><div class="sl">Liquidity</div><div class="sv">${st.liquidity_usd != null ? fmtMoney(st.liquidity_usd) : 'n/a'}</div></div>
          <div class="stat"><div class="sl">24h volume</div><div class="sv">${st.volume_h24 != null ? fmtMoney(st.volume_h24) : 'n/a'}</div></div>
          <div class="stat"><div class="sl">Holders</div><div class="sv">${st.holders != null ? st.holders : 'n/a'}</div></div>
        </div>
        ${exitHtml}
        <a class="fomo-btn" href="${esc(fomoHref)}" target="_blank" rel="noopener">${esc(fomoLabel)}</a>
      </div>`;
    requestAnimationFrame(() => {
      const c = $('#coin-candles');
      if (c && window.DeskCharts) {
        DeskCharts.drawCandles(c, {
          candles: coin.candles || [],
          exitLine: pos ? pos.exit_line : null,
        });
      }
    });
  }

  async function openAudit(mint) {
    const ov = $('#audit-overlay');
    ov.classList.add('open');
    $('#audit-body').innerHTML = '<div class="skel" style="height:200px;margin:16px"></div>';
    try {
      const audit = await fetchJson(`audit/${mint}.json`);
      await paintAudit(audit);
    } catch (e) {
      $('#audit-body').innerHTML = '<div class="empty-note">No coin taken apart yet</div>';
    }
  }

  async function paintAudit(audit) {
    const body = $('#audit-body');
    const layers = audit.layers || [];
    const discs = layers.map((l, i) =>
      `<div class="disc" data-i="${i}" id="disc-${i}">${esc(l.name || ('Layer ' + l.n))}</div>`
    ).join('');
    const vals = layers.map((l) =>
      `<div class="audit-val-row"><span class="vn">${esc(l.name || '')}</span><span class="mono">${esc(l.not_checked ? 'not checked' : (l.value || ''))}</span></div>`
    ).join('');
    const enabled = state.state && state.state.settings && state.state.settings.auditor_enabled;
    body.innerHTML = `
      <div class="screen-scroll">
        <div style="font-size:20px;font-weight:700;margin-bottom:4px">${esc(audit.name || audit.mint)}</div>
        <div class="audit-discs" id="audit-discs">${discs}</div>
        <div class="audit-status">${esc(audit.status || '')}</div>
        <div class="audit-sub">${audit.passed ? 'Sent to Executor' : (audit.reason ? "Grok Bot won't buy " + esc(audit.name || '') : '')}</div>
        <div class="audit-values">${vals}</div>
        <div class="toggle-row"><span>Take apart before buying</span>
          <div class="switch ${enabled ? 'on' : ''}" title="Change via Telegram"></div>
        </div>
        <div class="af-note">Toggle via Telegram on plan B</div>
        <a class="fomo-btn" href="${esc(audit.coin_url || '#')}" target="_blank" rel="noopener">Open on FOMO</a>
      </div>`;
    // beam animation — only reveal results the server sent
    const reduced = window.DeskCharts && DeskCharts.prefersReduced();
    for (let i = 0; i < layers.length; i++) {
      const disc = document.getElementById('disc-' + i);
      if (!disc) continue;
      const L = layers[i];
      if (L.not_checked || L.pass == null) {
        disc.textContent = 'not checked';
        continue;
      }
      if (!reduced) {
        disc.classList.add('beam');
        await wait(350);
        disc.classList.remove('beam');
      }
      disc.classList.add(L.pass ? 'pass' : 'fail');
      disc.textContent = (L.pass ? '✓ ' : '✕ ') + (L.name || '');
      if (!reduced) await wait(150);
      // if fail, remaining stay not checked visually already
      if (!L.pass) break;
    }
  }

  function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function closeOverlays() {
    $$('.overlay-screen').forEach((el) => el.classList.remove('open'));
  }

  function switchTab(tab) {
    state.tab = tab;
    $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.tab === tab));
    $$('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    closeOverlays();
    if (tab === 'agents') renderAgents();
    if (tab === 'activity') renderActivity();
    if (tab === 'account') renderAccount();
    if (tab === 'home') renderHome();
  }

  function openAgentsTab(focus) {
    switchTab('agents');
    if (focus) {
      const el = document.getElementById('agent-full-' + focus);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------- polling ---------- */

  async function refreshAll() {
    try {
      const [st, ch, act, acct, ev] = await Promise.all([
        fetchJson('state.json'),
        fetchJson(`chart/${state.range}.json`),
        fetchJson('activity.json'),
        fetchJson('account.json'),
        fetchJson('events.json').catch(() => ({ events: [] })),
      ]);
      state.state = st;
      state.chart = ch;
      state.activity = act;
      state.account = acct;
      state.events = ev;
      state.lastOkAt = st.updated_at || new Date().toISOString();
      state.offline = false;
      showError(false);

      // agent decision files
      await Promise.all(['scanner', 'auditor', 'analyst', 'executor', 'risk'].map(async (n) => {
        try { state.agents[n] = await fetchJson(`agents/${n}.json`); }
        catch (_) { state.agents[n] = state.agents[n] || { decisions: [] }; }
      }));

      if (state.tab === 'home') renderHome();
      else if (state.tab === 'agents') renderAgents();
      else if (state.tab === 'activity') renderActivity();
      else if (state.tab === 'account') renderAccount();

      // unread bell from events
      try {
        const seen = Number(localStorage.getItem(LS_UNREAD + '_seq') || 0);
        const maxSeq = Math.max(0, ...((ev.events || []).map((e) => e.seq || 0)));
        const bell = $('#bell-dot');
        if (bell) bell.classList.toggle('on', maxSeq > seen);
      } catch (_) {}
    } catch (e) {
      state.offline = true;
      showError(true);
    }
  }

  function bindUi() {
    $$('.tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('#nav-avatar') && $('#nav-avatar').addEventListener('click', () => switchTab('account'));
    $('#nav-title') && $('#nav-title').addEventListener('click', () => switchTab('account'));
    $('#see-all-activity') && $('#see-all-activity').addEventListener('click', () => switchTab('activity'));
    $$('.range-switch button').forEach((b) => {
      b.addEventListener('click', async () => {
        state.range = b.dataset.range;
        $$('.range-switch button').forEach((x) => x.classList.toggle('on', x === b));
        try {
          state.chart = await fetchJson(`chart/${state.range}.json`);
          renderHome();
        } catch (_) {}
      });
    });
    $('#coin-back') && $('#coin-back').addEventListener('click', closeOverlays);
    $('#audit-back') && $('#audit-back').addEventListener('click', closeOverlays);
    $('#acct-invite') && $('#acct-invite').addEventListener('click', async (e) => {
      e.preventDefault();
      const url = e.currentTarget.dataset.url;
      if (!url) return;
      if (navigator.share) {
        try { await navigator.share({ url, title: 'FOMO' }); return; } catch (_) {}
      }
      try {
        await navigator.clipboard.writeText(url);
        e.currentTarget.querySelector('.value').textContent = 'Link copied';
      } catch (_) {}
    });
    $('#nav-bell') && $('#nav-bell').addEventListener('click', () => {
      try {
        const maxSeq = Math.max(0, ...(((state.events && state.events.events) || []).map((e) => e.seq || 0)));
        localStorage.setItem(LS_UNREAD + '_seq', String(maxSeq));
      } catch (_) {}
      $('#bell-dot') && $('#bell-dot').classList.remove('on');
    });
    const search = $('#nav-search');
    if (search) {
      search.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        const q = search.value.trim();
        if (!q) return;
        // try mint directly, else scan activity/state feed
        const rows = (state.activity && state.activity.rows) || [];
        const hit = rows.find((r) =>
          (r.mint && r.mint === q) ||
          (r.title && r.title.toLowerCase().includes(q.toLowerCase()))
        );
        if (hit && hit.mint) {
          if (hit.kind === 'rejected') openAudit(hit.mint);
          else openCoin(hit.mint);
          return;
        }
        const feed = (((state.state || {}).agents || {}).scanner || {}).feed || [];
        const f = feed.find((x) =>
          (x.mint && x.mint === q) ||
          (x.name && x.name.toLowerCase().includes(q.toLowerCase()))
        );
        if (f && f.mint) openCoin(f.mint);
      });
    }
  }

  async function boot() {
    if (document.body.dataset.role === 'launcher') {
      try { localStorage.removeItem(LS_PATH); } catch (_) {}
      if (location.hash) {
        history.replaceState(null, '', location.pathname + location.search);
      }
      document.body.innerHTML = '<div style="padding:40px;font-family:-apple-system;background:#000;color:#fff;min-height:100vh">Open your new private desk link</div>';
      return;
    }
    const path = resolvePath();
    if (!path) {
      document.body.innerHTML = '<div style="padding:40px;font-family:-apple-system;background:#000;color:#fff">Open your new private desk link</div>';
      return;
    }
    persistPath(path);
    state.path = path;
    state.dataBase = dataBaseFor(path);
    bindUi();
    switchTab('home');
    await refreshAll();
    setInterval(refreshAll, POLL_MS);
    setInterval(() => {
      if (state.offline) {
        state.retryIn = Math.max(1, state.retryIn - 1);
        showError(true);
        if (state.retryIn <= 0) { state.retryIn = 5; refreshAll(); }
      } else state.retryIn = 5;
    }, 1000);
    window.addEventListener('resize', () => {
      if (state.tab === 'home') renderHome();
    });
  }

  // expose for deep links / proof harness
  window.openCoin = openCoin;
  window.openAudit = openAudit;
  window.switchTab = switchTab;
  window.renderActivity = renderActivity;
  window.state = state;

  document.addEventListener('DOMContentLoaded', boot);
})();
