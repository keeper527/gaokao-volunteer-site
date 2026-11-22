/* 河北普通类本科批 · 96 志愿方案（本地版）
 * 纪律（判据 W11–W16 见 docs/webui-prefs-charter-design-20261031-1400.md）：
 *  · 层配额 / 位次 / 余量 / 章程状态与条文全部来自后端响应体，前端不推算、不补齐、不写死；
 *  · 偏好控件由 /api/meta 的 prefs_schema 动态渲染 —— 前端**不认识**任何偏好键名（W12），
 *    因此结构上不可能「悄悄改侧」或「顺手纠正」取值，冲突与越界一律交服务端 400；
 *  · 章程汇总句只展示 charter.section_md（与 .md 导出 §四 同源同字，W14），行级明细只搬运 (W13)。
 */
(function () {
  "use strict";

  var LAYER_ORDER = ["chong", "wen", "bao", "absolute_bao"];
  var LAYER_CN = { chong: "冲", wen: "稳", bao: "保", absolute_bao: "绝对保底" };
  var CHARTER_CN = {
    hard: "有硬性限制",
    no_hard: "有章程·无硬性限制",
    uncovered: "章程未覆盖",
    missing_index: "章程未加载"
  };

  var state = {
    payload: null, layer: "", text: "",
    schema: null, conflicts: [], open: {}
  };

  var $ = function (id) { return document.getElementById(id); };

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtInt(n) {
    if (n === null || n === undefined || n === "") return "—";
    var v = Number(n);
    if (!isFinite(v)) return "—";
    return v.toLocaleString("zh-CN");
  }

  function fmtMargin(m) {
    if (m === null || m === undefined) return { text: "—", cls: "note" };
    var pct = (Number(m) * 100).toFixed(1) + "%";
    return { text: (m > 0 ? "+" : "") + pct, cls: m >= 0 ? "pos" : "neg" };
  }

  function splitTerms(s) {
    return String(s || "").split(/[、,，\s]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
  }

  /* ---------------- 偏好面板（W11 W12：全部由 schema 驱动） ---------------- */

  var FIELDS = "prefs-fields";
  function fieldId(key) { return "pref--" + key; }

  function renderPrefs(schema) {
    if (!schema) {
      $(FIELDS).innerHTML = '<p class="hint">偏好选项未从服务端取到：本次不设置偏好，' +
        '生成的方案等同「不加任何约束」。</p>';
      return;
    }
    var keys = Object.keys(schema).filter(function (k) { return !(schema[k] || {}).hidden; });
    $("prefs-summary").textContent = "偏好设置（可选 · 共 " + keys.length + " 项，全部留空 = 不加任何约束）";

    var html = keys.map(function (key) {
      var s = schema[key] || {};
      var label = esc(s.label_cn || key);
      var note = s.note ? '<span class="pref-note">' + esc(s.note) + "</span>" : "";
      var ctl;
      if (s.type === "bool") {
        ctl = '<label class="check"><input type="checkbox" id="' + fieldId(key) + '"> ' + label + "</label>";
      } else if (s.type === "int") {
        var min = (s.min === undefined || s.min === null) ? "" : ' min="' + s.min + '"';
        var def = (s.default === undefined || s.default === null) ? "" : s.default;
        ctl = '<label class="field"><span>' + label + "</span>" +
          '<input type="number"' + min + ' id="' + fieldId(key) + '" placeholder="' +
          esc(def === "" ? "" : "默认 " + def) + '"></label>';
      } else if (s.allowed && s.allowed.length) {
        ctl = '<div class="pref-group"><span class="pref-label">' + label + "</span>" +
          s.allowed.map(function (v, i) {
            return '<label class="check"><input type="checkbox" data-for="' + fieldId(key) +
              '" value="' + esc(v) + '" id="' + fieldId(key) + "-" + i + '"> ' + esc(v) + "</label>";
          }).join("") + "</div>";
      } else {
        ctl = '<label class="field wide"><span>' + label + "</span>" +
          '<input type="text" id="' + fieldId(key) + '" placeholder="顿号或逗号分隔，留空 = 不限"></label>';
      }
      return '<div class="pref-item">' + ctl + note + "</div>";
    }).join("");
    $(FIELDS).innerHTML = html;

    Array.prototype.forEach.call($(FIELDS).querySelectorAll("input"), function (el) {
      el.addEventListener("change", checkConflicts);
      el.addEventListener("input", checkConflicts);
    });
  }

  function readPrefs() {
    var schema = state.schema;
    if (!schema) return null;
    var out = {};
    Object.keys(schema).forEach(function (key) {
      var s = schema[key] || {};
      var id = fieldId(key);
      if (s.type === "bool") {
        var cb = $(id);
        if (cb && cb.checked) out[key] = true;
        return;
      }
      if (s.type === "int") {
        var inp = $(id);
        if (!inp) return;
        var raw = String(inp.value || "").trim();
        if (!raw) return;
        var v = parseInt(raw, 10);
        if (!isFinite(v)) return;
        if (s.default !== undefined && v === s.default) return;  // 默认值 = 不下发该键
        out[key] = v;
        return;
      }
      if (s.allowed && s.allowed.length) {
        var vals = [];
        Array.prototype.forEach.call(
          document.querySelectorAll('input[data-for="' + id + '"]'),
          function (el) { if (el.checked) vals.push(el.value); });
        if (vals.length) out[key] = vals;
        return;
      }
      var text = $(id);
      if (!text) return;
      var terms = splitTerms(text.value);
      if (terms.length) out[key] = terms;
    });

    // 专业优先（自定义块，schema 里标 hidden 不参与通用渲染）
    var rows = document.querySelectorAll("#mp-rows .mp-row");
    var prio = [];
    Array.prototype.forEach.call(rows, function (rowEl) {
      var termEl = rowEl.querySelector(".mp-term");
      var wEl = rowEl.querySelector(".mp-weight");
      if (!termEl) return;
      var t = String(termEl.value || "").trim();
      if (!t) return;
      var w = parseInt((wEl && wEl.value) || "3", 10);
      if (!isFinite(w) || w < 1 || w > 5) w = 3;
      prio.push({ term: t, weight: w });
    });
    // 键名一律从 schema 派生（W12：前端**禁**写死偏好键名）—— 本自定义块通过
    // `custom_ui` 标记自己绑定哪两个键，服务端 schema 是唯一事实源。
    var mpKey = null, mpRatioKey = null;
    Object.keys(state.schema || {}).forEach(function (k) {
      var f = state.schema[k] || {};
      if (f.custom_ui === "mpBlock") mpKey = k;
      if (f.custom_ui === "mpBlockRatio") mpRatioKey = k;
    });
    if (prio.length && mpKey) {
      out[mpKey] = prio.slice(0, 5);
      var ratioEl = $("mp-ratio");
      var r = parseFloat((ratioEl && ratioEl.value) || "0.75");
      if (isFinite(r) && mpRatioKey) out[mpRatioKey] = r;
    }
    return Object.keys(out).length ? out : null;
  }

  /* 冲突只**提示**，不拦改、不自动删一侧（W16：归口在服务端 400） */
  function checkConflicts() {
    var prefs = readPrefs() || {};
    var msgs = [];
    (state.conflicts || []).forEach(function (pair) {
      var a = prefs[pair[0]] || [];
      var b = prefs[pair[1]] || [];
      var both = a.filter(function (x) { return b.indexOf(x) >= 0; });
      if (both.length) {
        msgs.push("「" + pair[2] + "」同时出现在「优先」与「排除」里：" + both.join("、") +
          " —— 同一维度既优先又排除是自相矛盾的，服务端会拒绝这次请求（不会替你改）。");
      }
    });
    $("prefs-conflict").textContent = msgs.join(" ");
    $("prefs-conflict").className = msgs.length ? "hint warn" : "hint";
  }

  function buildPrefs() { return readPrefs(); }

  /* ---------------- 常用组合（W31–W36：只填值，不是默认口径） ----------------
   * 组合清单与影响面文案一律来自 /api/meta（prefs_presets / preset_effect_cn）；
   * 本文件不持有任何键名、预设名或影响面句子 ⇒ 服务端换一组组合时前端零改动。
   */
  var PRESETS = "prefs-presets";

  function renderPresets(list) {
    if (!list || !list.length) {
      $(PRESETS).innerHTML = '<span class="hint">服务端未下发组合：请直接逐项设置。</span>';
      return;
    }
    $(PRESETS).innerHTML = list.map(function (p, i) {
      return '<button type="button" class="preset" data-preset="' + i + '">' +
        esc(p.name) + "</button>";
    }).join("");
    Array.prototype.forEach.call($(PRESETS).querySelectorAll("button[data-preset]"),
      function (el) {
        el.addEventListener("click", function () {
          applyPreset(list[Number(el.getAttribute("data-preset"))]);
        });
      });
  }

  function setControl(key, value) {
    var s = (state.schema || {})[key] || {};
    var id = fieldId(key);
    if (s.type === "bool") {
      var cb = $(id);
      if (cb) cb.checked = !!value;
      return;
    }
    if (s.type === "int") {
      var inp = $(id);
      if (inp) inp.value = String(value);
      return;
    }
    if (s.allowed && s.allowed.length) {
      var want = Array.isArray(value) ? value : [value];
      Array.prototype.forEach.call(
        document.querySelectorAll('input[data-for="' + id + '"]'),
        function (el) { el.checked = want.indexOf(el.value) >= 0; });
      return;
    }
    var text = $(id);
    if (text) text.value = (Array.isArray(value) ? value : [value]).join("、");
  }

  function applyPreset(p) {
    if (!p || !state.schema) return;
    var values = p.values || {};
    Object.keys(values).forEach(function (key) { setControl(key, values[key]); });
    checkConflicts();
    var parts = [];
    if (p.keys_cn && p.keys_cn.length) parts.push("填了 " + p.keys_cn.join("、"));
    if (p.effect_cn) parts.push(p.effect_cn);
    parts.push("可继续逐项修改；点「恢复空白」回到不加约束");
    $("preset-note").textContent = "已套用「" + p.name + "」：" + parts.join("；") + "。";
  }

  function resetPrefs() {
    if (!state.schema) return;
    Object.keys(state.schema).forEach(function (key) {
      var s = state.schema[key] || {};
      var id = fieldId(key);
      if (s.type === "bool") {
        var cb = $(id);
        if (cb) cb.checked = false;
        return;
      }
      if (s.type === "int") {
        var inp = $(id);
        if (inp) inp.value = "";
        return;
      }
      if (s.allowed && s.allowed.length) {
        Array.prototype.forEach.call(
          document.querySelectorAll('input[data-for="' + id + '"]'),
          function (el) { el.checked = false; });
        return;
      }
      var text = $(id);
      if (text) text.value = "";
    });
    $("preset-note").textContent = "";
    checkConflicts();
  }


  var _rankTimer = null;
  var _rankSeq = 0;

  /* 分数/科目变动 ⇒ 自动向服务端换算位次并展示（位次是算法的核心输入，
     不是"可选项"；此处的输入框只用于覆盖自动换算值）。 */
  function refreshAutoRank() {
    var el = $("rank-auto");
    if (!el) return;
    var scoreRaw = $("score").value.trim();
    var subject = $("subject").value;
    if (!scoreRaw) {
      el.textContent = "填入分数后，自动按一分一档换算位次";
      el.className = "hint";
      return;
    }
    var seq = ++_rankSeq;
    var url = "/api/rank?subject=" + encodeURIComponent(subject) +
              "&score=" + encodeURIComponent(scoreRaw);
    fetch(url).then(function (r) { return r.json(); }).then(function (d) {
      if (seq !== _rankSeq) return;                       // 丢弃过期响应
      if (d && d.ok) {
        el.textContent = "自动换算位次：" + fmtInt(d.rank) +
          "（2026 " + (d.subject === "physics" ? "物理" : "历史") +
          " 一分一档，" + d.score_label + " 档累计人数；该档最差位次，保守口径）";
        el.className = "hint hint-ok";
        el.dataset.rank = String(d.rank);
      } else {
        var why = { below_table: "分数低于表内最低档", above_table: "分数高于表内最高档",
                    score_invalid: "分数格式不对", score_not_in_table: "该分数不在表内" };
        el.textContent = "无法自动换算位次：" + (why[d && d.reason] || "未知原因") +
          "；请直接填「精确位次」";
        el.className = "hint hint-warn";
        delete el.dataset.rank;
      }
    }).catch(function () {
      if (seq !== _rankSeq) return;
      el.textContent = "位次换算服务暂时不可用；可手工填「精确位次」";
      el.className = "hint hint-warn";
    });
  }

  function bindRankAuto() {
    var s = $("score"), sub = $("subject");
    if (!s || !sub) return;
    function schedule() {
      clearTimeout(_rankTimer);
      _rankTimer = setTimeout(refreshAutoRank, 250);
    }
    s.addEventListener("input", schedule);
    s.addEventListener("change", schedule);
    sub.addEventListener("change", refreshAutoRank);
  }

  function body() {
    var b = { subject: $("subject").value };
    var score = $("score").value.trim();
    var rank = $("rank").value.trim();
    if (score) b.score = parseInt(score, 10);
    if (rank) b.rank = parseInt(rank, 10);
    var prefs = buildPrefs();
    if (prefs) b.prefs = prefs;
    return b;
  }

  function setStatus(text) { $("status-line").textContent = text || ""; }

  function fail(msg) {
    setStatus("");
    $("result").hidden = true;
    window.alert(msg);
  }

  function post(url, payload) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (resp) {
      var ctype = resp.headers.get("Content-Type") || "";
      if (ctype.indexOf("application/json") >= 0) {
        return resp.json().then(function (data) {
          if (!resp.ok || data.ok === false) {
            var e = (data && data.error) || {};
            throw new Error(e.message || ("请求失败（HTTP " + resp.status + "）"));
          }
          return { json: data };
        });
      }
      return resp.blob().then(function (blob) {
        var dispo = resp.headers.get("Content-Disposition") || "";
        var m = /filename="([^"]+)"/.exec(dispo);
        return { blob: blob, name: m ? m[1] : "plan" };
      });
    });
  }

  /* ---------------- 渲染 ---------------- */

  function renderSummary(s) {
    var items = [
      ["等效位次", fmtInt(s.rank)],
      ["位次来源", s.rank_method === "score_to_cumulative_count" ? "一分一档换算" : (s.rank_method || "—")],
      ["志愿条数", fmtInt(s.slot_count)],
      ["算法版本", esc(s.algo_version || "—")]
    ];
    $("summary-grid").innerHTML = items.map(function (kv) {
      return '<div class="item"><div class="k">' + kv[0] + '</div><div class="v">' + kv[1] + "</div></div>";
    }).join("");

    var msgs = [];
    (s.rank_warnings || []).forEach(function (w) { msgs.push(w); });
    /* 短表说明（C631）：文字与数字都由服务端/导出端现算（`plan_list.shortfall_page_note`，
       与清单 §三 同一批数）—— 页面**只逐字渲染**。此前这里写死 96 并猜病因
       （「你的位次段附近符合条件的候选不足」），而真实原因逐层在下面那几条里。 */
    if (s.slot_gap_note) { msgs.push(s.slot_gap_note); }
    (s.warnings || []).forEach(function (w) { msgs.push(w); });
    $("warns").innerHTML = msgs.map(function (m) { return "<p>" + esc(m) + "</p>"; }).join("");
  }

  function renderLayerCards(payload) {
    var layers = payload.summary.layers || {};
    var total = payload.summary.slot_count || 0;
    $("layer-cards").innerHTML = LAYER_ORDER.filter(function (k) {
      return layers[k] !== undefined;
    }).map(function (k) {
      var n = layers[k];
      var pct = total ? Math.round((n / total) * 100) : 0;
      return '<div class="layer-card ' + k + (state.layer === k ? " active" : "") +
        '" data-layer="' + k + '"><div class="n">' + n + '</div><div class="t">' +
        LAYER_CN[k] + " · 占 " + pct + "%</div></div>";
    }).join("");

    Array.prototype.forEach.call(document.querySelectorAll(".layer-card"), function (el) {
      el.addEventListener("click", function () {
        state.layer = (state.layer === el.dataset.layer) ? "" : el.dataset.layer;
        $("layer-filter").value = state.layer;
        renderLayerCards(state.payload);
        renderTable();
      });
    });
  }

  function charterCell(c) {
    if (!c) return '<span class="note">—</span>';
    var st = c.status || "missing_index";
    var label = CHARTER_CN[st] || st;
    var extra = "";
    if (st === "hard") extra = "（" + c.n_hard + " 条 ▾）";
    else if (st === "no_hard") {
      var soft = (c.n_soft || 0) + (c.n_stated || 0);
      if (soft) extra = "（建议/门槛 " + soft + " 条）";
    }
    return '<span class="risk ' + st + '" title="' + esc(label) + '">' +
      esc(label) + esc(extra) + "</span>";
  }

  /* 行级明细：只搬运后端给的字（W13），不做任何改写 / 截断 / 摘要。
   * 定位与上下文一律来自响应体（W17–W21）：前端不认识章程正文路径，也不自行算哈希（W22）。 */
  var LOCATE_FAIL_CN = {
    no_locator: "条款未带来源区间",
    missing_source: "章程正文文件缺失",
    stale_source: "章程正文已变更（哈希不符，区间可能指向别处）",
    span_mismatch: "区间与条文不符"
  };

  function locatorBlock(it) {
    var loc = it.locator || {};
    if (!loc.ok) {
      var codes = (loc.reasons || []).map(function (c) {
        return (LOCATE_FAIL_CN[c] || c) + "（" + c + "）";
      });
      return '<div class="loc bad">定位不可用：' + esc(codes.join("；") || "原因未给出") +
        "<span class=\"note\"> —— 定位不到原文不等于没有退档风险，请以当年招生章程为准。</span></div>";
    }
    var span = "字符 " + esc(loc.start) + "–" + esc(loc.end) + "（" + esc(loc.chars) + " 字）";
    var line = '<div class="loc">定位：' + esc(loc.file) +
      (loc.sentence_index === null || loc.sentence_index === undefined
        ? "" : " · 章程第 " + esc(loc.sentence_index) + " 句") +
      " · " + span + " · 版本 " + esc(loc.sha12) + "</div>";
    if (it.context && it.context.text) {
      line += "<details class=\"ctx\"><summary>原文上下文（逐字，前后扩到整句" +
        (it.context.truncated ? "；整句过长已按条文两侧各 80 字截取" : "") +
        "）</summary><pre>" + esc(it.context.text) + "</pre></details>";
    }
    return line;
  }

  function detailRow(r) {
    var items = (r.charter && r.charter.items) || [];
    if (!items.length) return "";
    var lis = items.map(function (it, i) {
      var named = it.major_named
        ? '<span class="named">原文点名本条专业</span>'
        : '<span class="note">原文未点名本条专业（是否适用于你，请按原文核对）</span>';
      var sent = (it.sentence_index === null || it.sentence_index === undefined)
        ? "" : ' · 章程第 ' + it.sentence_index + ' 句';
      return "<li><span class=\"cat\">【" + esc(it.category_cn) + "】</span>" +
        named + "<br>「" + esc(it.text) + "」<span class=\"note\">" + esc(sent) + "</span>" +
        locatorBlock(it) + "</li>";
    }).join("");
    return '<tr class="detail-row" data-detail="' + esc(r.slot) + '" hidden>' +
      '<td colspan="10"><div class="charter-detail">' +
      "<p class=\"hint\">第 " + esc(r.slot) + " 条 · " + esc(r.school) + " · 命中 <strong>" +
      items.length + "</strong> 条硬性限制条款（逐字引用，未改写）：</p><ul>" + lis + "</ul>" +
      "</div></td></tr>";
  }

  function renderTable() {
    if (!state.payload) return;
    var rows = state.payload.rows || [];
    var text = state.text.trim();
    var shown = rows.filter(function (r) {
      if (state.layer && r.risk_layer !== state.layer) return false;
      if (!text) return true;
      var hay = (r.school || "") + " " + (r.major || "") + " " + (r.direction || "");
      return hay.indexOf(text) >= 0;
    });

    $("table-title").textContent = "全部志愿（" + shown.length + " / " + rows.length + "）";

    if (!shown.length) {
      $("plan-table").querySelector("tbody").innerHTML =
        '<tr><td colspan="10" class="empty">没有符合条件的行</td></tr>';
      return;
    }

    $("plan-table").querySelector("tbody").innerHTML = shown.map(function (r) {
      var m = fmtMargin(r.margin_used);
      var notes = (r.risk_notes || []).concat(r.b1_notes || []).join("；");
      var hasItems = r.charter && r.charter.items && r.charter.items.length;
      return "<tr" + (hasItems ? ' class="expandable" data-slot="' + esc(r.slot) + '"' : "") + ">" +
        '<td class="num">' + esc(r.slot) + "</td>" +
        '<td><span class="tag ' + esc(r.risk_layer) + '">' + esc(LAYER_CN[r.risk_layer] || r.risk_layer) + "</span></td>" +
        "<td>" + esc(r.school) + "</td>" +
        "<td>" + esc(r.major) + (r.direction ? '<span class="note">（' + esc(r.direction) + "）</span>" : "") +
          (r.major_pref ? ' <span class="tag pref">★' + esc(r.major_pref.term) +
            "（权重 " + esc(r.major_pref.weight) + "）</span>" : "") + "</td>" +
        '<td class="code">' + esc(r.filling_code || "—") + "</td>" +
        '<td class="num">' + fmtInt(r.ref_center_used) + "</td>" +
        '<td class="num ' + m.cls + '">' + m.text + "</td>" +
        '<td class="num">' + esc(r.confidence === "high" ? "高" : (r.confidence === "low" ? "低" : "中")) + "</td>" +
        "<td>" + charterCell(r.charter) + "</td>" +
        '<td class="note">' + esc(notes || "—") + "</td>" +
        "</tr>" + detailRow(r);
    }).join("");

    Array.prototype.forEach.call(
      $("plan-table").querySelectorAll("tr.expandable"),
      function (tr) {
        tr.addEventListener("click", function () {
          var slot = tr.dataset.slot;
          var det = $("plan-table").querySelector('tr[data-detail="' + slot + '"]');
          if (!det) return;
          var willOpen = det.hidden;
          det.hidden = !willOpen;
          tr.classList.toggle("open", willOpen);
        });
      });
  }

  function renderCharter(payload) {
    var charter = payload.charter || {};
    var counts = charter.counts || {};
    $("charter-note").textContent = charter.available === false
      ? (charter.missing_index_line || "章程规则表本次未加载：不代表没有退档风险。")
      : ($("charter-note").dataset.note || "");
    $("charter-count").textContent = charter.available === false
      ? "规则表未加载"
      : ("规则表可回溯条款 " + fmtInt(charter.n_rules_total) + " 条；本表命中 " +
         fmtInt(counts.n_rules) + " 条不重复硬性条款");
    $("charter-section").textContent = charter.section_md || "";
  }

  /* -------- 系统自检读数（W24–W30：只展示响应体字段，代际不一致必须显式上屏） -------- */

  var ACC_REASON_CN = {
    missing_source: "读数件未找到",
    unparsable: "读数件无法解析",
    schema_mismatch: "读数件校验未通过"
  };

  function fmtRate(x) {
    if (x === null || x === undefined) return "—";
    var v = Number(x);
    if (!isFinite(v)) return "—";
    return (v * 100).toFixed(1) + "%";
  }

  /* -------- 三项关键指标（W63–W66：只搬运响应体字段，百分比由件内计数算出） -------- */

  var ACC_METRICS_REASON_CN = {
    metrics_missing: "读数件未找到",
    metrics_unparsable: "读数件无法解析",
    metrics_schema_unknown: "读数件代际不符",
    cells_empty: "读数件没有可用单元"
  };

  function metricCell(pct, num, den) {
    if (pct === null || pct === undefined) return "未核";
    return esc(pct) + "（" + esc(num) + "/" + esc(den) + "）";
  }

  function renderAccuracyMetrics(payload) {
    var m = payload.accuracy_metrics || {};
    var badge = $("accuracy-metrics-badge");
    var body = $("accuracy-metrics-table").querySelector("tbody");
    var src = m.source || {};

    $("accuracy-metrics-note").textContent = m.denominator_note || "";
    $("accuracy-metrics-boundary").textContent = m.boundary || "";

    if (!m.available) {
      badge.textContent = "未核";
      badge.className = "hint badge warn";
      body.innerHTML = '<tr><td colspan="7" class="empty">未核：' +
        esc(ACC_METRICS_REASON_CN[m.reason] || m.reason || "未知原因") +
        "（这不等于系统没有风险，只说明这一块本次没核对）</td></tr>";
      $("accuracy-metrics-source").textContent = "读数件：" + (src.file || "—");
      return;
    }

    badge.textContent = "口径与当前一致";
    badge.className = "hint badge ok";
    body.innerHTML = (m.rows || []).map(function (r) {
      var rel = r.bao_rel_state === "ok"
        ? metricCell(r.bao_rel_pct, r.bao_rel_num, r.bao_rel_den)
        : "未核（该单元计划内没有绝对保底行）";
      return "<tr>" +
        "<td>" + esc(r.subject_cn || r.subject) + "</td>" +
        '<td class="num">' + esc(r.validation_year) + "</td>" +
        '<td class="num">' + esc(r.n_students) + "</td>" +
        '<td class="num">' + metricCell(r.slippage_pct, r.n_miss, r.n_students) + "</td>" +
        '<td class="num">' + metricCell(r.chong_pct, r.chong_count, r.n_students) + "</td>" +
        '<td class="num">' + rel + "</td>" +
        '<td class="num">' + metricCell(r.coverage_pct, r.coverage_num, r.coverage_den) + "</td>" +
        "</tr>";
    }).join("");

    var nProblems = (m.problems || []).length;
    $("accuracy-metrics-source").textContent = "读数来源：" + (src.file || "—") +
      " · 校验 " + (src.sha12 || "—") + " · 生成于 " + (src.generated_at || "—") +
      (nProblems ? " · 自检发现 " + nProblems + " 处缺陷，数字可能不完整" : "");
  }

  function renderAccuracy(payload) {
    var a = payload.accuracy || {};
    var badge = $("accuracy-badge");
    var body = $("accuracy-table").querySelector("tbody");
    var src = a.source || {};

    if (!a.available) {
      badge.textContent = "未核";
      badge.className = "hint badge warn";
      $("accuracy-semantics").textContent =
        "本次没有读到系统自检读数（" + (ACC_REASON_CN[a.reason] || a.reason || "未知原因") +
        "）：这不等于系统没有风险，只说明这一块本次没核对。";
      body.innerHTML = '<tr><td colspan="7" class="empty">未核</td></tr>';
      $("accuracy-caliber").textContent = "";
      $("accuracy-source").textContent = "读数件：" + (src.file || "—");
      return;
    }

    badge.textContent = a.stale ? (a.stale_banner || "旧一代") : "口径与当前一致";
    badge.className = "hint badge" + (a.stale ? " warn" : " ok");
    $("accuracy-semantics").textContent = a.semantics || "";
    body.innerHTML = (a.cells || []).map(function (c) {
      var share = c.admitted_layer_share || {};
      var parts = Object.keys(share).filter(function (k) { return Number(share[k]) > 0; })
        .map(function (k) {
          var cn = (a.layer_cn && a.layer_cn[k]) || k;
          return cn + " " + fmtRate(share[k]);
        });
      return "<tr>" +
        "<td>" + esc(c.subject_cn || c.subject) + "</td>" +
        '<td class="num">' + esc(c.validation_year) + "</td>" +
        '<td class="num">' + esc(c.candidate_year) + "</td>" +
        '<td class="note">' + esc(parts.join(" · ") || "—") + "</td>" +
        "</tr>";
    }).join("");

    var cal = a.caliber || {};
    $("accuracy-caliber").textContent = "口径：规则组 " + (cal.rules || "—") +
      " · 命中判定 " + (cal.caliber || "—") + " · " + (cal.note || "");
    $("accuracy-source").textContent = "读数来源：" + (src.file || "—") +
      " · 校验 " + (src.sha12 || "—") + " · 生成于 " + (src.generated_at || "—") +
      (a.stale ? " · 代际不一致：" + (a.stale_reasons || []).join(" / ") : "");
  }

  function render(payload) {
    state.payload = payload;
    state.layer = "";
    $("result").hidden = false;

    var opts = '<option value="">全部层</option>' + LAYER_ORDER.filter(function (k) {
      return payload.summary.layers && payload.summary.layers[k] !== undefined;
    }).map(function (k) {
      return '<option value="' + k + '">' + LAYER_CN[k] + "（" + payload.summary.layers[k] + "）</option>";
    }).join("");
    $("layer-filter").innerHTML = opts;

    renderSummary(payload.summary);
    renderBao(payload);
    renderLayerCards(payload);
    renderTable();
    renderCharter(payload);
    renderAccuracyMetrics(payload);
    renderAccuracy(payload);

    var foot = "";
    if (payload.charter && payload.charter.available === false) {
      foot = "章程规则表本次未加载：所有行的「章程退档风险」显示为未加载，不代表没有退档风险。";
    }
    if (payload.prefs_text) foot += " 偏好：" + payload.prefs_text + "。";
    $("foot-note").textContent = foot;
    return payload;
  }

  // W74：只搬运响应体的结论句（措辞端唯一 = server `bao_disclosure`），前端不拼、不算界
  function renderBao(payload) {
    var b = payload.bao || {};
    var el = $("bao-note");
    if (!el) return;
    if (b.relation === "outside") {
      el.className = "hint hint-warn";
    } else if (b.relation === "inside") {
      el.className = "hint hint-ok";
    } else {
      el.className = "hint";
    }
    el.textContent = b.statement || "保底可配给界自检：未核（响应体缺少结论句）。";
  }

  /* C657 / W171 + C665 / W179：查这一条 —— 两种后端、**一套入口**。
     先问 `/api/health`「这个页面背后是谁」：
       · `gaokao-webui` = 服务版 ⇒ 走 `/api/why-absent`（现算，任意分数）；
       · `static-mode`  = 静态正式版 ⇒ 同一个路径由 `static-boot.js` 拦截，读**本案**
         导出期算好的索引（同一份池、同一代），响应形状完全相同。
     入口名、路径与静态索引模板都取 meta 的同一份声明（页面不写第二遍，WA5）。
     C671：静态面还要问**这一页**有没有索引（`why_absent_ready`）—— 模板 `static_index`
     是恒真的（`data/why-absent-{case}.json.gz`），拿它当「能查」会让 82 个档位页
     都显出一个点了必失败的框（档位页没有导出索引）。
     两者都不是（既无服务端、meta 又没声明静态索引、或这一页没有索引）⇒ 保持隐藏：
     不给一个点不动的框。 */
  function enableWhyAbsent(spec) {
    var card = $("why-absent-card");
    if (!card || !spec) return;
    fetch("/api/health").then(function (r) { return r.json(); }).then(function (h) {
      if (!h) return;
      var served = h.service === "gaokao-webui";
      var staticOk = h.service === "static-mode" && !!spec.static_index &&
                     h.why_absent_ready === true;
      if (!served && !staticOk) return;
      card.hidden = false;
      $("why-absent-go").addEventListener("click", function () { askWhyAbsent(spec); });
    }).catch(function () { /* 没有服务端：保持隐藏 */ });
  }

  function askWhyAbsent(spec) {
    var out = $("why-absent-out");
    var payload = body();
    payload.school = ($("why-absent-school").value || "").trim();
    var major = ($("why-absent-major").value || "").trim();
    if (major) payload.major = major;
    if (!payload.school) {
      out.textContent = "请先填学校名（不填专业就答整所学校）。";
      return;
    }
    out.textContent = "正在查这一条…";
    post(spec.path, payload).then(function (r) {
      var d = r.json || {};
      var lines = d.render || [];
      var html = lines.map(function (l) { return "<p>" + esc(l) + "</p>"; }).join("");
      out.innerHTML = html || "<p>（没有可展示的结论）</p>";
      var wa = d.why_absent || {};
      if (wa.ok === false) {
        /* 归因自己没通过互锚：结论不能直接用（页面不替它圆场） */
        out.innerHTML += "<p class=\"hint hint-warn\">这份归因没通过自校（" +
          esc((wa.problems || []).join("；")) + "）：上面的结论不可直接用。</p>";
      }
    }).catch(function (err) {
      out.textContent = err.message || "查询失败";
    });
  }

  /* ---------------- 事件 ---------------- */

  bindRankAuto();

  $("plan-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var payload = body();
    if (payload.score === undefined && payload.rank === undefined) {
      fail("请填写高考总分，或填写位次。");
      return;
    }
    $("submit-btn").disabled = true;
    setStatus("正在生成，约需 10 秒…");
    post("/api/plan", payload).then(function (r) {
      setStatus("已生成。");
      return render(r.json);
    }).catch(function (err) {
      fail(err.message || "生成失败");
    }).then(function () {
      $("submit-btn").disabled = false;
    });
  });

  function doExport(fmt) {
    var payload = body();
    payload.fmt = fmt;
    setStatus("正在导出…");
    post("/api/export", payload).then(function (r) {
      var url = URL.createObjectURL(r.blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = r.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      setStatus("已导出。");
    }).catch(function (err) {
      fail(err.message || "导出失败");
    });
  }

  $("export-md").addEventListener("click", function () { doExport("md"); });
  $("export-json").addEventListener("click", function () { doExport("json"); });

  $("layer-filter").addEventListener("change", function (ev) {
    state.layer = ev.target.value;
    if (state.payload) renderLayerCards(state.payload);
    renderTable();
  });

  $("filter-text").addEventListener("input", function (ev) {
    state.text = ev.target.value;
    renderTable();
  });

  $("prefs-clear").addEventListener("click", function () { resetPrefs(); });

  /* 元数据（偏好 schema / 常用组合 / 冲突维度 / 范围声明 / 分数区间）全部由后端起算 */
  fetch("/api/meta").then(function (r) { return r.json(); }).then(function (m) {
    if (!m) return;
    state.schema = m.prefs_schema || null;
    state.conflicts = m.conflict_pairs || [];
    state.effectCn = m.preset_effect_cn || {};
    renderPrefs(state.schema);
    renderPresets(m.prefs_presets);
    if (m.scope_note) $("scope-note").textContent = m.scope_note;
    if (m.disclaimer) $("disclaimer").textContent = m.disclaimer;
    if (m.charter_note) $("charter-note").dataset.note = m.charter_note;
    /* C657：入口名 / 端点路径 / schema 全部取服务端声明（WA5：页面不写第二遍） */
    if (m.why_absent && m.why_absent.enabled) enableWhyAbsent(m.why_absent);
    if (m.score_range) {
      $("score").min = m.score_range[0];
      $("score").max = m.score_range[1];
    }
  }).catch(function () {
    renderPrefs(null);
    renderPresets(null);
  });
})();
