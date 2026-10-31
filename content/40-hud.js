/* EcoTek Study Agent - floating HUD (shadow DOM, isolated from page CSS) */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.hud) return;

  var host = null;
  var root = null;
  var els = {};
  var buffer = null;

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;margin:0;padding:0;font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,Arial,sans-serif}',
    '.card{position:fixed;right:16px;bottom:16px;width:268px;background:#ffffff;border:1px solid #d7e3dd;border-radius:14px;',
    'box-shadow:0 10px 30px rgba(15,60,45,.16),0 1px 3px rgba(15,60,45,.10);overflow:hidden;color:#12211c;font-size:12px;z-index:2147483000}',
    '.head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:linear-gradient(180deg,#f4fbf7,#eef7f2);border-bottom:1px solid #e3eee8;cursor:default}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.15)}',
    '.dot.off{background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.15)}',
    '.title{font-weight:650;font-size:12px;letter-spacing:.2px;color:#0f3d2e;flex:1}',
    '.ico{border:0;background:transparent;color:#5b7268;cursor:pointer;font-size:12px;line-height:1;padding:3px 4px;border-radius:6px}',
    '.ico:hover{background:#e6f2ec;color:#0f3d2e}',
    '.body{padding:9px 10px 10px;display:flex;flex-direction:column;gap:7px}',
    '.row{display:flex;align-items:center;gap:7px;line-height:1.35}',
    '.k{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#7b8f86;min-width:34px}',
    '.v{flex:1;color:#12211c;font-variant-numeric:tabular-nums}',
    '.v.muted{color:#8b9c94}',
    '.actions{display:flex;gap:6px;margin-top:2px}',
    '.btn{flex:1;border:1px solid #cfe3d8;background:#f6fbf8;color:#0f5c3f;border-radius:8px;padding:6px 8px;font-size:11px;font-weight:600;cursor:pointer}',
    '.btn:hover{background:#e9f6ef}',
    '.btn.primary{background:#16a34a;border-color:#16a34a;color:#fff}',
    '.btn.primary:hover{background:#128a3e}',
    '.buffer{display:none;align-items:center;gap:8px;padding:7px 10px;background:#fff8e6;border-top:1px solid #f2e3bd;color:#7a5a12;font-size:11px}',
    '.buffer.on{display:flex}',
    '.buffer b{font-variant-numeric:tabular-nums}',
    '.cancel{margin-left:auto;border:1px solid #e6cf9a;background:#fff;color:#7a5a12;border-radius:6px;padding:3px 7px;font-size:10px;cursor:pointer}',
    '.toast{position:fixed;right:16px;bottom:186px;max-width:268px;background:#0f3d2e;color:#fff;padding:8px 10px;border-radius:10px;',
    'font-size:11px;line-height:1.4;box-shadow:0 8px 24px rgba(15,60,45,.25);opacity:0;transform:translateY(6px);transition:.18s;pointer-events:none}',
    '.toast.on{opacity:1;transform:none}',
    '.toast.warn{background:#8a4b12}',
    '.card.collapsed .body,.card.collapsed .buffer{display:none}',
    '.card.collapsed .head{border-bottom:0}'
  ].join('');

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.id = 'eco-hud';
    host.setAttribute('data-eco', '1');
    root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="head">' +
      '<span class="dot"></span>' +
      '<span class="title">EcoTek Agent</span>' +
      '<button class="ico" data-act="collapse" title="Thu gọn">–</button>' +
      '<button class="ico" data-act="hide" title="Ẩn bảng nổi">×</button>' +
      '</div>' +
      '<div class="body">' +
      '<div class="row"><span class="k">Giờ</span><span class="v muted" data-el="timer">Chưa thấy đồng hồ</span></div>' +
      '<div class="row"><span class="k">Gợi ý</span><span class="v muted" data-el="quiz">Chưa thấy câu hỏi</span></div>' +
      '<div class="row" data-el="noteRow" hidden><span class="k">Lưu ý</span><span class="v" data-el="note"></span></div>' +
      '<div class="actions">' +
      '<button class="btn primary" data-act="advance">Chuyển bài</button>' +
      '<button class="btn" data-act="rescan">Quét lại</button>' +
      '</div>' +
      '</div>' +
      '<div class="buffer"><span>Chuyển sau <b data-el="buf">3</b>s</span><button class="cancel" data-act="cancel">Hủy</button></div>';

    var toast = document.createElement('div');
    toast.className = 'toast';

    root.appendChild(card);
    root.appendChild(toast);
    document.documentElement.appendChild(host);

    els = {
      card: card,
      dot: card.querySelector('.dot'),
      timer: card.querySelector('[data-el="timer"]'),
      quiz: card.querySelector('[data-el="quiz"]'),
      note: card.querySelector('[data-el="note"]'),
      noteRow: card.querySelector('[data-el="noteRow"]'),
      buf: card.querySelector('[data-el="buf"]'),
      bufferBar: card.querySelector('.buffer'),
      toast: toast
    };

    root.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'collapse') card.classList.toggle('collapsed');
      if (act === 'hide') ECO.hud.unmount(true);
      if (act === 'cancel' && buffer) buffer.cancel();
      if (act === 'advance') {
        if (ECO.timer) ECO.timer.advance({ manual: true });
      }
      if (act === 'rescan') {
        if (ECO.quiz) ECO.quiz.lastSignature = '';
        if (ECO.quiz) ECO.quiz.evaluate();
        if (ECO.timer) ECO.timer.scanHinted();
      }
    });
  }

  function setText(el, text, muted) {
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('muted', !!muted);
  }

  function unmount(remember) {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    root = null;
    els = {};
    if (remember) ECO.saveSettings({ showHud: false });
  }

  function toast(msg, kind) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.className = 'toast on' + (kind === 'warn' ? ' warn' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      if (els.toast) els.toast.className = 'toast';
    }, 2600);
  }

  function bufferCountdown(seconds) {
    return new Promise(function (resolve) {
      mount();
      if (!els.bufferBar) return resolve(true);
      var left = Math.max(0, Math.round(seconds));
      var done = false;

      var finish = function (ok) {
        if (done) return;
        done = true;
        buffer = null;
        if (els.bufferBar) els.bufferBar.classList.remove('on');
        resolve(ok);
      };

      buffer = { cancel: function () { finish(false); } };
      els.bufferBar.classList.add('on');

      (function tick() {
        if (done) return;
        if (els.buf) els.buf.textContent = String(left);
        if (left <= 0) return finish(true);
        left -= 1;
        setTimeout(tick, 1000);
      })();
    });
  }

  ECO.hud = {
    mount: function () {
      if (!ECO.settings.showHud) return;
      mount();
    },
    unmount: unmount,
    timer: function (text, seconds) {
      if (!root) return;
      setText(els.timer, text, seconds == null);
    },
    quiz: function (text) {
      if (!root) return;
      setText(els.quiz, text, false);
    },
    note: function (text, kind) {
      if (!root) return;
      if (els.noteRow) els.noteRow.hidden = !text;
      if (els.note) {
        els.note.textContent = text || '';
        els.note.style.color = kind === 'warn' ? '#92400e' : '#0f5c3f';
      }
    },
    toast: toast,
    bufferCountdown: bufferCountdown,
    setEnabled: function (on) {
      if (!root) return;
      els.dot.classList.toggle('off', !on);
    },
    isMounted: function () {
      return !!(host && host.isConnected);
    }
  };
})();
