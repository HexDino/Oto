/* EcoTek Study Agent - quiz extraction, suggestion, highlight */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.Quiz) return;

  var OPTION_HINT = [
    '[class*="answer"]',
    '[class*="option"]',
    '[class*="choice"]',
    '[class*="dap-an"]',
    '[class*="cau-tra-loi"]',
    '[class*="quiz"] li',
    '[class*="quiz"] a',
    '[role="radio"]',
    '[role="option"]',
    '.list-group-item',
    'fieldset label'
  ].join(',');

  var QUESTION_HINT = [
    '[class*="question"]',
    '[class*="cau-hoi"]',
    '[class*="quiz-title"]',
    'legend',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'strong'
  ].join(',');

  // gate for the no-radio fallback, so random lists never get "highlighted"
  function looksLikeQuestion(text) {
    var t = ECO.norm(text || '');
    if (t.length < 12) return false;
    return /\?|^cau \d+|cau hoi|chon (dap an|phuong an|cau)|dap an (nao|dung)|theo (quy dinh|luat)|khi (tham gia|dang|dieu khien)|truong hop nao/.test(
      t
    );
  }

  function Quiz() {
    this.current = null;
    this.suggestion = null;
    this.historyId = null;
    this.lastSignature = '';
    this.evaluating = false;
    this.resultTimer = null;
    this.autoPicked = false;
  }

  Quiz.prototype.optionRow = function (input) {
    return (
      (input.closest && input.closest('label')) ||
      (input.closest && input.closest('li')) ||
      (input.closest && input.closest('[class*="answer"], [class*="option"], [class*="choice"]')) ||
      input.parentElement
    );
  };

  Quiz.prototype.collectInputs = function () {
    var list = ECO.dom.queryAll('input[type="radio"], input[type="checkbox"]').filter(ECO.dom.isVisible);
    if (!list.length) return [];
    var groups = new Map();
    list.forEach(function (inp) {
      var key = inp.name || 'no-name';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(inp);
    });
    var best = [];
    groups.forEach(function (arr) {
      if (arr.length > best.length) best = arr;
    });
    return best.length >= 2 ? best : [];
  };

  Quiz.prototype.collectFallbackOptions = function () {
    var candidates = ECO.dom.queryAll(OPTION_HINT).filter(function (el) {
      if (!ECO.dom.isVisible(el)) return false;
      var t = ECO.dom.textOf(el);
      return t && t.length >= 2 && t.length <= 300;
    });
    // keep elements that share a parent (a real answer list)
    var byParent = new Map();
    candidates.forEach(function (el) {
      var p = el.parentElement;
      if (!p) return;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(el);
    });
    var best = [];
    byParent.forEach(function (arr) {
      if (arr.length >= 2 && arr.length <= 8 && arr.length > best.length) best = arr;
    });
    return best;
  };

  Quiz.prototype.findQuestionText = function (container, optionTexts) {
    var custom = ECO.settings.selectors && ECO.settings.selectors.question;
    if (custom) {
      var el = ECO.dom.queryAll(custom)[0];
      if (el) {
        var ct = ECO.dom.textOf(el);
        if (ct && ct.length > 5) return ct;
      }
    }

    var normOpts = optionTexts.map(function (t) {
      return ECO.norm(t);
    });
    var pool = ECO.dom.queryAll(QUESTION_HINT, container).filter(function (el) {
      if (!ECO.dom.isVisible(el)) return false;
      var t = ECO.dom.textOf(el);
      if (!t || t.length < 12 || t.length > 800) return false;
      var n = ECO.norm(t);
      return normOpts.indexOf(n) < 0;
    });

    var withHint = pool.filter(function (el) {
      return /question|cau-hoi|quiz/i.test(String(el.className || '') + ' ' + (el.id || ''));
    });
    var list = withHint.length ? withHint : pool;
    if (!list.length) return '';

    list.sort(function (a, b) {
      return ECO.dom.textOf(b).length - ECO.dom.textOf(a).length;
    });
    var text = ECO.dom.textOf(list[0]);

    // if the chosen node is a wrapper, cut everything from the first answer on
    var firstOpt = optionTexts[0];
    if (firstOpt) {
      var idx = text.indexOf(firstOpt);
      if (idx > 20) text = text.slice(0, idx);
    }
    return text.trim();
  };

  Quiz.prototype.scan = function () {
    var inputs = this.collectInputs();
    var rows = [];
    var optionTexts = [];
    var container = null;

    if (inputs.length >= 2) {
      rows = inputs.map(this.optionRow, this);
      optionTexts = rows.map(function (row, i) {
        var t = ECO.dom.textOf(row);
        if (!t) t = ECO.dom.textOf(inputs[i]);
        return t.replace(/\s+/g, ' ').trim();
      });
      container = inputs[0].closest('fieldset, form, [class*="quiz"], [class*="question"]') || inputs[0].parentElement;
    } else {
      var custom = ECO.settings.selectors && ECO.settings.selectors.answers;
      var els = custom ? ECO.dom.queryAll(custom) : this.collectFallbackOptions();
      if (els.length >= 2) {
        rows = els;
        optionTexts = els.map(function (el) {
          return ECO.dom.textOf(el).replace(/\s+/g, ' ').trim();
        });
        container = els[0].parentElement;
      }
    }

    if (!rows.length) {
      this.current = null;
      return null;
    }

    var question = this.findQuestionText(container || document, optionTexts);
    var usedFallback = inputs.length < 2;

    if (usedFallback && !looksLikeQuestion(question)) {
      this.current = null;
      return null;
    }
    if (!question) {
      var heading = ECO.dom.queryAll('h1, h2, h3, h4, .o_wslides_lesson_title').filter(ECO.dom.isVisible)[0];
      question = heading ? ECO.dom.textOf(heading) : '';
    }

    var signature = ECO.hash(ECO.norm(question) + '|' + optionTexts.join('|'));
    this.current = {
      question: question,
      options: optionTexts,
      rows: rows,
      inputs: inputs,
      container: container,
      signature: signature
    };
    return this.current;
  };

  Quiz.prototype.applyHighlight = function (index, confidence, explanation) {
    var quiz = this.current;
    if (!quiz) return;
    quiz.rows.forEach(function (row) {
      row.classList.remove('eco-suggest');
      row.removeAttribute('data-eco-badge');
      if (row.__ecoTitle !== undefined) {
        if (row.__ecoTitle === null) row.removeAttribute('title');
        else row.setAttribute('title', row.__ecoTitle);
        delete row.__ecoTitle;
      }
    });
    var row = quiz.rows[index];
    if (!row) return;
    row.__ecoTitle = row.getAttribute('title');
    row.setAttribute('title', 'Gợi ý ' + ECO.engine.letterOf(index) + ' · ' + confidence + '%\n' + explanation);
    row.setAttribute('data-eco-badge', ECO.engine.letterOf(index) + ' · ' + confidence + '%');
    row.classList.add('eco-suggest');
  };

  Quiz.prototype.clearHighlight = function () {
    if (!this.current) return;
    this.current.rows.forEach(function (row) {
      row.classList.remove('eco-suggest');
      row.removeAttribute('data-eco-badge');
    });
  };

  /**
   * Ảnh minh họa / biển báo nằm trong khối câu hỏi -> chụp lại bằng canvas.
   * Trả null nếu không có ảnh hoặc ảnh khác origin (canvas bị taint).
   */
  Quiz.prototype.grabImage = function () {
    var quiz = this.current;
    if (!quiz) return null;
    var root = quiz.container || document;
    var imgs = ECO.dom.queryAll('img', root).filter(function (img) {
      if (!ECO.dom.isVisible(img)) return false;
      var r = img.getBoundingClientRect();
      return r.width >= 100 && r.height >= 70;
    });
    if (!imgs.length) return null;

    imgs.sort(function (a, b) {
      var ra = a.getBoundingClientRect();
      var rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    });

    var img = imgs[0];
    try {
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      if (!w || !h) return null;
      var scale = Math.min(1, 1024 / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var url = canvas.toDataURL('image/jpeg', 0.85);
      return {
        media_type: 'image/jpeg',
        data: url.split(',')[1],
        width: canvas.width,
        height: canvas.height
      };
    } catch (e) {
      ECO.log('không lấy được ảnh (khác origin)', e);
      return null;
    }
  };

  Quiz.prototype.askClaude = function (quiz, tier, image) {
    return ECO.sendBg({
      type: 'ECO_LLM_ANSWER',
      question: quiz.question,
      options: quiz.options,
      tier: tier,
      image: image || null
    });
  };

  Quiz.prototype.resolveSuggestion = function (quiz) {
    var self = this;
    var provider = ECO.settings.provider;
    var localFallback = function () {
      return ECO.engine.suggest(quiz.question, quiz.options);
    };

    if (provider === 'api') {
      return ECO.sendBg({
        type: 'ECO_API_SUGGEST',
        question: quiz.question,
        options: quiz.options
      }).then(function (resp) {
        if (resp && resp.ok && resp.suggestion) {
          var s = resp.suggestion;
          if (s.index >= 0 && s.index < quiz.options.length) return s;
        }
        if (ECO.hud) {
          ECO.hud.toast('API lỗi: ' + ((resp && resp.error) || 'không rõ') + ' — dùng suy luận cục bộ', 'warn');
        }
        return localFallback();
      });
    }

    if (provider !== 'claude') return localFallback();

    // có ảnh thì đi thẳng model mạnh (vision), không có thì model nhanh
    var image = ECO.settings.useVision ? this.grabImage() : null;
    var tier = image ? 'smart' : 'fast';
    if (image && ECO.hud) ECO.hud.toast('Đã gửi ảnh câu hỏi cho model mạnh');

    return this.askClaude(quiz, tier, image).then(function (resp) {
      if (!resp || !resp.ok || !resp.suggestion) {
        if (ECO.hud) {
          ECO.hud.toast('Claude lỗi: ' + ((resp && resp.error) || 'không rõ') + ' — dùng suy luận cục bộ', 'warn');
        }
        return localFallback();
      }

      var s = resp.suggestion;
      var threshold = Number(ECO.settings.escalateBelow) || 70;
      if (tier === 'fast' && s.confidence < threshold) {
        if (ECO.hud) ECO.hud.toast('Tin cậy thấp (' + s.confidence + '%) — hỏi lại model mạnh');
        return self.askClaude(quiz, 'smart', image).then(function (r2) {
          if (r2 && r2.ok && r2.suggestion) return r2.suggestion;
          return s;
        });
      }
      return s;
    });
  };

  Quiz.prototype.evaluate = function () {
    var self = this;
    var quiz = this.scan();
    if (!quiz || !quiz.question) {
      if (ECO.hud) ECO.hud.quiz('Chưa thấy câu hỏi');
      return Promise.resolve(null);
    }
    if (quiz.signature === this.lastSignature && this.suggestion) return Promise.resolve(this.suggestion);
    this.lastSignature = quiz.signature;

    return this.resolveSuggestion(quiz).then(function (sug) {
      if (!self.current || self.current.signature !== quiz.signature) return null;
      if (!sug) return null;

      self.suggestion = sug;
      self.applyHighlight(sug.index, sug.confidence, sug.explanation);
      if (ECO.hud) ECO.hud.quiz(ECO.engine.letterOf(sug.index) + ' · ' + sug.confidence + '% · ' + sug.source);

      return ECO.history
        .add({
          question: quiz.question,
          options: quiz.options,
          suggestedIndex: sug.index,
          confidence: sug.confidence,
          explanation: sug.explanation,
          source: sug.source
        })
        .then(function (item) {
          self.historyId = item ? item.id : null;
          self.watchResult();
          if (ECO.settings.autoSelect && sug.confidence >= ECO.settings.autoSelectThreshold) {
            self.pick(sug.index, true);
          }
          return sug;
        });
    });
  };

  Quiz.prototype.pick = function (index, automated) {
    var quiz = this.current;
    if (!quiz) return false;
    var row = quiz.rows[index];
    if (!row) return false;
    var input = quiz.inputs[index];
    if (input && input.checked) return false;
    this.autoPicked = !!automated;
    ECO.dom.click(input || row);
    if (ECO.hud) ECO.hud.quiz((automated ? 'Tự chọn ' : 'Chọn ') + ECO.engine.letterOf(index));
    return true;
  };

  Quiz.prototype.detectResult = function () {
    var quiz = this.current;
    if (!quiz) return null;
    var correctIdx = -1;
    var wrongIdx = -1;

    quiz.rows.forEach(function (row, i) {
      var cls = String(row.className || '');
      var parentCls = row.parentElement ? String(row.parentElement.className || '') : '';
      var blob = cls + ' ' + parentCls;
      if (/(correct|right|dung|success|text-success|true)/i.test(blob) && !/incorrect|wrong|sai|danger|false/i.test(blob)) {
        if (correctIdx < 0) correctIdx = i;
      }
      if (/(incorrect|wrong|sai|danger|text-danger|false)/i.test(blob)) {
        if (wrongIdx < 0) wrongIdx = i;
      }
    });

    if (correctIdx < 0 && wrongIdx < 0) return null;
    return { correctIndex: correctIdx, wrongIndex: wrongIdx };
  };

  Quiz.prototype.watchResult = function () {
    var self = this;
    if (this.resultTimer) return;
    var start = Date.now();
    this.resultTimer = setInterval(function () {
      var quiz = self.current;
      if (!quiz) {
        clearInterval(self.resultTimer);
        self.resultTimer = null;
        return;
      }
      var res = self.detectResult();
      if (res && res.correctIndex >= 0) {
        clearInterval(self.resultTimer);
        self.resultTimer = null;
        var picked = -1;
        quiz.inputs.forEach(function (inp, i) {
          if (inp.checked) picked = i;
        });
        ECO.history.update(self.historyId, {
          correctIndex: res.correctIndex,
          correct: picked === res.correctIndex,
          picked: picked >= 0 ? picked : null
        });
        if (ECO.settings.logHistory !== false) {
          ECO.kb.set(ECO.engine.kbKey(quiz.question), {
            q: quiz.question.slice(0, 300),
            answer: res.correctIndex,
            confidence: 96,
            explanation: 'Đáp án đã xác nhận trên trang: ' + ECO.engine.letterOf(res.correctIndex),
            updatedAt: Date.now()
          });
        }
        if (ECO.hud) ECO.hud.quiz('Đáp án đúng: ' + ECO.engine.letterOf(res.correctIndex));
      }
      if (Date.now() - start > 90000) {
        clearInterval(self.resultTimer);
        self.resultTimer = null;
      }
    }, 1200);
  };

  Quiz.prototype.status = function () {
    return {
      hasQuestion: !!(this.current && this.current.question),
      question: this.current ? this.current.question.slice(0, 160) : '',
      options: this.current ? this.current.options.slice(0, 8) : [],
      suggestion: this.suggestion
        ? {
            index: this.suggestion.index,
            letter: ECO.engine.letterOf(this.suggestion.index),
            confidence: this.suggestion.confidence,
            explanation: this.suggestion.explanation,
            source: this.suggestion.source
          }
        : null
    };
  };

  ECO.Quiz = Quiz;
})();
