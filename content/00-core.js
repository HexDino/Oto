/* EcoTek Study Agent - core: settings, storage, helpers */
(function () {
  'use strict';
  if (window.__ECO) return;

  var ECO = (window.__ECO = {});
  window.ECO = ECO; // extension pages (popup) use the bare name
  ECO.VERSION = '1.0.0';
  ECO.DOMAIN = 'hoclythuyetlaixe.eco-tek.com.vn';

  var DEFAULTS = {
    enabled: true,
    autoAdvance: true,
    bufferSeconds: 3,
    quizAssist: true,
    autoSelect: false,
    autoSelectThreshold: 80,
    agentMode: 'off',
    agentIntervalMs: 1500,
    agentMaxSteps: 200,
    showHud: true,
    logHistory: true,
    maxHistory: 2000,
    provider: 'local',
    apiBaseUrl: '',
    apiModel: '',
    apiKey: '',
    apiHeaders: '',
    advanceOnVideoEnd: true,
    debug: false,
    selectors: { timer: '', next: '', confirm: '', question: '', answers: '' }
  };

  ECO.DEFAULTS = DEFAULTS;
  ECO.settings = JSON.parse(JSON.stringify(DEFAULTS));
  ECO.listeners = [];

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function deepMerge(base) {
    var out = isPlainObject(base) ? JSON.parse(JSON.stringify(base)) : base;
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!isPlainObject(src)) continue;
      Object.keys(src).forEach(function (k) {
        if (isPlainObject(src[k]) && isPlainObject(out[k])) out[k] = deepMerge(out[k], src[k]);
        else out[k] = src[k];
      });
    }
    return out;
  }
  ECO.deepMerge = deepMerge;

  ECO.log = function () {
    if (!ECO.settings || !ECO.settings.debug) return;
    var args = Array.prototype.slice.call(arguments);
    console.log.apply(console, ['[EcoTek]'].concat(args));
  };
  ECO.warn = function () {
    var args = Array.prototype.slice.call(arguments);
    console.warn.apply(console, ['[EcoTek]'].concat(args));
  };

  ECO.loadSettings = function () {
    return Promise.all([
      chrome.storage.sync.get('eco_settings').catch(function () { return {}; }),
      chrome.storage.local.get('eco_api_key').catch(function () { return {}; })
    ]).then(function (res) {
      var sync = res[0] || {};
      var local = res[1] || {};
      ECO.settings = deepMerge(DEFAULTS, sync.eco_settings || {});
      ECO.settings.apiKey = local.eco_api_key || '';
      return ECO.settings;
    });
  };

  ECO.saveSettings = function (patch) {
    ECO.settings = deepMerge(ECO.settings, patch || {});
    var apiKey = ECO.settings.apiKey || '';
    var stored = deepMerge(ECO.settings);
    delete stored.apiKey;
    return Promise.all([
      chrome.storage.sync.set({ eco_settings: stored }),
      chrome.storage.local.set({ eco_api_key: apiKey })
    ]).then(function () {
      ECO.emit();
      return ECO.settings;
    });
  };

  ECO.emit = function () {
    ECO.listeners.forEach(function (fn) {
      try {
        fn(ECO.settings);
      } catch (e) {
        ECO.warn('listener error', e);
      }
    });
  };

  ECO.onSettings = function (fn) {
    ECO.listeners.push(fn);
  };

  chrome.storage.onChanged.addListener(function (changes, area) {
    var hit =
      (area === 'sync' && changes.eco_settings) ||
      (area === 'local' && changes.eco_api_key);
    if (!hit) return;
    ECO.loadSettings().then(function () {
      ECO.emit();
    });
  });

  /* ---------- text utils ---------- */

  ECO.norm = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  };

  ECO.hash = function (s) {
    var h = 5381;
    var str = String(s || '');
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };

  ECO.sleep = function (ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  };

  ECO.clamp = function (v, min, max) {
    return Math.min(max, Math.max(min, v));
  };

  ECO.debounce = function (fn, wait) {
    var t = null;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () {
        fn.apply(self, args);
      }, wait);
    };
  };

  ECO.fmtSeconds = function (s) {
    if (s == null || isNaN(s)) return '--';
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  /* ---------- history ---------- */

  var HIST_KEY = 'eco_history';

  ECO.history = {
    all: function () {
      return chrome.storage.local.get(HIST_KEY).then(function (r) {
        return r[HIST_KEY] || [];
      });
    },
    add: function (entry) {
      if (!ECO.settings.logHistory) return Promise.resolve(null);
      var item = deepMerge(
        {
          id: 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          ts: Date.now(),
          url: location.href,
          picked: null,
          correct: null,
          correctIndex: null
        },
        entry || {}
      );
      return ECO.history.all().then(function (list) {
        list.unshift(item);
        var max = Math.max(50, ECO.settings.maxHistory || 2000);
        var payload = {};
        payload[HIST_KEY] = list.slice(0, max);
        return chrome.storage.local.set(payload).then(function () {
          return item;
        });
      });
    },
    update: function (id, patch) {
      if (!id) return Promise.resolve(null);
      return ECO.history.all().then(function (list) {
        var i = list.findIndex(function (x) {
          return x.id === id;
        });
        if (i < 0) return null;
        list[i] = deepMerge(list[i], patch);
        var payload = {};
        payload[HIST_KEY] = list;
        return chrome.storage.local.set(payload).then(function () {
          return list[i];
        });
      });
    },
    clear: function () {
      return chrome.storage.local.remove(HIST_KEY);
    }
  };

  /* ---------- knowledge base (answers learned locally) ---------- */

  var KB_KEY = 'eco_kb';

  ECO.kb = {
    all: function () {
      return chrome.storage.local.get(KB_KEY).then(function (r) {
        return r[KB_KEY] || {};
      });
    },
    get: function (key) {
      return ECO.kb.all().then(function (db) {
        return db[key] || null;
      });
    },
    set: function (key, value) {
      return ECO.kb.all().then(function (db) {
        db[key] = value;
        var payload = {};
        payload[KB_KEY] = db;
        return chrome.storage.local.set(payload);
      });
    },
    importMany: function (obj) {
      return ECO.kb.all().then(function (db) {
        Object.keys(obj || {}).forEach(function (k) {
          db[k] = obj[k];
        });
        var payload = {};
        payload[KB_KEY] = db;
        return chrome.storage.local.set(payload);
      });
    },
    clear: function () {
      return chrome.storage.local.remove(KB_KEY);
    }
  };

  ECO.sendBg = function (msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || { ok: false, error: 'no response' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  };
})();
