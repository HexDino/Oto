'use strict';

const TARGET_HOST = 'hoclythuyetlaixe.eco-tek.com.vn';
const $ = (id) => document.getElementById(id);

let settings = null;
let activeTabId = null;
let onTarget = false;
let pollTimer = null;
let quizSig = '';

/* ---------- helpers ---------- */

function sendToTab(msg) {
  return new Promise((resolve) => {
    if (activeTabId == null) return resolve(null);
    try {
      chrome.tabs.sendMessage(activeTabId, msg, (resp) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(resp || null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function save(patch) {
  return ECO.saveSettings(patch).then((s) => {
    settings = s;
    return s;
  });
}

function setHint(text) {
  const el = $('hint');
  el.textContent = text || '';
  el.classList.toggle('on', !!text);
}

/* ---------- init ---------- */

async function init() {
  settings = await ECO.loadSettings();

  $('enabled').checked = !!settings.enabled;
  $('autoAdvance').checked = !!settings.autoAdvance;
  $('bufferSeconds').value = settings.bufferSeconds;
  $('quizAssist').checked = !!settings.quizAssist;
  $('autoSelect').checked = !!settings.autoSelect;
  $('autoSelectThreshold').value = settings.autoSelectThreshold;
  $('thresholdValue').textContent = settings.autoSelectThreshold;
  $('agentMode').value = settings.agentMode || 'off';
  $('showHud').checked = !!settings.showHud;
  $('logHistory').checked = !!settings.logHistory;
  $('debug').checked = !!settings.debug;
  $('provider').value = settings.provider || 'local';
  $('apiBaseUrl').value = settings.apiBaseUrl || '';
  $('apiModel').value = settings.apiModel || '';
  $('apiKey').value = settings.apiKey || '';
  $('apiHeaders').value = settings.apiHeaders || '';
  $('selNext').value = (settings.selectors && settings.selectors.next) || '';
  $('selTimer').value = (settings.selectors && settings.selectors.timer) || '';
  $('selQuestion').value = (settings.selectors && settings.selectors.question) || '';
  $('selAnswers').value = (settings.selectors && settings.selectors.answers) || '';

  syncVisibility();
  bind();
  await detectTab();
  renderHistory();
  refreshClaudeInfo();
}

async function refreshClaudeInfo() {
  const r = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ECO_LLM_STATUS' }, (resp) => {
      void chrome.runtime.lastError;
      resolve(resp || null);
    });
  });
  const note = $('claudeNote');
  if (!r || !r.ok) {
    note.textContent = 'Không đọc được cấu hình.';
    return;
  }
  if (!r.configured) {
    note.textContent = 'Chưa có key. Tạo config.local.js từ config.example.js.';
    return;
  }
  note.textContent =
    r.model + ' · ' + r.keyCount + ' key · đang dùng key #' + r.activeKey + (r.lastError ? ' · lỗi: ' + r.lastError : '');
}

function syncVisibility() {
  $('thresholdField').style.display = $('autoSelect').checked ? 'flex' : 'none';
  $('apiBlock').hidden = $('provider').value !== 'api';
}

async function detectTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  activeTabId = tab ? tab.id : null;
  let host = '';
  try {
    host = tab && tab.url ? new URL(tab.url).host : '';
  } catch (e) {
    host = '';
  }
  onTarget = host === TARGET_HOST;
  $('hostLabel').textContent = onTarget ? host : host || 'không xác định';

  const ping = onTarget ? await sendToTab({ type: 'ECO_PING' }) : null;
  if (!onTarget) {
    setHint('Tab hiện tại không phải trang học. Mở ' + TARGET_HOST + ' rồi mở lại popup.');
  } else if (!ping) {
    setHint('Content script chưa chạy trên tab này. Tải lại trang (Ctrl+R) rồi thử lại.');
  } else {
    setHint('');
  }

  $('btnAdvance').disabled = !ping;
  $('btnScan').disabled = !ping;
  startPolling();
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshStatus, 1000);
  refreshStatus();
}

