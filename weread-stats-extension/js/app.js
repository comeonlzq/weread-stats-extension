/* 主逻辑：周期切换、数据渲染、主题、设置 */
'use strict';

(function () {
  const {
    ApiError, Store, Session, esc, fmtDur, fmtHours, fmtDate,
    getApiKey, setApiKey, fetchReadDetail,
  } = window.WeRead;
  const Charts = window.WeCharts;

  const $ = (s) => document.querySelector(s);

  const MODE_META = {
    weekly: { word: '本周', unitWord: '周' },
    monthly: { word: '本月', unitWord: '月' },
    annually: { word: '今年', unitWord: '年' },
    overall: { word: '全部', unitWord: '' },
  };
  const CACHE_TTL = 10 * 60 * 1000;

  const state = { mode: 'monthly', offset: 0, hasData: false, ctx: 'popup' };

  /* ================= 环境与初始化 ================= */

  async function detectContext() {
    // 侧边栏通过 iframe 内嵌 dashboard.html?ctx=sidepanel 复用页面
    let ctx = new URLSearchParams(location.search).get('ctx');
    if (ctx !== 'sidepanel') {
      let isTab = false;
      try {
        isTab = !!(chrome && chrome.tabs && (await chrome.tabs.getCurrent()));
      } catch { /* popup 中可能抛错 */ }
      ctx = isTab ? 'tab' : 'popup';
    }
    state.ctx = ctx;
    document.body.classList.add('ctx-' + ctx);
    $('#expandBtn').hidden = ctx === 'tab';
  }

  async function initTheme() {
    const o = await Store.get('theme');
    applyTheme((o && o.theme) || 'auto');
    $('#themeToggle').addEventListener('click', async () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      await Store.set({ theme: next });
    });
    try {
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', async () => {
          const o2 = await Store.get('theme');
          if ((o2 && o2.theme) === 'auto') applyTheme('auto');
        });
    } catch { /* 旧浏览器忽略 */ }
  }

  function applyTheme(mode) {
    const eff =
      mode === 'auto'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : mode;
    document.documentElement.dataset.theme = eff;
  }

  function setLoading(on) {
    $('#progressBar').hidden = !on;
    $('#refreshBtn').disabled = on;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ================= 周期计算 ================= */

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 周一为一周起点
    return x;
  }

  /** offset: 0=当前周期，1=上一个，以此类推。返回秒级 baseTime */
  function periodBaseTs(mode, offset) {
    const now = new Date();
    if (mode === 'weekly') {
      const d = startOfWeek(now);
      d.setDate(d.getDate() - 7 * offset);
      return Math.floor(d.getTime() / 1000);
    }
    if (mode === 'monthly') {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      return Math.floor(d.getTime() / 1000);
    }
    if (mode === 'annually') {
      const d = new Date(now.getFullYear() - offset, 0, 1);
      return Math.floor(d.getTime() / 1000);
    }
    return 0;
  }

  function periodLabel(mode, offset) {
    if (mode === 'overall') return '全部数据';
    const base = new Date(periodBaseTs(mode, offset) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    let range = '';
    if (mode === 'weekly') {
      const end = new Date(base);
      end.setDate(base.getDate() + 6);
      range = (base.getMonth() + 1) + '/' + base.getDate() + ' - ' +
        (end.getMonth() + 1) + '/' + end.getDate();
    } else if (mode === 'monthly') {
      range = base.getFullYear() + '年' + (base.getMonth() + 1) + '月';
    } else {
      range = base.getFullYear() + '年';
    }
    return (offset === 0 ? MODE_META[mode].word + ' · ' : '') + range;
  }

  /* ================= 数据加载 ================= */

  async function load(force) {
    const apiKey = await getApiKey();
    $('#onboardView').hidden = !!apiKey;
    $('#mainView').hidden = !apiKey;
    if (!apiKey) return;

    const key = state.mode + ':' + state.offset;
    setLoading(true);
    $('#errorBox').hidden = true;
    if (!state.hasData) {
      $('#skeleton').hidden = false;
      $('#content').hidden = true;
    }

    try {
      let data = null;
      if (!force) {
        const cached = await Session.get('rd:' + key);
        if (cached && Date.now() - cached.t < CACHE_TTL) data = cached.data;
      }
      if (!data) {
        const baseTime = state.mode === 'overall' ? 0 : periodBaseTs(state.mode, state.offset);
        data = await fetchReadDetail(state.mode, state.offset === 0 ? 0 : baseTime);
        await Session.set('rd:' + key, { t: Date.now(), data });
      }
      render(data);
      state.hasData = true;
    } catch (e) {
      renderError(e);
    } finally {
      setLoading(false);
      $('#skeleton').hidden = true;
    }
  }

  function renderError(e) {
    const msg = e instanceof ApiError ? e.message : '阅读数据暂时无法获取，请稍后再试~';
    $('#errorMsg').textContent = msg;
    $('#errorBox').hidden = false;
    $('#errorSettingsBtn').hidden = !(e instanceof ApiError && e.code === 'AUTH');
    $('#content').hidden = !state.hasData;
  }

  /* ================= 渲染 ================= */

  function render(d) {
    d = d || {};
    renderPeriod();
    renderStats(d);
    renderChips(d);
    renderTrend(d);
    renderBooks(d);
    renderCategories(d);
    renderHours(d);
    renderAuthors(d);
    renderRate(d);
    renderRank(d);
    $('#updatedAt').textContent = fmtClock();
    $('#content').hidden = false;
  }

  function fmtClock() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderPeriod() {
    const isOverall = state.mode === 'overall';
    $('#periodNav').style.visibility = isOverall ? 'hidden' : 'visible';
    $('#periodLabel').textContent = periodLabel(state.mode, state.offset);
    $('#nextBtn').disabled = state.offset === 0;
    $('#todayBtn').hidden = state.offset === 0;
    document.querySelectorAll('#modeTabs button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === state.mode);
      b.setAttribute('aria-selected', b.dataset.mode === state.mode ? 'true' : 'false');
    });
  }

  /** 秒 → 大字号数值 + 小字号单位的 HTML（如 123<big>小时</big>45<big>分钟</big>） */
  function heroDur(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    let h = Math.floor(sec / 3600);
    let m = Math.round((sec % 3600) / 60);
    if (m >= 60) { h += 1; m = 0; }
    const num = (v) => '<span class="hv-num">' + v + '</span>';
    const unit = (t) => '<span class="hv-unit">' + t + '</span>';
    if (h === 0 && m === 0) return num(0) + unit('分钟');
    return (h > 0 ? num(h) + unit('小时') : '') + (m > 0 ? num(m) + unit('分钟') : '');
  }

  const PREV_WORD = { weekly: '上周', monthly: '上月', annually: '去年' };

  function renderStats(d) {
    let html =
      '<div class="stat-hero-value">' +
      (d.totalReadTime != null ? heroDur(d.totalReadTime) : '<span class="hv-num">--</span>') +
      '</div>';

    const sub = [];
    if (d.dayAverageReadTime != null) {
      sub.push('日均阅读 ' + fmtDur(d.dayAverageReadTime));
    }
    const prevWord = PREV_WORD[state.mode] || '上期';
    if (d.compare != null) {
      const v = Number(d.compare);
      if (v !== 0) {
        const cls = v > 0 ? 'up' : 'down';
        const arrow = v > 0 ? '↑' : '↓';
        sub.push('比' + prevWord + ' <span class="' + cls + '">' +
          arrow + ' ' + Math.abs(v * 100).toFixed(1) + '%</span>');
      } else {
        sub.push('比' + prevWord + ' <span class="flat">持平</span>');
      }
    } else if (state.mode === 'overall' && d.registTime) {
      const days = Math.max(1, Math.ceil((Date.now() - d.registTime * 1000) / 86400000));
      sub.push('注册至今 ' + days + ' 天');
    }
    if (sub.length) html += '<div class="stat-hero-sub">' + sub.join('，') + '</div>';

    $('#statHero').innerHTML = html;
  }

  function renderChips(d) {
    const arr = Array.isArray(d.readStat) ? d.readStat : [];
    $('#readStatChips').innerHTML = arr
      .filter((s) => s && s.stat && s.counts)
      .map((s) =>
        '<div class="chip-cell">' +
        '<span class="chip-name">' + esc(s.stat) + '</span>' +
        '<span class="chip-val">' + esc(s.counts) + '</span>' +
        '</div>'
      ).join('');
  }

  function bucketLabel(mode, ts) {
    const dt = new Date(ts * 1000);
    if (mode === 'annually') return (dt.getMonth() + 1) + '月';
    if (mode === 'overall') return String(dt.getFullYear());
    return (dt.getMonth() + 1) + '/' + dt.getDate();
  }

  function dayKeyOf(ts) {
    const dt = new Date(ts * 1000);
    return dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
  }

  /**
   * 组出完整周期的柱子：周 7 天 / 月当月天数 / 年 12 个月。
   * 未到的未来时间 value 置 0 且 empty=true（图表留空但保留刻度）。
   */
  function buildTrendItems(d) {
    const rt = d.readTimes || {};
    const raw = Object.keys(rt)
      .map((k) => ({ ts: Number(k), value: Number(rt[k]) || 0 }))
      .filter((e) => Number.isFinite(e.ts))
      .sort((a, b) => a.ts - b.ts);

    if (state.mode === 'overall') {
      return raw.map((e) => ({
        label: bucketLabel('overall', e.ts),
        value: e.value,
        empty: false,
      }));
    }

    const nowTs = Math.floor(Date.now() / 1000);
    const items = [];

    if (state.mode === 'annually') {
      const year = new Date(periodBaseTs('annually', state.offset) * 1000).getFullYear();
      const byMonth = {};
      raw.forEach((e) => {
        const dt = new Date(e.ts * 1000);
        byMonth[dt.getFullYear() + '-' + dt.getMonth()] = e.value;
      });
      for (let m = 0; m < 12; m++) {
        const ts = Math.floor(new Date(year, m, 1).getTime() / 1000);
        items.push({
          label: bucketLabel('annually', ts),
          value: byMonth[year + '-' + m] || 0,
          empty: ts > nowTs,
        });
      }
      return items;
    }

    // weekly / monthly：按天补全
    const start = periodBaseTs(state.mode, state.offset);
    const bd = new Date(start * 1000);
    const count = state.mode === 'weekly'
      ? 7
      : new Date(bd.getFullYear(), bd.getMonth() + 1, 0).getDate();
    const byDay = {};
    raw.forEach((e) => { byDay[dayKeyOf(e.ts)] = e.value; });
    for (let i = 0; i < count; i++) {
      const ts = start + i * 86400;
      items.push({
        label: bucketLabel(state.mode, ts),
        value: byDay[dayKeyOf(ts)] || 0,
        empty: ts > nowTs,
      });
    }
    return items;
  }

  function renderTrend(d) {
    Charts.barChart($('#trendChart'), buildTrendItems(d), { fmtValue: fmtDur });
  }

  function bookInfo(it) {
    if (it && it.book) return it.book;
    if (it && it.albumInfo) return it.albumInfo;
    return {};
  }

  function renderBooks(d) {
    const arr = Array.isArray(d.readLongest) ? d.readLongest : [];
    const panel = $('#booksPanel');
    if (!arr.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    $('#bookRank').innerHTML = arr.map((it, i) => {
      const b = bookInfo(it);
      const title = b.title || '未知书名';
      const author = b.author || (it.albumInfo ? '有声内容' : '');
      const cover = b.cover;
      const coverHtml = cover
        ? '<img class="book-cover" src="' + esc(cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=cover-fallback>' + esc(title.slice(0, 1)) + '</div>\'">'
        : '<div class="cover-fallback">' + esc(title.slice(0, 1)) + '</div>';
      return (
        '<li>' +
        '<span class="rank-idx">' + (i + 1) + '</span>' +
        coverHtml +
        '<div class="book-meta">' +
        '<div class="book-title" title="' + esc(title) + '">' + esc(title) + '</div>' +
        '<div class="book-sub">' + esc(author) + '</div>' +
        '</div>' +
        '<span class="book-time">' + esc(fmtDur(it.readTime)) + '</span>' +
        '</li>'
      );
    }).join('');
  }

  function renderCategories(d) {
    const arr = Array.isArray(d.preferCategory) ? d.preferCategory : [];
    const panel = $('#catsPanel');
    if (!arr.length) { panel.hidden = true; return; }
    panel.hidden = false;

    // 优先用阅读时长（秒）计算条形占比；时长缺失时回退到 val 权重
    const rows = arr.map((c) => {
      const t = Number(c.readingTime);
      return {
        label: c.categoryTitle || '未知分类',
        time: Number.isFinite(t) && t > 0 ? t : 0,
        val: parseFloat(String(c.val == null ? '' : c.val)) || 0,
        count: Number(c.readingCount) || 0,
      };
    });
    const hasTime = rows.some((r) => r.time > 0);
    const maxT = Math.max.apply(null, rows.map((r) => r.time).concat([0.0001]));
    const maxV = Math.max.apply(null, rows.map((r) => r.val).concat([0.0001]));
    rows.forEach((r) => {
      r.pct = hasTime ? (r.time / maxT) * 100 : (r.val / maxV) * 100;
      r.valueText = r.time > 0 ? fmtDur(r.time) : (r.count > 0 ? r.count + '本' : '');
      r.valueTitle = [
        r.count > 0 ? r.count + '本' : '',
        r.time > 0 ? fmtDur(r.time) : '',
      ].filter(Boolean).join(' · ');
    });
    Charts.hbars($('#preferCat'), rows);
  }

  function renderHours(d) {
    const arr = Array.isArray(d.preferTime) ? d.preferTime.map(Number) : [];
    const panel = $('#hoursPanel');
    if (!arr.length) { panel.hidden = true; return; }
    panel.hidden = false;
    Charts.hourBars($('#preferTime'), arr);
    const word = $('#preferTimeWord');
    if (d.preferTimeWord) {
      word.textContent = d.preferTimeWord;
      word.hidden = false;
    } else {
      word.hidden = true;
    }
  }

  function renderAuthors(d) {
    const arr = Array.isArray(d.preferAuthor) ? d.preferAuthor : [];
    const panel = $('#authorsPanel');
    if (!arr.length) { panel.hidden = true; return; }
    panel.hidden = false;
    const maxCount = Math.max.apply(null, arr.map((a) => Number(a.count) || 0).concat([1]));
    const rows = arr.map((a) => ({
      label: a.name || '未知作者',
      pct: ((Number(a.count) || 0) / maxCount) * 100,
      valueText: a.count != null ? a.count + '本' : '',
      valueTitle: (a.count != null ? a.count + '本' : '') +
        (a.readTime ? ' · ' + a.readTime : ''),
    }));
    Charts.hbars($('#preferAuthor'), rows);
  }

  function renderRate(d) {
    const panel = $('#ratePanel');
    if (d.readRate == null) { panel.hidden = true; return; }
    panel.hidden = false;
    Charts.donut($('#rateDonut'), Number(d.readRate), '文字阅读');
    const legend = [];
    if (d.wrReadTime != null) {
      legend.push({ color: 'var(--accent)', name: '文字阅读', val: fmtDur(d.wrReadTime) });
    }
    if (d.wrListenTime != null) {
      legend.push({ color: 'var(--accent-2)', name: '听书', val: fmtDur(d.wrListenTime) });
    }
    $('#rateLegend').innerHTML = legend.map((l) =>
      '<div class="legend-row">' +
      '<span class="legend-swatch" style="background:' + l.color + '"></span>' +
      '<span class="legend-name">' + l.name + '</span>' +
      '<span class="legend-val">' + l.val + '</span>' +
      '</div>'
    ).join('');
  }

  function renderRank(d) {
    const badge = $('#rankBadge');
    if (d.rank && d.rank.text) {
      badge.textContent = d.rank.text;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  /* ================= 事件绑定 ================= */

  function bindEvents() {
    // 周期 tab
    $('#modeTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      if (btn.dataset.mode === state.mode) return;
      state.mode = btn.dataset.mode;
      state.offset = 0;
      load();
    });

    $('#prevBtn').addEventListener('click', () => {
      if (state.mode === 'overall') return;
      state.offset += 1;
      load();
    });
    $('#nextBtn').addEventListener('click', () => {
      if (state.offset === 0) return;
      state.offset -= 1;
      load();
    });
    $('#todayBtn').addEventListener('click', () => {
      state.offset = 0;
      load();
    });

    $('#refreshBtn').addEventListener('click', () => load(true));
    $('#errorRetryBtn').addEventListener('click', () => load(true));
    $('#errorSettingsBtn').addEventListener('click', openSettings);

    $('#expandBtn').addEventListener('click', () => {
      if (chrome && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
        if (state.ctx !== 'sidepanel') window.close();
      } else {
        window.open('dashboard.html', '_blank');
      }
    });

    // 设置
    $('#settingsBtn').addEventListener('click', openSettings);
    $('#closeSettingsBtn').addEventListener('click', closeSettings);
    $('#settingsModal').addEventListener('click', (e) => {
      if (e.target === $('#settingsModal')) closeSettings();
    });
    $('#toggleKeyVisBtn').addEventListener('click', () => {
      const inp = $('#apiKeyInput');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
    $('#saveKeyBtn').addEventListener('click', () => saveKey($('#apiKeyInput').value, true));
    $('#clearKeyBtn').addEventListener('click', async () => {
      await setApiKey('');
      $('#apiKeyInput').value = '';
      $('#onboardKeyInput').value = '';
      state.hasData = false;
      await Session.clear();
      closeSettings();
      toast('已清除 API Key');
      load();
    });

    // 首次引导
    $('#onboardSaveBtn').addEventListener('click', () => saveKey($('#onboardKeyInput').value, false));
    $('#onboardKeyInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveKey($('#onboardKeyInput').value, false);
    });
    $('#apiKeyInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveKey($('#apiKeyInput').value, true);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSettings();
    });
  }

  async function saveKey(raw, fromSettings) {
    const key = String(raw || '').trim();
    const errEl = $('#onboardError');
    errEl.hidden = true;
    if (!key) {
      if (!fromSettings) {
        errEl.textContent = '请输入 API Key';
        errEl.hidden = false;
      } else {
        toast('请输入 API Key');
      }
      return;
    }
    await setApiKey(key);
    state.hasData = false;
    await Session.clear();
    if (fromSettings) {
      closeSettings();
      toast('已保存，正在加载数据…');
    }
    load();
  }

  async function openSettings() {
    const key = await getApiKey();
    $('#apiKeyInput').value = key || '';
    $('#apiKeyInput').type = 'password';
    $('#settingsModal').hidden = false;
    $('#apiKeyInput').focus();
  }

  function closeSettings() {
    $('#settingsModal').hidden = true;
  }

  /* ================= 启动 ================= */

  async function init() {
    await detectContext();
    await initTheme();
    bindEvents();
    await load();
  }

  init();
})();
