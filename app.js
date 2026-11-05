(function () {
  var POLL_MS = 15000;
  var PATH_KEY = 'desk_data_path';
  var TOKEN_KEY = 'APP_TOKEN';
  var chart = null;
  var polling = false;
  var hashRead = false;

  var tabs = [
    { id: 'home', tab: 'tab-home', panel: 'panel-home' },
    { id: 'agents', tab: 'tab-agents', panel: 'panel-agents' },
    { id: 'activity', tab: 'tab-activity', panel: 'panel-activity' },
    { id: 'account', tab: 'tab-account', panel: 'panel-account' }
  ];

  function store(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {}
  }

  function load(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (err) {
      return '';
    }
  }

  function readParam(raw, name) {
    var bits = raw.split('&');
    for (var i = 0; i < bits.length; i++) {
      var pair = bits[i].split('=');
      if (decodeURIComponent(pair[0] || '') !== name) continue;
      var value = pair.slice(1).join('=');
      try {
        return decodeURIComponent(value);
      } catch (err) {
        return value;
      }
    }
    return '';
  }

  function readLaunchHash() {
    if (hashRead) return;
    hashRead = true;
    var raw = location.hash.charAt(0) === '#' ? location.hash.slice(1) : '';
    if (!raw) return;
    var dataPath = readParam(raw, 'd');
    var token = readParam(raw, 't');
    if (dataPath) store(PATH_KEY, dataPath);
    if (token) store(TOKEN_KEY, token);
    if (dataPath || token) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  }

  function money(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  function signedMoney(value) {
    var n = Number(value);
    if (!isFinite(n)) return '';
    var body = money(Math.abs(n));
    if (n > 0) return '+' + body;
    if (n < 0) return '−' + body;
    return body;
  }

  function whenLabel(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      var n = Number(value);
      if (!isFinite(n)) return '';
      var ms = n < 1e12 ? n * 1000 : n;
      var date = new Date(ms);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
    }
    return String(value);
  }

  function statusKind(status) {
    var key = String(status || '').toLowerCase();
    if (key === 'run' || key === 'running' || key === 'live' || key === 'active') return 'run';
    if (key === 'error' || key === 'halt' || key === 'halted' || key === 'stopped' || key === 'fail' || key === 'failed') return 'bad';
    if (key === 'idle' || key === 'wait' || key === 'waiting' || key === 'paused') return 'idle';
    return '';
  }

  function setLive(mode) {
    var flag = document.getElementById('live-flag');
    flag.classList.toggle('on', mode === 'on');
    flag.classList.toggle('bad', mode === 'bad');
  }

  function setStatus(text, warn) {
    var line = document.getElementById('status-line');
    line.textContent = text;
    line.classList.toggle('warn', !!warn);
  }

  function clock() {
    return new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  function updateAccount(mode) {
    document.getElementById('acct-mode').textContent = mode || 'PAPER';
    document.getElementById('acct-link').textContent = load(PATH_KEY) ? 'Connected' : 'Not connected';
    document.getElementById('acct-token').textContent = load(TOKEN_KEY) ? 'Saved' : 'Not set';
  }

  function renderAgents(agents) {
    var list = document.getElementById('agent-list');
    list.replaceChildren();
    if (!agents || !agents.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No agents';
      list.appendChild(empty);
      return;
    }
    agents.forEach(function (agent) {
      var card = document.createElement('article');
      card.className = 'card agent';
      var name = document.createElement('div');
      name.className = 'agent-name';
      name.textContent = agent.name || agent.id || 'Agent';
      var status = document.createElement('div');
      var kind = statusKind(agent.status);
      status.className = 'status' + (kind ? ' status-' + kind : '');
      status.textContent = agent.status || 'idle';
      card.appendChild(name);
      card.appendChild(status);
      list.appendChild(card);
    });
  }

  function renderActivity(rows) {
    var list = document.getElementById('activity-list');
    list.replaceChildren();
    if (!rows || !rows.length) {
      var empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No activity yet';
      list.appendChild(empty);
      return;
    }
    var card = document.createElement('div');
    card.className = 'card activity-card';
    rows.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'activity-row';
      var main = document.createElement('div');
      main.className = 'activity-main';
      var title = document.createElement('div');
      title.className = 'activity-title';
      title.textContent = row.title || row.text || row.symbol || 'Trade';
      main.appendChild(title);
      var detailText = row.detail || row.note || whenLabel(row.time || row.t || row.ts);
      if (detailText) {
        var detail = document.createElement('div');
        detail.className = 'activity-detail nums';
        detail.textContent = detailText;
        main.appendChild(detail);
      }
      item.appendChild(main);
      if (row.amount != null || row.pnl != null) {
        var n = Number(row.amount != null ? row.amount : row.pnl);
        var amount = document.createElement('div');
        amount.className = 'amount nums' + (n < 0 ? ' neg' : n > 0 ? ' pos' : '');
        amount.textContent = signedMoney(n);
        item.appendChild(amount);
      }
      card.appendChild(item);
    });
    list.appendChild(card);
  }

  function showDisconnected() {
    document.getElementById('balance').textContent = '—';
    document.getElementById('balance').classList.remove('neg');
    var sub = document.getElementById('balance-sub');
    sub.textContent = 'Open the desk link to load this account';
    sub.classList.add('warn');
    document.getElementById('mode-pill').textContent = 'PAPER';
    if (chart) chart.setPoints([]);
    renderAgents([]);
    renderActivity([]);
    updateAccount('PAPER');
    setLive('bad');
    setStatus('Add the #d= link from Grok Bot', true);
  }

  function renderState(state) {
    var mode = state && state.mode ? String(state.mode) : 'PAPER';
    var balance = state ? Number(state.balance) : NaN;
    var balanceEl = document.getElementById('balance');
    balanceEl.textContent = money(balance);
    balanceEl.classList.toggle('neg', isFinite(balance) && balance < 0);
    var sub = document.getElementById('balance-sub');
    sub.textContent = mode === 'PAPER' ? 'Paper balance' : mode;
    sub.classList.remove('warn');
    document.getElementById('mode-pill').textContent = mode;
    renderAgents(state && state.agents);
    updateAccount(mode);
  }

  function pointsOf(chartJson) {
    if (Array.isArray(chartJson)) return chartJson;
    if (chartJson && Array.isArray(chartJson.points)) return chartJson.points;
    return [];
  }

  function rowsOf(activityJson) {
    if (Array.isArray(activityJson)) return activityJson;
    if (activityJson && Array.isArray(activityJson.rows)) return activityJson.rows;
    return [];
  }

  function loadJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
  }

  function poll() {
    if (polling) return;
    var path = load(PATH_KEY);
    if (!path) {
      showDisconnected();
      return;
    }
    polling = true;
    var encoded = encodeURIComponent(path);
    var bust = Date.now();
    Promise.all([
      loadJson(`./d/${encoded}/state.json?v=${bust}`),
      loadJson(`./d/${encoded}/chart.json?v=${bust}`),
      loadJson(`./d/${encoded}/activity.json?v=${bust}`)
    ]).then(function (parts) {
      renderState(parts[0]);
      if (chart) chart.setPoints(pointsOf(parts[1]));
      renderActivity(rowsOf(parts[2]));
      setLive('on');
      setStatus('Updated ' + clock(), false);
    }).catch(function () {
      setLive('bad');
      setStatus('Could not refresh', true);
    }).then(function () {
      polling = false;
    });
  }

  function selectTab(id) {
    tabs.forEach(function (item) {
      var selected = item.id === id;
      var tab = document.getElementById(item.tab);
      var panel = document.getElementById(item.panel);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    });
    if (id === 'home' && chart) chart.draw();
  }

  function bindTabs() {
    var nav = document.querySelector('.tabbar');
    tabs.forEach(function (item) {
      document.getElementById(item.tab).addEventListener('click', function () {
        selectTab(item.id);
      });
    });
    nav.addEventListener('keydown', function (event) {
      var order = tabs.map(function (item) { return document.getElementById(item.tab); });
      var index = order.indexOf(document.activeElement);
      if (index < 0) return;
      var next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % order.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + order.length) % order.length;
      else return;
      event.preventDefault();
      order[next].focus();
      order[next].click();
    });
  }

  readLaunchHash();
  chart = new DeskChart(document.getElementById('chart'), document.getElementById('chart-empty'));
  bindTabs();
  updateAccount('PAPER');
  poll();
  setInterval(poll, POLL_MS);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  }
})();
