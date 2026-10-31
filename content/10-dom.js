/* EcoTek Study Agent - resilient DOM helpers (survive class-name changes) */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.dom) return;

  var CLICKABLE = 'button, a, [role="button"], input[type="button"], input[type="submit"], .btn, .o_wslides_lesson_nav a, li, span, div';
  var CANCEL_WORDS = ['huy', 'dong', 'khong dong y', 'quay lai', 'thoat', 'de sau', 'cancel', 'close', 'dismiss', 'bo qua'];

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!el.isConnected) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    return true;
  }

  function isDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
    var cls = String(el.className || '');
    if (/\bdisabled\b/i.test(cls)) return true;
    var cs = getComputedStyle(el);
    if (cs.pointerEvents === 'none') return true;
    return false;
  }

  function textOf(el) {
    if (!el) return '';
    var parts = [];
    if (el.innerText) parts.push(el.innerText);
    else if (el.textContent) parts.push(el.textContent);

    var own = parts.join(' ').replace(/\s+/g, ' ').trim();
    // aria-label/title/value only for icon-only elements, so tooltips we add
    // ourselves never leak into extracted question/answer text
    if (!own) {
      var aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria) parts.push(aria);
      var title = el.getAttribute && el.getAttribute('title');
      if (title) parts.push(title);
      var value = el.getAttribute && el.getAttribute('value');
      if (value && el.tagName === 'INPUT') parts.push(value);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function normText(el) {
    return ECO.norm(textOf(el));
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    var path = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      var sel = node.tagName.toLowerCase();
      if (node.id) {
        sel += '#' + node.id.replace(/[^\w-]/g, '');
        path.unshift(sel);
        break;
      }
      var cls = String(node.className || '')
        .split(/\s+/)
        .filter(function (c) {
          return c && c.length < 40;
        })
        .slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
      var parent = node.parentElement;
      if (parent) {
        var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
        sel += ':nth-child(' + idx + ')';
      }
      path.unshift(sel);
      node = parent;
      depth++;
    }
    return path.join(' > ');
  }

  function describe(el) {
    if (!el) return null;
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      id: el.id || '',
      cls: String(el.className || '').slice(0, 120),
      text: textOf(el).slice(0, 100),
      selector: cssPath(el),
      visible: isVisible(el),
      disabled: isDisabled(el)
    };
  }

  function queryAll(selector, root) {
    try {
      return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  /**
   * Find the best clickable element whose visible text matches one of the words.
   * Scoring: exact > startsWith > contains. Shorter texts win ties (nav links, not wrappers).
   */
  function findByText(words, opts) {
    opts = opts || {};
    var root = opts.root || document;
    var maxLen = opts.maxTextLen || 60;
    var pool = [];
    var custom = opts.selectors || [];
    custom.forEach(function (sel) {
      queryAll(sel, root).forEach(function (el) {
        pool.push(el);
      });
    });
    queryAll(CLICKABLE, root).forEach(function (el) {
      pool.push(el);
    });

    var seen = new Set();
    var best = null;
    var bestScore = 0;

    var normWords = words
      .map(function (w) {
        return ECO.norm(w);
      })
      .filter(Boolean);

    pool.forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      if (!isVisible(el) || isDisabled(el)) return;
      if (opts.exclude && el.closest(opts.exclude)) return;
      var raw = textOf(el);
      if (!raw || raw.length > maxLen) return;
      var t = ECO.norm(raw);
      if (!t) return;

      var score = 0;
      for (var i = 0; i < normWords.length; i++) {
        var w = normWords[i];
        var base = (normWords.length - i) * 2;
        if (t === w) score = Math.max(score, 100 + base);
        else if (t.indexOf(w) === 0) score = Math.max(score, 80 + base - Math.min(20, t.length - w.length));
        else if (t.indexOf(w) > 0) score = Math.max(score, 60 + base - Math.min(20, t.length - w.length));
      }
      if (!score) return;

      // prefer real interactive elements over random divs
      if (/^(a|button)$/i.test(el.tagName) || el.getAttribute('role') === 'button') score += 12;
      if (el.tagName === 'INPUT') score += 6;
      if (el.classList && el.classList.contains('btn-primary')) score += 4;
      if (el.getAttribute('href') && /\/slides\//.test(el.getAttribute('href'))) score += 8;
      if (opts.preferPrimary && el.classList && el.classList.contains('btn-primary')) score += 10;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });

    return best;
  }

  function findCancelByText(root) {
    return findByText(CANCEL_WORDS, { root: root || document, maxTextLen: 30 });
  }

  function click(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (e) {
      /* ignore */
    }
    var rect = el.getBoundingClientRect();
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    try {
      var PE = window.PointerEvent || MouseEvent;
      el.dispatchEvent(new PE('pointerover', base));
      el.dispatchEvent(new PE('pointerdown', base));
      el.dispatchEvent(new MouseEvent('mousedown', base));
      el.dispatchEvent(new PE('pointerup', base));
      el.dispatchEvent(new MouseEvent('mouseup', base));
    } catch (e) {
      /* ignore */
    }
    try {
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', base));
      return true;
    } catch (e) {
      ECO.warn('click failed', e);
      return false;
    }
  }

  function waitFor(fn, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 8000;
    var interval = opts.interval || 150;
    var start = Date.now();
    return new Promise(function (resolve) {
      (function loop() {
        var val = null;
        try {
          val = fn();
        } catch (e) {
          val = null;
        }
        if (val) return resolve(val);
        if (Date.now() - start > timeout) return resolve(null);
        setTimeout(loop, interval);
      })();
    });
  }

  function findModal() {
    var selectors = [
      '.modal.show',
      '.modal[style*="display: block"]',
      '.o_dialog',
      '.o_modal',
      '[role="dialog"]',
      'dialog[open]',
      '.swal2-popup',
      '.modal-dialog'
    ];
    for (var i = 0; i < selectors.length; i++) {
      var list = queryAll(selectors[i]);
      for (var j = 0; j < list.length; j++) {
        var el = list[j];
        if (!isVisible(el)) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        var rect = el.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 60) continue;
        return el;
      }
    }
    return null;
  }

  function findConfirmIn(root) {
    var words = ['dong y', 'xac nhan', 'tiep tuc', 'chuyen bai', 'tiep theo', 'ok', 'co', 'yes', 'confirm', 'dong'];
    var btn = findByText(words, { root: root || document, maxTextLen: 40 });
    if (!btn) return null;
    var t = normText(btn);
    for (var i = 0; i < CANCEL_WORDS.length; i++) {
      if (t === CANCEL_WORDS[i]) return null;
    }
    return btn;
  }

  function pageSignature() {
    var main = document.querySelector('main, #wrap, .o_wslides_lesson_main, .o_wslides_course_main') || document.body;
    var txt = '';
    try {
      txt = (main.innerText || '').slice(0, 400);
    } catch (e) {
      txt = '';
    }
    return location.pathname + '|' + ECO.hash(ECO.norm(txt));
  }

  // identity of the current slide/lesson; ignores modals and toasts
  function navSignature() {
    var head =
      document.querySelector('.o_wslides_lesson_title, .o_wslides_lesson_header h1, main h1, h1') || null;
    var headText = head ? textOf(head).slice(0, 120) : '';
    return [location.pathname, location.search, document.title, ECO.norm(headText)].join('|');
  }

  // cheap signature for 500ms polling (avoids layout thrash from innerText)
  function quickSignature() {
    return navSignature();
  }

  function findNextButton() {
    var s = ECO.settings.selectors || {};
    if (s.next) {
      var custom = queryAll(s.next).filter(function (el) {
        return isVisible(el) && !isDisabled(el);
      })[0];
      if (custom) return custom;
    }

    // this site's exact hook: <a id="next-slide-button" ...>Trang sau</a>
    var byId = document.querySelector('#next-slide-button');
    if (byId && isVisible(byId) && !isDisabled(byId)) return byId;

    var words = [
      'tiep theo',
      'chuyen bai',
      'bai tiep theo',
      'bai tiep',
      'chuyen chuong',
      'chuong tiep theo',
      'chuong tiep',
      'sang bai',
      'hoc tiep',
      'lam bai tiep',
      'tiep',
      'next',
      'hoan thanh',
      'ket thuc',
      'ket thuc bai hoc',
      'tiep tuc hoc'
    ];

    // Odoo eLearning: the lesson nav uses anchors to the next slide.
    // Only accept links that read like a nav action, never sidebar lesson titles.
    var navLinks = queryAll('a[href*="/slides/slide/"], a[href*="/slides/"]').filter(function (a) {
      if (!isVisible(a) || isDisabled(a)) return false;
      var t = normText(a);
      if (!t) return false;
      if (CANCEL_WORDS.indexOf(t) >= 0) return false;
      return /^(tiep|next|chuyen|sang bai|hoc tiep)|(bai|chuong) tiep|tiep theo|tiep tuc/.test(t);
    });
    if (navLinks.length) {
      var primary =
        navLinks.filter(function (a) {
          return /btn-primary|btn-success|primary/.test(String(a.className || ''));
        })[0] || navLinks[navLinks.length - 1];
      return primary;
    }

    var found = findByText(words, {
      maxTextLen: 55,
      preferPrimary: true,
      exclude: '.modal, [role="dialog"], #eco-hud'
    });
    if (found) return found;

    // last resort: icon-only nav buttons with aria-label
    var aria = queryAll('a, button').filter(function (el) {
      if (!isVisible(el) || isDisabled(el)) return false;
      var label = ECO.norm((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''));
      return /tiep|next|chuyen bai/.test(label);
    });
    return aria[0] || null;
  }

  function scanReport() {
    var buttons = queryAll('button, a.btn, [role="button"], a[href*="/slides/slide/"]')
      .filter(isVisible)
      .slice(0, 40)
      .map(describe)
      .filter(function (d) {
        return d.text && d.text.length < 60;
      });

    var timers = [];
    queryAll('*').forEach(function (el) {
      if (timers.length > 20) return;
      if (el.children.length > 0) return;
      var t = textOf(el);
      if (!t || t.length > 30) return;
      if (/^\s*(\d{1,2}:)?\d{1,2}:\d{2}\s*$/.test(t)) timers.push(describe(el));
    });

    var radios = queryAll('input[type="radio"], input[type="checkbox"]').filter(isVisible);
    var quiz = null;
    if (radios.length) {
      var name = radios[0].name;
      quiz = {
        radioCount: radios.length,
        name: name,
        container: describe(radios[0].closest('fieldset, form, div') || radios[0].parentElement),
        sample: describe(radios[0])
      };
    }

    return {
      url: location.href,
      title: document.title,
      buttons: buttons,
      timers: timers,
      quiz: quiz,
      hasVideo: !!document.querySelector('video'),
      framework: document.querySelector('[class*="o_wslides"]') ? 'odoo-elearning' : 'unknown'
    };
  }

  ECO.dom = {
    isVisible: isVisible,
    isDisabled: isDisabled,
    textOf: textOf,
    normText: normText,
    cssPath: cssPath,
    describe: describe,
    queryAll: queryAll,
    findByText: findByText,
    findCancelByText: findCancelByText,
    click: click,
    waitFor: waitFor,
    findModal: findModal,
    findConfirmIn: findConfirmIn,
    pageSignature: pageSignature,
    quickSignature: quickSignature,
    navSignature: navSignature,
    findNextButton: findNextButton,
    scanReport: scanReport
  };
})();