async function refreshStatus() {
  const st = onTarget ? await sendToTab({ type: 'ECO_STATUS' }) : null;
  if (!st) {
    $('stTimer').textContent = '—';
    $('stAdvance').textContent = '—';
    $('stQuiz').textContent = '—';
    return;
  }
  const t = st.timer || {};
  if (t.noCountdown) {
    $('stTimer').textContent = 'không cần chờ';
  } else if (t.hasTimer) {
    $('stTimer').textContent = 'còn ' + ECO.fmtSeconds(t.remaining) + (t.source ? ' · ' + t.source : '');
  } else {
    $('stTimer').textContent = 'chưa thấy đồng hồ';
  }

  if (t.busy) $('stAdvance').textContent = 'đang chuyển…';
  else if (t.error) $('stAdvance').textContent = t.error;
  else if (t.advanceCount) $('stAdvance').textContent = 'đã chuyển ' + t.advanceCount + ' lần';
  else $('stAdvance').textContent = st.enabled ? 'chờ hết giờ' : 'đang tắt';

  const q = st.quiz || {};
  if (q.suggestion) {
    $('stQuiz').textContent =
      q.suggestion.letter + ' · ' + q.suggestion.confidence + '% · ' + q.suggestion.source;
  } else if (q.hasQuestion) {
    $('stQuiz').textContent = 'đã đọc câu hỏi, chưa có gợi ý';
  } else {
    $('stQuiz').textContent = 'chưa thấy câu hỏi';
  }

  const ag = st.agent || {};
  if (ag.running) {
    $('stAgent').textContent = (ag.mode === 'auto' ? 'tự chọn' : 'gợi ý') + ' · ' + ag.steps + ' bước';
  } else if (ag.mode && ag.mode !== 'off') {
    $('stAgent').textContent = 'đang tắt · ' + (ag.lastError || 'chưa chạy');
  } else {
    $('stAgent').textContent = 'tắt';
  }

  renderQuiz(st);
}

/* ---------- quiz panel ---------- */

function renderQuiz(st) {
  const panel = $('quizPanel');
  const q = (st && st.quiz) || {};
  if (!q.hasQuestion) {
    panel.hidden = true;
    quizSig = '';
    return;
  }
  panel.hidden = false;

  const sig = (q.question || '') + '|' + (q.options || []).join('|');
  if (sig !== quizSig) {
    quizSig = sig;
    $('quizQuestion').textContent = q.question || '';
    const box = $('quizOptions');
    box.innerHTML = '';
    (q.options || []).forEach((text, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quiz-opt';
      const letter = document.createElement('b');
      letter.textContent = String.fromCharCode(65 + i);
      const span = document.createElement('span');
      span.textContent = text;
      b.appendChild(letter);
      b.appendChild(span);
      b.addEventListener('click', () => pickOption(i));
      box.appendChild(b);
    });
    $('quizAnswer').value = '';
  }

  const sug = q.suggestion;
  $('quizSuggest').textContent = sug ? sug.letter + ' · ' + sug.confidence + '%' : 'chưa có';
  $('quizSuggest').className = 'chip' + (sug && sug.confidence < 60 ? ' warn' : '');
  Array.prototype.forEach.call($('quizOptions').children, (el, i) => {
    el.classList.toggle('suggested', !!(sug && sug.index === i));
  });
  $('quizNote').textContent = sug
    ? sug.explanation
    : 'Chưa có gợi ý. Copy câu hỏi sang WorkBuddy rồi dán đáp án vào ô trên.';
}

async function pickOption(index) {
  const r = await sendToTab({ type: 'ECO_QUIZ_PICK', index });
  if (!r || !r.ok) setHint('Không chọn được đáp án trên trang. Thử tải lại tab.');
  else setHint('');
}

async function copyQuestion() {
  const st = await sendToTab({ type: 'ECO_STATUS' });
  const q = st && st.quiz;
  if (!q || !q.hasQuestion) {
    setHint('Chưa đọc được câu hỏi trên trang.');
    return;
  }
  const text =
    'Câu hỏi trắc nghiệm luật giao thông Việt Nam:\n' +
    q.question +
    '\n\n' +
    (q.options || []).map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join('\n') +
    '\n\nChỉ trả lời: chữ cái đáp án đúng + một câu giải thích ngắn.';
  try {
    await navigator.clipboard.writeText(text);
    $('quizNote').textContent = 'Đã copy. Dán vào WorkBuddy, rồi dán đáp án (A/B/C/D) vào ô trên.';
  } catch (e) {
    $('quizNote').textContent = 'Không copy được. Bấm "Quét trang" để lấy nội dung thủ công.';
  }
}

/* ---------- bindings ---------- */

