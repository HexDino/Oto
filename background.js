/* EcoTek Study Agent - service worker: defaults, badge, optional LLM proxy */
'use strict';

try {
  importScripts('config.local.js');
} catch (e) {
  console.warn('[EcoTek] config.local.js chưa có — provider Claude sẽ tắt');
}

const CLAUDE = (self.ECO_CONFIG && self.ECO_CONFIG.claude) || {};
const claudeKeyState = { index: 0, lastError: '', lastUsedAt: 0, lastModel: '' };
let notifSeq = 0;

const DEFAULTS = {
  enabled: true,
  autoAdvance: true,
  bufferSeconds: 3,
  quizAssist: true,
  autoSelect: false,
  autoSelectThreshold: 80,
  agentMode: 'off',
  agentIntervalMs: 1500,
  agentMaxSteps: 200,
  useVision: true,
  escalateBelow: 70,
  showHud: true,
  logHistory: true,
  maxHistory: 2000,
  provider: 'local',
  apiBaseUrl: '',
  apiModel: '',
  apiHeaders: '',
  advanceOnVideoEnd: true,
  debug: false,
  selectors: { timer: '', next: '', confirm: '', question: '', answers: '' }
};

const SYSTEM_PROMPT = [
  'Bạn là trợ lý giải câu hỏi trắc nghiệm luật giao thông Việt Nam (lý thuyết lái xe).',
  'Bạn nhận được JSON gồm "question" và "options" (mảng đáp án theo thứ tự A, B, C, D).',
  'Chọn đúng một đáp án. Trả về DUY NHẤT JSON hợp lệ, không markdown, dạng:',
  '{"answer": <chỉ số 0-based của đáp án đúng>, "confidence": <số 0-100>, "explanation": "<giải thích ngắn gọn tiếng Việt, tối đa 200 ký tự>"}',
  'Nếu không chắc, hạ confidence xuống dưới 60 và nói rõ lý do trong explanation.'
].join(' ');

async function getSettings() {
  const sync = await chrome.storage.sync.get('eco_settings');
  const local = await chrome.storage.local.get('eco_api_key');
  return { ...DEFAULTS, ...(sync.eco_settings || {}), apiKey: local.eco_api_key || '' };
}

function updateBadge(settings) {
  const on = !!settings.enabled;
  chrome.action.setBadgeText({ text: on ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: on ? '#16a34a' : '#94a3b8' });
}

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  const stored = await chrome.storage.sync.get('eco_settings');
  if (!stored.eco_settings) await chrome.storage.sync.set({ eco_settings: DEFAULTS });
  updateBadge(s);
});

chrome.runtime.onStartup.addListener(async () => {
  updateBadge(await getSettings());
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.eco_settings) {
    updateBadge(await getSettings());
  }
});

function endpointOf(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (/\/chat\/completions$/.test(b)) return b;
  if (/\/v1$/.test(b)) return b + '/chat/completions';
  return b + '/v1/chat/completions';
}

function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    /* fall through */
  }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    return null;
  }
}

async function askModel(settings, payload) {
  const url = endpointOf(settings.apiBaseUrl);
  if (!url) return { ok: false, error: 'Chưa cấu hình API endpoint' };
  if (!settings.apiModel) return { ok: false, error: 'Chưa cấu hình model' };

  const headers = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = 'Bearer ' + settings.apiKey;
  if (settings.apiHeaders) {
    const extra = parseJsonLoose(settings.apiHeaders);
    if (extra && typeof extra === 'object') Object.assign(headers, extra);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.apiModel,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(payload) }
        ]
      })
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: 'HTTP ' + res.status + ' ' + body.slice(0, 200) };
    }
    const data = await res.json();
    const content =
      (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
      data.output_text ||
      '';
    const parsed = parseJsonLoose(content);
    if (!parsed) return { ok: false, error: 'Không parse được JSON từ model', raw: String(content).slice(0, 300) };

    const idx = Number(parsed.answer);
    if (!Number.isInteger(idx) || idx < 0 || idx >= (payload.options || []).length) {
      return { ok: false, error: 'Model trả về chỉ số đáp án không hợp lệ', raw: parsed };
    }
    return {
      ok: true,
      suggestion: {
        index: idx,
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 60)),
        explanation: String(parsed.explanation || '').slice(0, 400),
        source: 'api'
      }
    };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'API timeout' : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- Claude (Anthropic Messages API) ---------------- */

