/* 轻量 SVG / DOM 图表（无外部依赖，兼容 MV3 CSP） */
'use strict';

(function () {
  const { esc, fmtDur } = WeRead;
  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* ---------- 竖向柱状图：阅读时长趋势 ---------- */
  function barChart(container, items, opts) {
    opts = opts || {};
    const fmt = opts.fmtValue || fmtDur;
    container.innerHTML = '';
    if (!items || !items.length) {
      container.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }

    const W = 360, H = 150, padL = 8, padR = 8, padT = 18, padB = 20;
    const max = Math.max.apply(null, items.map((i) => i.value).concat([1]));
    const slot = (W - padL - padR) / items.length;
    const bw = Math.max(4, Math.min(26, slot * 0.62));
    const gid = 'bcg' + Math.random().toString(36).slice(2, 8);

    const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'bar-chart' });
    const defs = svgEl('defs', {});
    defs.innerHTML =
      '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="var(--chart-b)"/>' +
      '<stop offset="1" stop-color="var(--chart-a)"/></linearGradient>';
    svg.appendChild(defs);

    // 网格线
    [0.25, 0.5, 0.75, 1].forEach((g) => {
      const y = padT + (H - padT - padB) * (1 - g);
      svg.appendChild(svgEl('line', {
        x1: padL, x2: W - padR, y1: y, y2: y, class: 'grid',
      }));
    });

    const every = items.length <= 12 ? 1 : Math.ceil(items.length / 8);
    items.forEach((it, i) => {
      const x = padL + i * slot + (slot - bw) / 2;

      // 未来未到的时段（it.empty）仅保留刻度占位，不绘制柱体
      if (!it.empty) {
        const h = Math.max(2, (it.value / max) * (H - padT - padB));
        const y = H - padB - h;
        const r = svgEl('rect', {
          x: x.toFixed(1), y: y.toFixed(1),
          width: bw.toFixed(1), height: h.toFixed(1),
          rx: Math.min(3, bw / 2).toFixed(1),
          fill: 'url(#' + gid + ')', class: 'bar',
        });
        const t = document.createElementNS(NS, 'title');
        t.textContent = it.label + ' · ' + fmt(it.value);
        r.appendChild(t);
        svg.appendChild(r);
      }

      if (i % every === 0 || i === items.length - 1) {
        const tx = svgEl('text', {
          x: (x + bw / 2).toFixed(1), y: H - 6,
          'text-anchor': 'middle', class: 'bc-xlabel',
        });
        tx.textContent = it.label;
        svg.appendChild(tx);
      }
    });

    container.appendChild(svg);
  }

  /* ---------- 横向条形列表：分类 / 作者偏好 ---------- */
  function hbars(container, rows) {
    container.innerHTML = '';
    if (!rows || !rows.length) {
      container.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    container.innerHTML = rows.map((r) =>
      '<div class="hbar-row">' +
      '<span class="hbar-label" title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
      '<div class="hbar-track"><div class="hbar-fill" style="width:' +
      Math.max(2, Math.min(100, r.pct || 0)).toFixed(1) + '%"></div></div>' +
      '<span class="hbar-val" title="' + esc(r.valueTitle || r.valueText) + '">' + esc(r.valueText) + '</span>' +
      '</div>'
    ).join('');
  }

  /* ---------- 24 小时时段分布（数组顺序从 6 点到次日 5 点） ---------- */
  function hourBars(container, secs) {
    container.innerHTML = '';
    if (!secs || !secs.length || secs.every((v) => !v)) {
      container.innerHTML = '<div class="empty">暂无数据</div>';
      return;
    }
    const max = Math.max.apply(null, secs.concat([60]));
    const bars = secs.map((v, i) => {
      const hour = (6 + i) % 24;
      const pct = Math.max(2, (v / max) * 100);
      return (
        '<div class="hour-col" title="' + hour + '点 · ' + fmtDur(v) + '">' +
        '<i style="height:' + pct.toFixed(1) + '%"></i></div>'
      );
    }).join('');
    container.innerHTML =
      '<div class="hours">' + bars + '</div>' +
      '<div class="hours-x">' +
      '<span style="left:0">6点</span>' +
      '<span style="left:25%">12点</span>' +
      '<span style="left:50%">18点</span>' +
      '<span style="left:75%">0点</span>' +
      '<span style="left:100%">5点</span>' +
      '</div>';
  }

  /* ---------- 环形占比：文字阅读 vs 听书 ---------- */
  function donut(container, pct, centerLabel) {
    const size = 104, r = 42, c = size / 2;
    const circ = 2 * Math.PI * r;
    const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
    container.innerHTML =
      '<svg viewBox="0 0 ' + size + ' ' + size + '">' +
      '<defs><linearGradient id="dng" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="var(--chart-a)"/>' +
      '<stop offset="1" stop-color="var(--chart-b)"/></linearGradient></defs>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="var(--track)" stroke-width="11"/>' +
      '<circle cx="' + c + '" cy="' + c + '" r="' + r + '" fill="none" stroke="url(#dng)" stroke-width="11" ' +
      'stroke-linecap="round" stroke-dasharray="' + circ.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '" ' +
      'transform="rotate(-90 ' + c + ' ' + c + ')"/>' +
      '<text x="' + c + '" y="' + (c - 1) + '" text-anchor="middle" class="donut-center-num">' +
      Math.round(pct) + '%</text>' +
      '<text x="' + c + '" y="' + (c + 14) + '" text-anchor="middle" class="donut-center-label">' +
      esc(centerLabel || '') + '</text>' +
      '</svg>';
  }

  window.WeCharts = { barChart, hbars, hourBars, donut };
})();
