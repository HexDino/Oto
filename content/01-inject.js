/* EcoTek Study Agent - runs at document_start: ask the worker to install the MAIN world hook
   and buffer hook messages until the rest of the agent is ready. */
(function () {
  'use strict';

  if (window.__ECO_EARLY_READY) return;
  window.__ECO_EARLY_READY = true;
  window.__ECO_EARLY = window.__ECO_EARLY || [];

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.__eco !== true) return;
    // note: e.source identity is not reliable across isolated worlds, rely on the marker
    var msg = { kind: d.kind, payload: d.payload, t: Date.now() };
    window.__ECO_EARLY.push(msg);
    if (window.__ECO_EARLY.length > 300) window.__ECO_EARLY.shift();
    if (typeof window.__ECO_HOOK_SINK === 'function') {
      try {
        window.__ECO_HOOK_SINK(msg);
      } catch (err) {
        /* ignore */
      }
    }
  });

  try {
    chrome.runtime.sendMessage({ type: 'ECO_INJECT_MAIN' }, function () {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    /* ignore */
  }
})();
