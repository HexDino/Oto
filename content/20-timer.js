/* EcoTek Study Agent - countdown tracking + auto advance.
 *
 * This site does NOT print the countdown into the DOM: the widget
 * (section.ect_countdown) paints hours/minutes/seconds on <canvas>, and the real
 * deadline comes from POST /slide/countdown-start/ -> result.end_time (epoch s).
 * Both are captured by inject/hook.js in the MAIN world and forwarded here.
 * A DOM text scan stays as a generic fallback.
 */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.Timer) return;

  var HINT_SELECTOR = [
    '[class*="time"]',
    '[class*="count"]',
    '[class*="clock"]',
    '[class*="timer"]',
    '[class*="remain"]',
    '[id*="time"]',
    '[id*="count"]'
  ].join(',');

  // the site itself clicks #next-slide-button 5s after the countdown ends
  var SITE_AUTO_NEXT_DELAY = 7;

  function parseTime(text) {
    if (!text) return null;
    var t = String(text).replace(/\s+/g, ' ').trim();
    if (!t || t.length > 28) return null;
    var m = t.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/);
    if (m) {
      var h = m[1] ? parseInt(m[1], 10) : 0;
      var mm = parseInt(m[2], 10);
      var ss = parseInt(m[3], 10);
      if (ss < 60 && mm < 60 && h < 24) return h * 3600 + mm * 60 + ss;
    }
    var s = t.match(/(\d{1,4})\s*(?:giây|giay|sec|seconds?|s)\b/i);
    if (s) return parseInt(s[1], 10);
    return null;
  }

  function Timer() {
    this.endTime = null; // epoch seconds, from the site API
    this.noMakeAttend = false;
    this.siteAutoNext = null;
    this.canvasRemaining = null;
    this.canvasAt = 0;
    this.canvasParts = {};
    this.remaining = null;
    this.source = null;
    this.domLock = null;
    this.candidates = new Map();
    this.mutationObserver = null;
    this.intervalId = null;
    this.expiredSignature = null;
    this.busy = false;
    this.advanceCount = 0;
    this.lastAdvanceAt = 0;
    this.lastError = '';
    this.signature = '';
    this.running = false;
    this.hasWidget = false;
    this.noCountdown = false;
    this.lastScanAt = 0;
  }

  /* ---------------- hook feed ---------------- */

  Timer.prototype.handleHook = function (msg) {
    var p = msg.payload || {};
    if (msg.kind === 'countdown-start') {
      this.hasWidget = true;
      this.expiredSignature = null;
      if (p.noCountdown || !p.endTime) {
        this.noCountdown = true;
        this.endTime = null;
        ECO.log('countdown-start: slide này không cần chờ');
        if (ECO.hud) {
          ECO.hud.timer('Không cần chờ — chuyển bài được ngay');
          ECO.hud.note('Slide đã đủ giờ hôm nay', 'ok');
        }
        return;
      }
      this.noCountdown = false;
      this.endTime = p.endTime;
      this.noMakeAttend = !!p.noMakeAttend;
      this.source = 'api';
      ECO.log('countdown-start', new Date(p.endTime * 1000).toLocaleTimeString(), 'noMakeAttend=' + this.noMakeAttend);
      if (ECO.hud) {
        ECO.hud.timer('Đồng hồ: ' + ECO.fmtSeconds(p.endTime - Date.now() / 1000), p.endTime - Date.now() / 1000);
        if (this.noMakeAttend) ECO.hud.note('Hôm nay không cần điểm danh', 'ok');
      }
    } else if (msg.kind === 'countdown-end') {
      ECO.log('countdown-end (site recorded the session)');
    } else if (msg.kind === 'auto-next') {
      this.siteAutoNext = !!p.enabled;
      ECO.log('auto_next_slide =', this.siteAutoNext);
    } else if (msg.kind === 'canvas-text') {
      this.pushCanvas(p);
    } else if (msg.kind === 'inactivity') {
      if (ECO.hud) ECO.hud.note('Ghi nhận giờ học đang tạm dừng — bấm "tiếp tục" trên trang', 'warn');
    } else if (msg.kind === 'camera') {
      if (ECO.hud) ECO.hud.note('Chưa bật camera — trang sẽ tự thoát sau 1 phút', 'warn');
    }
  };

  Timer.prototype.pushCanvas = function (p) {
    var text = String(p.text || '').trim();
    var idx = Number(p.index);
    if (!Number.isFinite(idx)) return;
    if (!/^\d{1,5}$/.test(text)) return; // skip unit labels (Giờ / Phút / Giây)
    this.canvasParts[idx] = parseInt(text, 10);

    var keys = Object.keys(this.canvasParts)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    if (!keys.length) return;
    var vals = keys.map(
      function (k) {
        return this.canvasParts[k];
      }.bind(this)
    );

    var total = null;
    if (vals.length >= 3) total = vals[0] * 3600 + vals[1] * 60 + vals[2];
    else if (vals.length === 2) total = vals[0] * 60 + vals[1];
    else total = vals[0];

    this.canvasRemaining = total;
    this.canvasAt = Date.now();
    this.hasWidget = true;

    // the widget is the ground truth: if the API deadline drifted (server extended
    // the session, inactivity resume...), follow the widget
    if (this.endTime) {
      var apiRem = this.endTime - Date.now() / 1000;
      if (Math.abs(apiRem - total) > 10) {
        this.endTime = Date.now() / 1000 + total;
        this.source = 'canvas';
      }
    }
  };

  /* ---------------- lifecycle ---------------- */

  Timer.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.signature = ECO.dom.quickSignature();
    this.hasWidget = !!document.querySelector('.ect_countdown');

    var self = this;
    this.mutationObserver = new MutationObserver(function (records) {
      for (var i = 0; i < records.length && i < 20; i++) {
        var node = records[i].target;
        var el = node && node.nodeType === 3 ? node.parentElement : node;
        if (!el || !el.isConnected) continue;
        if (el.closest && el.closest('#eco-hud')) continue;
        self.consider(el);
      }
    });
    this.mutationObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });

    this.intervalId = setInterval(function () {
      self.tick();
    }, 500);

    this.watchVideos();
  };

  Timer.prototype.stop = function () {
    this.running = false;
    if (this.mutationObserver) this.mutationObserver.disconnect();
    if (this.intervalId) clearInterval(this.intervalId);
    this.mutationObserver = null;
    this.intervalId = null;
  };

  /* ---------------- generic DOM fallback ---------------- */

  Timer.prototype.consider = function (el) {
    if (this.endTime || this.canvasRemaining != null) return;
    if (!el || el.nodeType !== 1) return;
    if (el.children && el.children.length > 1) return;
    var txt = ECO.dom.textOf(el);
    if (!txt || txt.length > 28) return;
    var sec = parseTime(txt);
    if (sec == null) return;

    var now = Date.now();
    var prev = this.candidates.get(el);
    if (!prev) {
      this.candidates.set(el, { last: sec, lastAt: now, ticks: 0 });
      return;
    }
    if (sec < prev.last) prev.ticks += 1;
    else if (sec > prev.last) prev.ticks = 0;
    prev.last = sec;
    prev.lastAt = now;

    if (prev.ticks >= 2 && !this.domLock) {
      this.domLock = { el: el, seconds: sec };
      this.source = 'dom';
      ECO.log('dom timer locked', sec);
    }
  };

  /* ---------------- tick ---------------- */

  Timer.prototype.currentRemaining = function () {
    var now = Date.now();

    if (this.endTime) {
      var apiRem = this.endTime - now / 1000;
      // canvas values are only trustworthy while the widget keeps repainting
      if (this.canvasRemaining != null && now - this.canvasAt < 2500) {
        var canvasRem = this.canvasRemaining - (now - this.canvasAt) / 1000;
        if (Math.abs(canvasRem - apiRem) <= 10) return { rem: canvasRem, source: 'canvas' };
      }
      return { rem: apiRem, source: 'api' };
    }

    if (this.canvasRemaining != null) {
      return { rem: this.canvasRemaining - (now - this.canvasAt) / 1000, source: 'canvas' };
    }

    if (this.domLock) {
      var el = this.domLock.el;
      if (!el || !el.isConnected) {
        var last = this.domLock.seconds;
        this.domLock = null;
        return { rem: last <= 2 ? 0 : null, source: 'dom' };
      }
      var sec = parseTime(ECO.dom.textOf(el));
      if (sec == null) return { rem: null, source: 'dom' };
      this.domLock.seconds = sec;
      return { rem: sec, source: 'dom' };
    }

    return { rem: null, source: null };
  };

  Timer.prototype.tick = function () {
    this.checkNavigation();

    var r = this.currentRemaining();
    if (r.rem == null) {
      if (!this.endTime && this.canvasRemaining == null && !this.domLock) {
        if (Date.now() - (this.lastScanAt || 0) > 3000) this.scanDom();
      }
      return;
    }

    this.remaining = Math.max(0, r.rem);
    this.source = r.source;
    if (ECO.hud) ECO.hud.timer(ECO.fmtSeconds(this.remaining), this.remaining);

    if (r.rem <= 0) this.expire(r.source);
  };

  Timer.prototype.scanDom = function () {
    this.lastScanAt = Date.now();
    var self = this;
    ECO.dom.queryAll(HINT_SELECTOR).slice(0, 60).forEach(function (el) {
      self.consider(el);
    });
    ECO.dom.queryAll('video').forEach(function (v) {
      if (v.__ecoBound) return;
      v.__ecoBound = true;
      v.addEventListener('ended', function () {
        if (ECO.settings.advanceOnVideoEnd) self.expire('video-ended');
      });
    });
  };

  Timer.prototype.watchVideos = function () {
    this.scanDom();
  };

  Timer.prototype.checkNavigation = function () {
    var sig = ECO.dom.quickSignature();
    if (sig !== this.signature) {
      this.signature = sig;
      this.expiredSignature = null;
      this.endTime = null;
      this.noCountdown = false;
      this.canvasRemaining = null;
      this.canvasParts = {};
      this.domLock = null;
      this.candidates.clear();
      this.hasWidget = !!document.querySelector('.ect_countdown');
      if (ECO.hud) ECO.hud.timer('Trang mới');
      this.watchVideos();
    }
  };

  /* ---------------- advance ---------------- */

  Timer.prototype.expire = function (reason) {
    if (this.busy) return;
    var sig = ECO.dom.navSignature();
    if (this.expiredSignature === sig) return;
    this.expiredSignature = sig;

    if (!ECO.settings.enabled || !ECO.settings.autoAdvance) {
      if (ECO.hud) ECO.hud.timer('Hết giờ (tự động chuyển đang tắt)');
      return;
    }
    ECO.log('expire', reason);
    this.autoAdvance(reason);
  };

  Timer.prototype.autoAdvance = function (reason) {
    var self = this;
    if (this.busy) return;
    this.busy = true;

    var wait = Math.max(0, Number(ECO.settings.bufferSeconds) || 0);
    if (this.hasWidget) wait = Math.max(wait, SITE_AUTO_NEXT_DELAY);

    var run = function () {
      self.advance({ manual: false }).then(function (ok) {
        self.busy = false;
        if (ok) {
          self.advanceCount += 1;
          self.lastAdvanceAt = Date.now();
          if (ECO.hud) ECO.hud.timer('Đã chuyển bài');
        } else if (ECO.hud) {
          ECO.hud.timer(self.lastError || 'Không chuyển được bài');
        }
      });
    };

    if (!wait) return run();
    if (ECO.hud) {
      ECO.hud.bufferCountdown(wait).then(function (go) {
        if (go) return run();
        self.busy = false;
        if (ECO.hud) ECO.hud.timer('Đã hủy chuyển bài');
      });
    } else {
      setTimeout(run, wait * 1000);
    }
  };

  Timer.prototype.confirmIfOpen = function () {
    var modal = ECO.dom.findModal();
    if (!modal) return false;
    var btn = ECO.dom.findConfirmIn(modal);
    if (!btn) return false;
    ECO.log('confirm modal', ECO.dom.describe(btn));
    ECO.dom.click(btn);
    return true;
  };

  Timer.prototype.advance = function () {
    var self = this;
    this.lastError = '';
    var before = ECO.dom.navSignature();

    var clickAndWait = function (btn) {
      if (!btn) return Promise.resolve(false);
      ECO.log('click next', ECO.dom.describe(btn));
      ECO.dom.click(btn);
      return self.waitNavigation(before, 8000);
    };

    return Promise.resolve()
      .then(function () {
        // the site may have moved on by itself already
        if (ECO.dom.navSignature() !== before) return true;
        if (!self.confirmIfOpen()) return null;
        return self.waitNavigation(before, 3500).then(function (moved) {
          return moved ? 'done' : null;
        });
      })
      .then(function (state) {
        if (state === true) return true;
        if (state === 'done') return true;

        var btn = ECO.dom.findNextButton();
        if (!btn) {
          self.lastError = 'Không tìm thấy nút chuyển bài';
          return false;
        }
        return clickAndWait(btn).then(function (ok) {
          if (ok) return true;

          var alt = ECO.dom
            .queryAll('a[href*="/slides/slide/"], a[href*="/slides/"]')
            .filter(function (a) {
              if (a === btn || !ECO.dom.isVisible(a) || ECO.dom.isDisabled(a)) return false;
              var t = ECO.dom.normText(a);
              return /^(tiep|next|chuyen|sang bai|hoc tiep)|(bai|chuong) tiep|tiep theo|tiep tuc/.test(t);
            })[0];

          if (!alt) {
            self.lastError = 'Nút chuyển bài không phản hồi';
            return false;
          }
          return clickAndWait(alt).then(function (ok2) {
            if (!ok2) self.lastError = 'Nút chuyển bài không phản hồi';
            return ok2;
          });
        });
      });
  };

  Timer.prototype.waitNavigation = function (before, timeout) {
    var self = this;
    var start = Date.now();
    var confirmed = false;
    return new Promise(function (resolve) {
      (function loop() {
        if (ECO.dom.navSignature() !== before) return resolve(true);

        if (!confirmed) {
          var modal = ECO.dom.findModal();
          if (modal && ECO.dom.findConfirmIn(modal)) {
            confirmed = true;
            self.confirmIfOpen();
          }
        }

        if (Date.now() - start > timeout) return resolve(false);
        setTimeout(loop, 350);
      })();
    });
  };

  Timer.prototype.status = function () {
    return {
      hasTimer: this.remaining != null || !!this.endTime || this.canvasRemaining != null,
      remaining: this.remaining,
      source: this.source,
      hasWidget: this.hasWidget,
      noCountdown: this.noCountdown,
      siteAutoNext: this.siteAutoNext,
      noMakeAttend: this.noMakeAttend,
      advanceCount: this.advanceCount,
      lastAdvanceAt: this.lastAdvanceAt,
      busy: this.busy,
      error: this.lastError
    };
  };

  ECO.Timer = Timer;
  ECO.parseTime = parseTime;
})();