const CLAUDE_SYSTEM = [
  'Bạn là chuyên gia luật giao thông đường bộ Việt Nam, đang giúp học viên làm câu hỏi trắc nghiệm lý thuyết lái xe.',
  'Bạn nhận được JSON: {"question": "...", "options": ["...", ...]} — options theo đúng thứ tự A, B, C, D.',
  'Nếu có kèm HÌNH ẢNH, đó là hình minh họa hoặc biển báo của chính câu hỏi: hãy đọc kỹ ký hiệu, màu sắc, hình dạng, số liệu trong ảnh rồi mới chọn.',
  'Chọn đúng một đáp án đúng nhất theo quy định pháp luật hiện hành.',
  'Chỉ trả về JSON hợp lệ, không markdown, không thêm chữ nào ngoài JSON, đúng dạng:',
  '{"answer": <chỉ số 0-based của đáp án đúng>, "confidence": <số 0-100>, "explanation": "<giải thích ngắn, tối đa 160 ký tự, tiếng Việt>"}',
  'Nếu ảnh mờ hoặc không đủ thông tin để kết luận, đặt confidence <= 40 và nói rõ trong explanation.'
].join(' ');

function claudeKeys() {
  const keys = Array.isArray(CLAUDE.keys) ? CLAUDE.keys : [];
  return keys
    .map((k) => String(k || '').trim())
    .filter((k) => k.indexOf('sk-') === 0);
}

function claudeModel(tier) {
  const m = CLAUDE.models || {};
  if (tier === 'smart') return m.smart || m.fast || CLAUDE.model || 'claude-sonnet-5-5';
  return m.fast || CLAUDE.model || 'claude-haiku-5-5';
}

function claudeInfo() {
  const keys = claudeKeys();
  return {
    configured: keys.length > 0,
    model: claudeModel('fast'),
    smartModel: claudeModel('smart'),
    baseUrl: CLAUDE.baseUrl || 'https://api.anthropic.com',
    keyCount: keys.length,
    activeKey: keys.length ? claudeKeyState.index + 1 : 0,
    lastError: claudeKeyState.lastError,
    lastUsedAt: claudeKeyState.lastUsedAt,
    lastModel: claudeKeyState.lastModel
  };
}

function normalizeAnswer(parsed, count) {
  let a = parsed && parsed.answer;
  if (typeof a === 'string') {
    const m = a.trim().match(/^([A-Ha-h])\b/);
    if (m) a = m[1].toUpperCase().charCodeAt(0) - 65;
    else a = parseInt(a, 10);
  }
  a = Number(a);
  return Number.isInteger(a) && a >= 0 && a < count ? a : -1;
}