function bind() {
  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

  $('autoAdvance').addEventListener('change', (e) => save({ autoAdvance: e.target.checked }));

  $('bufferSeconds').addEventListener('change', (e) => {
    const v = ECO.clamp(parseInt(e.target.value, 10) || 0, 0, 60);
    e.target.value = v;
    save({ bufferSeconds: v });
  });

  $('quizAssist').addEventListener('change', (e) => save({ quizAssist: e.target.checked }));

  $('autoSelect').addEventListener('change', (e) => {
    save({ autoSelect: e.target.checked }).then(syncVisibility);
  });

  $('autoSelectThreshold').addEventListener('input', (e) => {
    $('thresholdValue').textContent = e.target.value;
  });
  $('autoSelectThreshold').addEventListener('change', (e) => {
    save({ autoSelectThreshold: parseInt(e.target.value, 10) });
  });

  $('showHud').addEventListener('change', (e) => save({ showHud: e.target.checked }));
  $('logHistory').addEventListener('change', (e) => save({ logHistory: e.target.checked }));
  $('debug').addEventListener('change', (e) => save({ debug: e.target.checked }));

  $('provider').addEventListener('change', (e) => {
    save({ provider: e.target.value }).then(syncVisibility);
  });

  $('agentMode').addEventListener('change', (e) => {
    const mode = e.target.value;
    save({ agentMode: mode });
    $('agentNote').textContent =
      mode === 'auto'
        ? 'Agent sẽ tự bấm đáp án. Chỉ dùng khi ôn tập, không dùng khi thi thật.'
        : 'Chỉ dùng khi ôn tập. Không tự nộp bài.';
  });

  $('btnTestClaude').addEventListener('click', async () => {
    const btn = $('btnTestClaude');
    btn.disabled = true;
    $('claudeNote').textContent = 'Đang gọi Claude…';
    const r = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'ECO_LLM_TEST' }, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp || null);
      });
    });
    btn.disabled = false;
    if (!r) {
      $('claudeNote').textContent = 'Không có phản hồi từ background.';
      return;
    }
    if (!r.ok) {
      $('claudeNote').textContent = 'Lỗi: ' + (r.error || 'không rõ');
      return;
    }
    $('claudeNote').textContent =
      'OK · ' +
      (r.model || '') +
      ' · ' +
      r.ms +
      'ms · đáp án ' +
      String.fromCharCode(65 + r.suggestion.index) +
      ' (' +
      r.suggestion.confidence +
      '%)';
  });

  ['apiBaseUrl', 'apiModel', 'apiKey', 'apiHeaders'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      const patch = {};
      patch[id] = e.target.value.trim();
      save(patch);
    });
  });

  ['selNext', 'selTimer', 'selQuestion', 'selAnswers'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      const key = id.replace('sel', '').toLowerCase();
      const selectors = Object.assign({}, settings.selectors || {}, { [key]: e.target.value.trim() });
      save({ selectors });
    });
  });

  $('btnAdvance').addEventListener('click', async () => {
    $('btnAdvance').disabled = true;
    const r = await sendToTab({ type: 'ECO_ADVANCE' });
    $('btnAdvance').disabled = false;
    if (!r) setHint('Không gửi được lệnh. Tải lại trang rồi thử lại.');
    else if (!r.ok) setHint('Không chuyển được: ' + (r.error || 'không tìm thấy nút chuyển bài'));
    else setHint('');
  });

  $('btnCopyQuiz').addEventListener('click', copyQuestion);

  $('btnPickSuggested').addEventListener('click', async () => {
    let st = await sendToTab({ type: 'ECO_STATUS' });
    let idx = st && st.quiz && st.quiz.suggestion ? st.quiz.suggestion.index : null;
    if (idx == null) {
      const r = await sendToTab({ type: 'ECO_QUIZ_NOW' });
      idx = r && r.suggestion ? r.suggestion.index : null;
    }
    if (idx == null) {
      setHint('Chưa đọc được câu hỏi trên trang này.');
      return;
    }
    pickOption(idx);
  });

  $('quizAnswer').addEventListener('input', (e) => {
    const raw = e.target.value || '';
    const m = raw.match(/(?:đáp án|dap an|chọn|chon)?\s*([A-Ha-h])\b/);
    if (!m) return;
    const idx = m[1].toUpperCase().charCodeAt(0) - 65;
    pickOption(idx);
    e.target.value = '';
  });

  $('btnScan').addEventListener('click', async () => {
    const r = await sendToTab({ type: 'ECO_SCAN' });
    const out = $('scanOut');
    if (!r) {
      out.hidden = false;
      out.textContent = 'Không nhận được phản hồi từ trang. Tải lại trang rồi thử lại.';
      return;
    }
    out.hidden = false;
    out.textContent = JSON.stringify(r.report, null, 2).slice(0, 6000);
  });

  $('btnSaveApi').addEventListener('click', async () => {
    const url = $('apiBaseUrl').value.trim();
    const note = $('apiNote');
    if (!url) {
      note.textContent = 'Nhập endpoint trước.';
      return;
    }
    let origin;
    try {
      origin = new URL(url).origin + '/*';
    } catch (e) {
      note.textContent = 'Endpoint không hợp lệ.';
      return;
    }
    const granted = await new Promise((resolve) => {
      chrome.permissions.request({ origins: [origin] }, (ok) => {
        resolve(!!ok && !chrome.runtime.lastError);
      });
    });
    if (!granted) {
      note.textContent = 'Bạn chưa cấp quyền cho ' + origin + '. Agent chỉ dùng được chế độ cục bộ.';
      return;
    }
    await save({
      apiBaseUrl: url,
      apiModel: $('apiModel').value.trim(),
      apiKey: $('apiKey').value.trim(),
      apiHeaders: $('apiHeaders').value.trim(),
      provider: 'api'
    });
    $('provider').value = 'api';
    syncVisibility();
    note.textContent = 'Đã lưu. Agent sẽ gọi API cho các câu chưa có trong kho.';
  });

  $('btnReset').addEventListener('click', async () => {
    if (!confirm('Khôi phục toàn bộ cài đặt về mặc định? (Lịch sử và kho đáp án vẫn giữ)')) return;
    const apiKey = settings.apiKey || '';
    const fresh = JSON.parse(JSON.stringify(ECO.DEFAULTS));
    delete fresh.apiKey;
    await chrome.storage.sync.set({ eco_settings: fresh });
    await save({ apiKey });
    location.reload();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      document.querySelectorAll('[data-panel]').forEach((p) => {
        p.hidden = p.dataset.panel !== name;
      });
      if (name === 'history') renderHistory();
    });
  });

  $('btnClear').addEventListener('click', async () => {
    if (!confirm('Xóa toàn bộ lịch sử câu hỏi?')) return;
    await ECO.history.clear();
    renderHistory();
  });

  $('btnExportJson').addEventListener('click', () => exportData('json'));
  $('btnExportCsv').addEventListener('click', () => exportData('csv'));
}

