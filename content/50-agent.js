/* EcoTek Study Agent - agent loop: đọc câu hỏi → hỏi Claude → (tùy chọn) chọn đáp án.
 *
 * Chế độ (settings.agentMode):
 *   off    - tắt
 *   assist - chỉ gợi ý + tô sáng, không bấm
 *   auto   - tự bấm đáp án
 *
 * Không tự nộp bài, không lách camera / chống inactivity.
 */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.Agent) return;

  function Agent() {
    this.timer = null;
    this.running = false;
    this.busy = false;
    this.steps = 0;
    this.answered = {};
    this.lastAction = '';
    this.lastError = '';
  }

  Agent.prototype.start = function () {
    if (this.timer) return;
    var self = this;
    var interval = Math.max(700, Number(ECO.settings.agentIntervalMs) || 1500);
    this.running = true;
    this.timer = setInterval(function () {
      self.step();
    }, interval);
    if (ECO.hud) ECO.hud.note('Agent đang chạy · ' + ECO.settings.agentMode, 'ok');
    ECO.log('agent started', ECO.settings.agentMode, interval + 'ms');
  };

  Agent.prototype.stop = function (reason) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    if (reason && ECO.hud) ECO.hud.note(reason, 'warn');
  };

  Agent.prototype.reset = function () {
    this.steps = 0;
    this.answered = {};
    this.lastError = '';
    this.lastAction = '';
  };

  Agent.prototype.step = function () {
    var self = this;
    if (this.busy) return;
    if (!ECO.settings.enabled || !ECO.settings.agentMode || ECO.settings.agentMode === 'off') {
      this.stop('');
      return;
    }
    if (this.steps >= (Number(ECO.settings.agentMaxSteps) || 200)) {
      this.stop('Agent dừng: đã đạt giới hạn ' + ECO.settings.agentMaxSteps + ' bước');
      return;
    }

    var quiz = (ECO.quiz && ECO.quiz.current) || (ECO.quiz ? ECO.quiz.scan() : null);
    if (!quiz || !quiz.question) return;
    if (this.answered[quiz.signature]) return;

    if (Object.keys(this.answered).length > 300) this.answered = {};

    this.busy = true;
    this.answered[quiz.signature] = true;
    this.steps += 1;

    ECO.quiz
      .evaluate()
      .then(function (sug) {
        self.busy = false;
        if (!sug) return;
        var letter = ECO.engine.letterOf(sug.index);
        self.lastAction = 'Đáp án ' + letter + ' · ' + sug.confidence + '% · ' + sug.source;
        if (ECO.hud) ECO.hud.quiz('Agent: ' + letter + ' · ' + sug.confidence + '%');
        if (ECO.settings.agentMode === 'auto') {
          var picked = ECO.quiz.pick(sug.index, true);
          self.lastAction += picked ? ' — đã chọn' : ' — đã chọn trước đó';
        }
      })
      .catch(function (e) {
        self.busy = false;
        self.lastError = String((e && e.message) || e);
        if (ECO.hud) ECO.hud.note('Agent lỗi: ' + self.lastError, 'warn');
      });
  };

  Agent.prototype.status = function () {
    return {
      running: this.running,
      mode: ECO.settings.agentMode,
      steps: this.steps,
      busy: this.busy,
      lastAction: this.lastAction,
      lastError: this.lastError
    };
  };

  ECO.Agent = Agent;
})();
