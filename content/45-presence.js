/* EcoTek Study Agent - presence watchdog.
 *
 * KHÔNG tự cuộn / tự bấm "tiếp tục". Chỉ theo dõi và báo động khi đồng hồ
 * ghi nhận giờ học bị tạm dừng, để người học biết mà quay lại bấm.
 */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.presence) return;

  var IDLE_WARN = 60; // giây không tương tác thì bắt đầu cảnh báo
  var REPEAT_MS = 30000; // nhắc lại mỗi 30 giây khi đồng hồ đang tạm dừng
  var lastActivity = Date.now();
  var lastMark = 0;
  var popupSeen = false;
  var lastAlertAt = 0;
  var titleTimer = null;
  var originalTitle = null;

  function beep() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!beep.ctx) beep.ctx = new AC();
      var ctx = beep.ctx;
      if (ctx.state === 'suspended') ctx.resume();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.start(t);
      osc.stop(t + 0.5);
    } catch (e) {
      /* autoplay policy may block it, notification is the fallback */
    }
  }

  function mark() {
    var now = Date.now();
    if (now - lastMark < 800) return;
    lastMark = now;
    lastActivity = now;
  }

  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'scroll'].forEach(function (ev) {
    document.addEventListener(ev, mark, { passive: true, capture: true });
  });

  function flashTitle() {
    if (titleTimer) return;
    originalTitle = document.title;
    var on = false;
    titleTimer = setInterval(function () {
      on = !on;
      document.title = on ? '⏸ TẠM DỪNG GHI GIỜ — quay lại bấm tiếp tục' : originalTitle;
    }, 1200);
  }

  function restoreTitle() {
    if (!titleTimer) return;
    clearInterval(titleTimer);
    titleTimer = null;
    if (originalTitle) document.title = originalTitle;
    originalTitle = null;
  }

  function popupVisible() {
    var el = document.getElementById('inactivity-popup');
    if (!el) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0;
  }

  // ngưỡng inactivity do server trả về, trang cache trong localStorage
  function idleLimit() {
    try {
      var n = parseInt(localStorage.getItem('alert_time_no_interaction'), 10);
      return isFinite(n) && n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function tick() {
    if (!ECO.settings || !ECO.settings.enabled) return;

    var popup = popupVisible();
    var idle = (Date.now() - lastActivity) / 1000;

    if (popup && !popupSeen) {
      popupSeen = true;
      lastAlertAt = Date.now();
      if (ECO.hud) ECO.hud.note('Đồng hồ ĐANG TẠM DỪNG — bấm "tiếp tục" trên trang', 'warn');
      ECO.sendBg({ type: 'ECO_ALERT', kind: 'inactivity', on: true });
      flashTitle();
      beep();
      return;
    }

    // vẫn đang dừng: nhắc lại để không bị quên khi đang làm việc ở tab khác
    if (popup && popupSeen) {
      if (Date.now() - lastAlertAt >= REPEAT_MS) {
        lastAlertAt = Date.now();
        ECO.sendBg({ type: 'ECO_ALERT', kind: 'inactivity', on: true, repeat: true });
        beep();
      }
      return;
    }

    if (!popup && popupSeen) {
      popupSeen = false;
      lastActivity = Date.now();
      if (ECO.hud) ECO.hud.note('Đã tiếp tục ghi nhận giờ học', 'ok');
      ECO.sendBg({ type: 'ECO_ALERT', kind: 'inactivity', on: false });
      restoreTitle();
      return;
    }

    if (popup) return;

    var limit = idleLimit();
    if (limit > 0) {
      var left = Math.round(limit - idle);
      if (left <= Math.max(30, limit * 0.35)) {
        if (ECO.hud) {
          ECO.hud.note('Còn ~' + Math.max(0, left) + 's trước khi đồng hồ tạm dừng', 'warn');
        }
      }
      return;
    }

    if (idle >= IDLE_WARN) {
      var mins = Math.floor(idle / 60);
      var label = mins >= 1 ? mins + ' phút' : Math.round(idle) + ' giây';
      if (ECO.hud) ECO.hud.note('Không tương tác ' + label + ' — sắp bị tạm dừng ghi giờ', 'warn');
    }
  }

  setInterval(tick, 2000);

  ECO.presence = {
    idleSeconds: function () {
      return (Date.now() - lastActivity) / 1000;
    },
    popupVisible: popupVisible
  };
})();