/* ---------- history ---------- */

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

async function renderHistory() {
  const list = await ECO.history.all();
  $('histCount').textContent = list.length + ' câu';
  const box = $('histList');
  box.innerHTML = '';

  if (!list.length) {
    box.innerHTML = '<div class="empty">Chưa có câu hỏi nào.<br/>Mở một bài trắc nghiệm để agent bắt đầu ghi log.</div>';
    return;
  }

  list.slice(0, 60).forEach((item) => {
    const el = document.createElement('div');
    el.className = 'hist-item';

    const q = document.createElement('div');
    q.className = 'q';
    q.textContent = (item.question || '(không đọc được câu hỏi)').slice(0, 140);
    el.appendChild(q);

    const meta = document.createElement('div');
    meta.className = 'hist-meta';

    if (Number.isInteger(item.suggestedIndex)) {
      const chip = document.createElement('span');
      chip.className = 'chip' + (item.confidence < 60 ? ' warn' : '');
      chip.textContent = 'Gợi ý ' + String.fromCharCode(65 + item.suggestedIndex) + ' · ' + item.confidence + '%';
      meta.appendChild(chip);
    }
    if (item.correct === true) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = 'đúng';
      meta.appendChild(c);
    } else if (item.correct === false) {
      const c = document.createElement('span');
      c.className = 'chip bad';
      c.textContent = 'sai';
      meta.appendChild(c);
    }
    const src = document.createElement('span');
    src.textContent = item.source || 'local';
    meta.appendChild(src);

    const time = document.createElement('span');
    time.textContent = fmtTime(item.ts);
    meta.appendChild(time);

    el.appendChild(meta);
    box.appendChild(el);
  });
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

async function exportData(kind) {
  const list = await ECO.history.all();
  if (!list.length) return;
  const stamp = new Date().toISOString().slice(0, 10);

  if (kind === 'json') {
    download('ecotek-history-' + stamp + '.json', JSON.stringify(list, null, 2), 'application/json');
    return;
  }

  const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const rows = [['thoi_gian', 'cau_hoi', 'dap_an_goi_y', 'do_tin_cay', 'nguon', 'giai_thich', 'dap_an_dung', 'dung_sai']];
  list.forEach((it) => {
    rows.push([
      new Date(it.ts).toISOString(),
      it.question || '',
      Number.isInteger(it.suggestedIndex) ? String.fromCharCode(65 + it.suggestedIndex) : '',
      it.confidence != null ? it.confidence : '',
      it.source || '',
      it.explanation || '',
      Number.isInteger(it.correctIndex) ? String.fromCharCode(65 + it.correctIndex) : '',
      it.correct === true ? 'dung' : it.correct === false ? 'sai' : ''
    ]);
  });
  download('ecotek-history-' + stamp + '.csv', '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\n'), 'text/csv');
}

document.addEventListener('DOMContentLoaded', init);
