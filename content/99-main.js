/* EcoTek Study Agent - bootstrap + messaging */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.booted) return;
  ECO.booted = true;

  var observer = null;
  var observerTimer = null;
  var lastHref = location.href;

  function refreshQuiz() {
    if (!ECO.settings.enabled || !ECO.settings.quizAssist) return;
    if (!ECO.quiz) return;
    ECO.quiz.evaluate().catch(function (e) {
      ECO.warn('quiz evaluate failed', e);
    });
  }

  var refreshQuizDebounced = ECO.debounce(refreshQuiz, 500);

  function startObservers() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(function (records) {
      if (!ECO.settings.enabled) return;
      var relevant = false;
      for (var i = 0; i < records.length && i < 30; i++) {
        var t = records[i].target;
        if (!t || !t.isConnected) continue;
        if (t.nodeType === 1 && t.closest && t.closest('#eco-hud')) continue;
        relevant = true;
        break;
      }
      if (!relevant) return;
      clearTimeout(observerTimer);
      observerTimer = setTimeout(refreshQuizDebounced, 400);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function watchSpaNavigation() {
    setInterval(function () {
      if (location.href === lastHref) return;
      lastHref = location.href;
      ECO.log('navigation ->', location.href);
      if (ECO.quiz) {
        ECO.quiz.lastSignature = '';
        ECO.quiz.current = null;
      }
      if (ECO.timer) {
        ECO.timer.endTime = null;
        ECO.timer.canvasRemaining = null;
        ECO.timer.candidates.clear();
        ECO.timer.expiredSignature = null;
        ECO.timer.checkNavigation();
      }
      if (ECO.hud) ECO.hud.note('');
      setTimeout(refreshQuiz, 700);
    }, 800);
  }

  function applySettings() {
    var s = ECO.settings;
    if (ECO.hud) {
      ECO.hud.setEnabled(!!s.enabled);
      if (s.showHud && s.enabled) ECO.hud.mount();
      else ECO.hud.unmount(false);
    }
    if (ECO.timer) {
      if (s.enabled) ECO.timer.start();
      else ECO.timer.stop();
    }
    if (s.enabled && s.quizAssist && ECO.quiz) {
      ECO.quiz.lastSignature = '';
      refreshQuiz();
    }
    if (ECO.agent) {
      if (s.enabled && s.agentMode && s.agentMode !== 'off') ECO.agent.start();
      else ECO.agent.stop('');
    }
  }

  function status() {
    return {
      ok: true,
      version: ECO.VERSION,
      url: location.href,
      enabled: !!ECO.settings.enabled,
      settings: ECO.settings,
      timer: ECO.timer ? ECO.timer.status() : null,
      quiz: ECO.quiz ? ECO.quiz.status() : null,
      agent: ECO.agent ? ECO.agent.status() : null,
      hud: ECO.hud ? ECO.hud.isMounted() : false
    };
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'ECO_PING':
        sendResponse({ ok: true, version: ECO.VERSION });
        return;
      case 'ECO_STATUS':
        sendResponse(status());
        return;
      case 'ECO_SETTINGS_UPDATED':
        ECO.loadSettings().then(function () {
          applySettings();
          sendResponse(status());
        });
        return true;
      case 'ECO_SCAN':
        sendResponse({ ok: true, report: ECO.dom.scanReport(), status: status() });
        return;
      case 'ECO_ADVANCE':
        ECO.timer.advance({ manual: true }).then(function (ok) {
          sendResponse({ ok: ok, error: ECO.timer.lastError });
        });
        return true;
      case 'ECO_QUIZ_NOW':
        ECO.quiz.lastSignature = '';
        ECO.quiz.evaluate().then(function (sug) {
          sendResponse({ ok: !!sug, suggestion: sug || null, status: status() });
        });
        return true;
      case 'ECO_QUIZ_PICK':
        var picked = ECO.quiz.pick(Number(msg.index), false);
        sendResponse({ ok: picked, status: status() });
        return;
      case 'ECO_HUD_TOGGLE':
        if (ECO.settings.showHud) ECO.hud.unmount(true);
        else ECO.saveSettings({ showHud: true }).then(function () {
          ECO.hud.mount();
        });
        sendResponse({ ok: true });
        return;
    }
  });

  ECO.onSettings(function () {
    applySettings();
  });

  ECO.loadSettings().then(function () {
    ECO.timer = new ECO.Timer();
    ECO.quiz = new ECO.Quiz();
    ECO.agent = new ECO.Agent();

    // messages from the MAIN world hook (document_start) are buffered in __ECO_EARLY
    window.__ECO_HOOK_SINK = function (msg) {
      if (ECO.timer) ECO.timer.handleHook(msg);
    };
    var early = window.__ECO_EARLY || [];
    early.forEach(function (m) {
      try {
        window.__ECO_HOOK_SINK(m);
      } catch (e) {
        /* ignore */
      }
    });
    window.__ECO_EARLY = [];

    if (ECO.settings.enabled) {
      ECO.hud.mount();
      ECO.timer.start();
      setTimeout(refreshQuiz, 900);
      if (ECO.settings.agentMode && ECO.settings.agentMode !== 'off') ECO.agent.start();
    }

    startObservers();
    watchSpaNavigation();
    ECO.log('booted on', location.href);
  });
})();
