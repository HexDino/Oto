/* EcoTek Study Agent - local answer engine (heuristics + personal knowledge base) */
(function () {
  'use strict';
  var ECO = window.__ECO;
  if (!ECO || ECO.engine) return;

  var ALL_OF_ABOVE = /tat ca (cac )?(y|phuong an|dap an|truong hop|y tren)|ca (ba|hai) (phuong an|y)|tat ca deu dung/;
  var NONE_OF_ABOVE = /khong co (phuong an|dap an|y) nao (dung|dung ca)|khong phuong an nao/;
  var ABSOLUTE = /\b(luon luon|tuyet doi|khong bao gio|duy nhat|moi truong hop|bat buoc phai)\b/;
  var SAFE = [
    'giam toc do',
    'nhuong duong',
    'dung lai',
    'quan sat',
    'an toan',
    'khong vuot',
    'di cham',
    'bat den',
    'that day an toan',
    'giu khoang cach',
    'nhuong quyen uu tien',
    'bao hieu',
    'kiem tra'
  ];
  var RISKY = /\b(tang toc|vuot|phong nhanh|uong ruou|bia|chat kich thich|vuot den do|di nguoc chieu)\b/;

  function tokens(s) {
    return ECO.norm(s)
      .split(/[^a-z0-9]+/)
      .filter(function (w) {
        return w.length > 2;
      });
  }

  function numbersOf(s) {
    return ECO.norm(s).match(/\d+/g) || [];
  }

  function letterOf(i) {
    return String.fromCharCode(65 + i);
  }

  function scoreOptions(question, options) {
    var q = ECO.norm(question);
    var qNums = numbersOf(question);
    var qTokens = new Set(tokens(question));
    var maxLen = 1;
    options.forEach(function (o) {
      maxLen = Math.max(maxLen, String(o || '').length);
    });

    return options.map(function (opt, index) {
      var t = ECO.norm(opt);
      var score = 0;
      var reasons = [];

      if (ALL_OF_ABOVE.test(t)) {
        score += 1.5;
        reasons.push('đáp án tổng hợp ("tất cả các ý trên")');
      }
      if (NONE_OF_ABOVE.test(t)) {
        score -= 1.6;
        reasons.push('loại phương án "không có đáp án nào"');
      }
      if (ABSOLUTE.test(t)) {
        score -= 0.6;
        reasons.push('chứa từ ngữ tuyệt đối');
      }

      // numbers stated in the question usually reappear in the right answer
      var optNums = numbersOf(opt);
      var numHit = qNums.filter(function (n) {
        return optNums.indexOf(n) >= 0;
      }).length;
      if (numHit) {
        score += Math.min(1.8, 1.2 * numHit);
        reasons.push('khớp số liệu với câu hỏi');
      }

      // safety-oriented answers dominate Vietnamese driving theory exams
      var safeHit = SAFE.filter(function (w) {
        return t.indexOf(w) >= 0;
      }).length;
      if (safeHit && !RISKY.test(t)) {
        score += Math.min(1.2, 0.6 * safeHit);
        reasons.push('hướng xử lý an toàn');
      }
      if (RISKY.test(t) && /khong|tranh|khong nen|sai/.test(q)) {
        score -= 0.8;
      }

      // lexical overlap with the question (rare words weigh more)
      var optTokens = tokens(opt);
      var overlap = optTokens.filter(function (w) {
        return qTokens.has(w);
      }).length;
      if (overlap) score += Math.min(1.0, overlap * 0.22);

      // longer, more qualified answers are slightly favoured, very short ones penalised
      var ratio = String(opt || '').length / maxLen;
      score += (ratio - 0.5) * 0.6;
      if (String(opt || '').length < 12) score -= 0.25;

      return { index: index, score: score, reasons: reasons };
    });
  }

  function heuristic(question, options) {
    var scored = scoreOptions(question, options).sort(function (a, b) {
      return b.score - a.score;
    });
    var top = scored[0];
    var second = scored[1] || { score: 0 };
    var gap = top.score - second.score;
    var conf = 0.48 + Math.min(0.14, Math.max(0, gap) * 0.05);
    conf = Math.min(0.62, conf);

    var explanation = top.reasons.length
      ? 'Suy luận cục bộ: ' + top.reasons.slice(0, 2).join('; ') + '.'
      : 'Suy luận cục bộ theo độ dài và từ khóa, độ tin cậy thấp.';

    return {
      index: top.index,
      confidence: Math.round(conf * 100),
      explanation: explanation,
      source: 'heuristic'
    };
  }

  function kbKey(question) {
    return ECO.hash(ECO.norm(question).slice(0, 300));
  }

  /**
   * Suggest an answer.
   * Order: personal KB -> heuristic. API (optional) is handled by the caller.
   */
  function suggest(question, options) {
    var key = kbKey(question);
    return ECO.kb
      .get(key)
      .then(function (hit) {
        if (hit && Number.isInteger(hit.answer) && hit.answer >= 0 && hit.answer < options.length) {
          return {
            index: hit.answer,
            confidence: hit.confidence || 96,
            explanation: hit.explanation || 'Đã ghi nhớ đáp án đúng cho câu này từ lần làm trước.',
            source: 'kb',
            key: key
          };
        }
        var res = heuristic(question, options);
        res.key = key;
        return res;
      })
      .catch(function () {
        var res = heuristic(question, options);
        res.key = key;
        return res;
      });
  }

  ECO.engine = {
    suggest: suggest,
    heuristic: heuristic,
    kbKey: kbKey,
    letterOf: letterOf
  };
})();
