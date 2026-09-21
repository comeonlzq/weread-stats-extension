/* 微信读书 API 网关客户端 + 通用工具 */
'use strict';

(function () {
  const GATEWAY = 'https://i.weread.qq.com/api/agent/gateway';
  const SKILL_VERSION = '1.0.4';

  class ApiError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ApiError';
      this.code = code || 'UNKNOWN';
    }
  }

  /* ---------- 存储：扩展环境用 chrome.storage.local，网页预览回退 localStorage ---------- */
  const hasChromeStorage =
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  const Store = {
    async get(keys) {
      if (hasChromeStorage) return chrome.storage.local.get(keys);
      const out = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        const v = localStorage.getItem('wr:' + k);
        if (v !== null) { try { out[k] = JSON.parse(v); } catch { /* ignore */ } }
      });
      return out;
    },
    async set(obj) {
      if (hasChromeStorage) return chrome.storage.local.set(obj);
      Object.entries(obj).forEach(([k, v]) =>
        localStorage.setItem('wr:' + k, JSON.stringify(v))
      );
    },
    async remove(keys) {
      if (hasChromeStorage) return chrome.storage.local.remove(keys);
      (Array.isArray(keys) ? keys : [keys]).forEach((k) =>
        localStorage.removeItem('wr:' + k)
      );
    },
  };

  /* 会话级缓存（弹窗关闭即失效的 storage.session，网页预览时退化为内存） */
  let memSession = {};
  const Session = {
    async get(key) {
      if (chrome && chrome.storage && chrome.storage.session) {
        try {
          const o = await chrome.storage.session.get(key);
          return o[key];
        } catch { /* ignore */ }
      }
      return memSession[key];
    },
    async set(key, value) {
      if (chrome && chrome.storage && chrome.storage.session) {
        try { await chrome.storage.session.set({ [key]: value }); return; } catch { /* ignore */ }
      }
      memSession[key] = value;
    },
    async clear() {
      memSession = {};
      if (chrome && chrome.storage && chrome.storage.session) {
        try { await chrome.storage.session.clear(); } catch { /* ignore */ }
      }
    },
  };

  /* ---------- 通用工具 ---------- */
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  /** 秒 → "x小时y分钟" */
  function fmtDur(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h === 0) return m + '分钟';
    if (m === 0) return h + '小时';
    return h + '小时' + m + '分钟';
  }

  /** 秒 → "12.5小时"（图表轴用） */
  const fmtHours = (sec) => ((Number(sec) || 0) / 3600).toFixed(1) + 'h';

  /** Unix 秒时间戳 → YYYY-MM-DD */
  function fmtDate(ts) {
    if (!ts) return '--';
    const d = new Date(Number(ts) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ---------- 网关调用 ---------- */
  async function getApiKey() {
    const o = await Store.get('apiKey');
    return (o && o.apiKey) || '';
  }

  async function setApiKey(key) {
    key = String(key || '').trim();
    if (!key) { await Store.remove('apiKey'); return; }
    await Store.set({ apiKey: key });
  }

  async function callGateway(apiName, params) {
    const key = await getApiKey();
    if (!key) throw new ApiError('未配置 API Key', 'NO_KEY');

    const body = Object.assign({ api_name: apiName }, params || {}, {
      skill_version: SKILL_VERSION,
    });

    let resp;
    try {
      resp = await fetch(GATEWAY, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiError('网络请求失败，请检查网络后重试', 'NETWORK');
    }

    if (resp.status === 401 || resp.status === 403) {
      throw new ApiError('API Key 无效或已过期，请检查后重试', 'AUTH');
    }
    if (!resp.ok) {
      throw new ApiError('请求失败（HTTP ' + resp.status + '）', 'HTTP');
    }

    let json;
    try {
      json = await resp.json();
    } catch {
      throw new ApiError('响应解析失败，请稍后重试', 'PARSE');
    }

    if (json && typeof json === 'object' && json.upgrade_info) {
      throw new ApiError(
        (json.upgrade_info && json.upgrade_info.message) || '接口版本需要升级',
        'UPGRADE'
      );
    }
    if (json && typeof json === 'object' && json.errcode != null && json.errcode !== 0) {
      throw new ApiError(json.errmsg || json.message || ('请求失败（errcode ' + json.errcode + '）'), 'BIZ');
    }
    return json;
  }

  /* 网关可能把业务数据平铺在顶层或嵌在 data 中，这里做统一解包 */
  const PAYLOAD_KEYS = ['totalReadTime', 'readTimes', 'readDays', 'readStat'];
  function unwrap(json) {
    if (!json || typeof json !== 'object') return json;
    const d = json.data;
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      const hasTop = PAYLOAD_KEYS.some((k) => k in json);
      const hasNested = PAYLOAD_KEYS.some((k) => k in d);
      if (!hasTop && hasNested) return Object.assign({}, json, d);
    }
    return json;
  }

  /** 阅读统计详情。mode: weekly|monthly|annually|overall；baseTime: 秒级时间戳，0 表示当前周期 */
  async function fetchReadDetail(mode, baseTime) {
    const params = { mode };
    if (baseTime) params.baseTime = baseTime;
    const json = await callGateway('/readdata/detail', params);
    return unwrap(json);
  }

  window.WeRead = {
    ApiError, Store, Session, GATEWAY,
    esc, fmtDur, fmtHours, fmtDate,
    getApiKey, setApiKey, callGateway, fetchReadDetail,
  };
})();
