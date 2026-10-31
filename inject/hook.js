/**
 * EcoTek Study Agent - MAIN world hook.
 *
 * Injected by the service worker via chrome.scripting.executeScript({world:'MAIN'}).
 * Why: the lesson countdown is drawn on <canvas> and its real end time only exists
 * inside the page's JS (POST /slide/countdown-start/ -> {end_time}). An isolated
 * content script cannot see either. This hook captures both and forwards them
 * through window.postMessage.
 */
(function () {
  'use strict';
  if (window.__ECO_HOOK) return;
  window.__ECO_HOOK = true;

  var INTEREST = /countdown-start|countdown-end|auto_next_slide/;

  function post(kind, payload) {
    try {
      window.postMessage({ __eco: true, kind: kind, payload: payload }, window.location.origin);
    } catch (e) {
      /* ignore */
    }
  }

  function capture(url, text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return;
    }
    try {
      window.__ECO_CAPTURED = window.__ECO_CAPTURED || [];
      window.__ECO_CAPTURED.push({ url: url, body: text.slice(0, 300), t: Date.now() });
      if (window.__ECO_CAPTURED.length > 30) window.__ECO_CAPTURED.shift();
    } catch (e) {}
    var res = data && data.result;
    if (res === undefined || res === null) return;

    if (url.indexOf('countdown-start') >= 0) {
      // the site returns 0 (not an object) when this slide needs no countdown today
      if (typeof res === 'number') {
        post('countdown-start', { endTime: null, noCountdown: true, href: location.href });
        return;
      }
      post('countdown-start', {
        endTime: Number(res.end_time) || null,
        noMakeAttend: res.no_make_attend === true,
        href: location.href
      });
    } else if (url.indexOf('countdown-end') >= 0) {
      post('countdown-end', { ok: true });
    } else if (url.indexOf('auto_next_slide') >= 0) {
      post('auto-next', { enabled: res.auto_next_slide === true });
    }
  }

  /* ---- fetch ---- */
  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var args = arguments;
      var url = typeof args[0] === 'string' ? args[0] : args[0] && args[0].url ? args[0].url : '';
      var p = origFetch.apply(this, args);
      if (INTEREST.test(url)) {
        p.then(function (res) {
          return res.clone().text();
        })
          .then(function (t) {
            capture(url, t);
          })
          .catch(function () {});
      }
      return p;
    };
  }

  /* ---- XMLHttpRequest (Odoo uses this) ---- */
  var xOpen = XMLHttpRequest.prototype.open;
  var xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ecoUrl = String(url || '');
    return xOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (INTEREST.test(xhr.__ecoUrl || '')) {
      xhr.addEventListener('load', function () {
        try {
          capture(xhr.__ecoUrl, xhr.responseText);
        } catch (e) {
          /* ignore */
        }
      });
    }
    return xSend.apply(this, arguments);
  };

  /* ---- canvas fallback: the countdown digits ---- */
  var fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
    try {
      var canvas = this.canvas;
      var holder = canvas && canvas.parentElement;
      if (holder && String(holder.className).indexOf('ect_countdown_canvas_flex') >= 0) {
        var siblings = holder.parentElement ? holder.parentElement.children : [];
        var index = Array.prototype.indexOf.call(siblings, holder);
        try {
          window.__ECO_DRAWS = window.__ECO_DRAWS || [];
          window.__ECO_DRAWS.push(String(text));
          if (window.__ECO_DRAWS.length > 60) window.__ECO_DRAWS.shift();
        } catch (e) {}
        post('canvas-text', { index: index, text: String(text) });
      }
    } catch (e) {
      /* ignore */
    }
    return fillText.apply(this, arguments);
  };

  /* ---- presence / camera signals ---- */
  function flagPresence() {
    try {
      var popup = document.getElementById('inactivity-popup');
      if (popup) post('inactivity', { visible: true });
      var banner = document.body ? document.body.innerText : '';
      if (/không bật camera|không có dữ liệu camera/i.test(banner)) post('camera', { ok: false });
    } catch (e) {
      /* ignore */
    }
  }
  setInterval(flagPresence, 3000);

  post('ready', { href: location.href });
})();