async function callClaude(key, payload, opts) {
  opts = opts || {};
  const base = String(CLAUDE.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const model = claudeModel(opts.tier);

  const content = [];
  if (opts.image && opts.image.data) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: opts.image.media_type || 'image/jpeg',
        data: opts.image.data
      }
    });
  }
  content.push({
    type: 'text',
    text: JSON.stringify({ question: payload.question, options: payload.options })
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40000);
  try {
    const res = await fetch(base + '/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': CLAUDE.apiVersion || '2023-06-01',
        // required when the request originates from a browser/extension context
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: Number(CLAUDE.maxTokens) || 900,
        // note: `temperature` is deprecated on Haiku 5.5 -> not sent
        system: CLAUDE_SYSTEM,
        messages: [{ role: 'user', content }]
      })
    });
    const raw = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        retryable: res.status === 401 || res.status === 403 || res.status === 429 || res.status >= 500,
        error: 'HTTP ' + res.status + ' ' + raw.slice(0, 220)
      };
    }
    const data = JSON.parse(raw);
    const text = (data.content || [])
      .map((c) => c.text || '')
      .join('\n');
    const parsed = parseJsonLoose(text);
    if (!parsed) {
      const cut = data.stop_reason === 'max_tokens' ? ' (bị cắt do max_tokens)' : '';
      return { ok: false, retryable: false, error: 'Model không trả JSON' + cut, raw: text.slice(0, 200) };
    }
    const idx = normalizeAnswer(parsed, (payload.options || []).length);
    if (idx < 0) {
      return { ok: false, retryable: false, error: 'Chỉ số đáp án không hợp lệ', raw: text.slice(0, 200) };
    }
    return {
      ok: true,
      model: data.model || model,
      usage: data.usage || null,
      suggestion: {
        index: idx,
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 70)),
        explanation: String(parsed.explanation || '').slice(0, 400),
        source: 'claude'
      }
    };
  } catch (e) {
    return {
      ok: false,
      retryable: true,
      error: e && e.name === 'AbortError' ? 'Claude timeout' : String(e)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function claudeAnswer(payload, opts) {
  const keys = claudeKeys();
  if (!keys.length) return { ok: false, error: 'Chưa có key trong config.local.js' };

  let lastErr = '';
  for (let i = 0; i < keys.length; i++) {
    const idx = (claudeKeyState.index + i) % keys.length;
    const r = await callClaude(keys[idx], payload, opts);
    if (r.ok) {
      claudeKeyState.index = idx;
      claudeKeyState.lastError = '';
      claudeKeyState.lastUsedAt = Date.now();
      claudeKeyState.lastModel = r.model;
      return r;
    }
    lastErr = r.error;
    claudeKeyState.lastError = r.error;
    if (!r.retryable) break;
  }
  return { ok: false, error: lastErr || 'Claude lỗi' };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'ECO_LLM_ANSWER') {
    (async () => {
      const payload = {
        question: String(msg.question || '').slice(0, 2000),
        options: (msg.options || []).map((o) => String(o).slice(0, 400))
      };
      if (!payload.question || payload.options.length < 2) {
        sendResponse({ ok: false, error: 'Thiếu dữ liệu câu hỏi' });
        return;
      }
      const tier = msg.tier === 'smart' ? 'smart' : 'fast';
      let image = null;
      if (msg.image && msg.image.data && String(msg.image.data).length < 3000000) {
        image = { media_type: msg.image.media_type || 'image/jpeg', data: msg.image.data };
      }
      sendResponse(await claudeAnswer(payload, { tier, image }));
    })();
    return true;
  }

  if (msg.type === 'ECO_ALERT') {
    const on = !!msg.on;
    chrome.action.setBadgeText({ text: on ? '!' : 'ON' });
    chrome.action.setBadgeBackgroundColor({ color: on ? '#dc2626' : '#16a34a' });
    chrome.action.setTitle({
      title: on ? 'EcoTek: đồng hồ ghi nhận giờ đang TẠM DỪNG' : 'EcoTek Study Agent'
    });
    try {
      if (on) {
        notifSeq += 1;
        const id = 'eco-idle-' + notifSeq;
        chrome.notifications.create(
          id,
          {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: 'Đồng hồ học đã tạm dừng',
            message: 'Quay lại tab học và bấm "tiếp tục" để tiếp tục ghi nhận giờ.',
            priority: 2,
            requireInteraction: true
          },
          () => {
            void chrome.runtime.lastError;
          }
        );
        chrome.notifications.getAll((all) => {
          Object.keys(all || {}).forEach((k) => {
            if (k !== id && k.indexOf('eco-idle') === 0) chrome.notifications.clear(k);
          });
        });
      } else {
        chrome.notifications.getAll((all) => {
          Object.keys(all || {}).forEach((k) => {
            if (k.indexOf('eco-idle') === 0) chrome.notifications.clear(k);
          });
        });
      }
    } catch (e) {
      /* notifications permission missing -> badge still works */
    }
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === 'ECO_LLM_STATUS') {
    sendResponse(Object.assign({ ok: true }, claudeInfo()));
    return;
  }

  if (msg.type === 'ECO_LLM_TEST') {
    (async () => {
      const t0 = Date.now();
      const r = await claudeAnswer({
        question: 'Biển báo hình tròn, viền đỏ, nền trắng là loại biển báo gì?',
        options: ['Biển báo cấm', 'Biển chỉ dẫn', 'Biển hiệu lệnh', 'Biển phụ']
      });
      sendResponse(Object.assign({ ms: Date.now() - t0 }, r));
    })();
    return true;
  }

  // the page countdown lives on <canvas> and in the page's JS scope: install a
  // MAIN world hook so the content script can see the real end_time
  if (msg.type === 'ECO_INJECT_MAIN') {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'no tab' });
      return;
    }
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [0] },
        world: 'MAIN',
        files: ['inject/hook.js']
      })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === 'ECO_API_SUGGEST') {
    (async () => {
      const settings = await getSettings();
      if (settings.provider !== 'api') {
        sendResponse({ ok: false, error: 'Provider đang là local' });
        return;
      }
      const payload = {
        question: String(msg.question || '').slice(0, 1200),
        options: (msg.options || []).map((o) => String(o).slice(0, 400))
      };
      if (!payload.question || payload.options.length < 2) {
        sendResponse({ ok: false, error: 'Thiếu dữ liệu câu hỏi' });
        return;
      }
      sendResponse(await askModel(settings, payload));
    })();
    return true;
  }

  if (msg.type === 'ECO_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage?.();
    sendResponse({ ok: true });
    return;
  }
});
