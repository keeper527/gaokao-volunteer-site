/* 静态版引导（由 scripts/webui/static_export.py 生成；禁手改） */
(function () {
  "use strict";
  var CASE = window.__CASE__ || "";
  var CASES = window.__CASES__ || [];
  /* 分数带（S13）：43 个预测档位由生成端预生成，页面**只查表**（`lo <= score <= hi`）——
     档位怎么算（最近档、平局取低档）是 `score_band_plans.band_for()` 的唯一实现，
     这里重算一遍就成了同一套算式的第二份实现（W133 同族）。 */
  var BANDS = window.__BANDS__ || null;
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function bandOf(id) { return (BANDS && has(BANDS.bands, id)) ? BANDS.bands[id] : null; }
  function bandSeg(subject) {
    return (BANDS && BANDS.by_subject && has(BANDS.by_subject, subject))
      ? BANDS.by_subject[subject] : null;
  }
  function bandHit(subject, score) {
    var seg = bandSeg(subject);
    if (!seg || !seg.ranges || typeof score !== "number" || isNaN(score)) return null;
    for (var i = 0; i < seg.ranges.length; i++) {
      var r = seg.ranges[i];
      if (score >= r[0] && score <= r[1]) return r[2];
    }
    return null;
  }
  /* 案例选择（S10）：`?case=<id>` **优先于** 编译进 HTML 的默认值 —— 横幅上的案例链接就是这个
     形态，说明页也写「或在地址后面加 ?case=C3」；闭集外 / 解析失败**一律回落默认**，
     禁渲空白页、禁编一个不存在的案例。`URLSearchParams` 不可用时退回正则（老浏览器）。 */
  (function () {
    var q = null;
    try { q = new URLSearchParams(window.location.search).get("case"); }
    catch (e) {
      var m = /[?&]case=([^&#]*)/.exec(window.location.search || "");
      if (m) { try { q = decodeURIComponent(m[1]); } catch (e2) { q = m[1]; } }
    }
    if (!q) return;
    for (var i = 0; i < CASES.length; i++) { if (CASES[i].id === q) { CASE = q; return; } }
    /* 分数档也走同一个入口（`?case=P600`）：闭集 = `__BANDS__.bands` 的键，别的一律回落 */
    if (bandOf(q)) { CASE = q; return; }
  })();
  /* 说明页链接：站点为全量案例时由 package 端替换成 <a>，子集站点留空（禁留占位字面量） */
  var EXTRA_LINK = " · <a href='guide.html'>使用说明（家长版）</a>";
  var orig = window.fetch ? window.fetch.bind(window) : null;

  function jsonRes(obj, status) {
    var code = status || 200;
    return {
      ok: code < 400, status: code,
      headers: { get: function (k) {
        return String(k).toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null;
      } },
      json: function () { return Promise.resolve(obj); },
      text: function () { return Promise.resolve(JSON.stringify(obj)); },
      blob: function () { return Promise.resolve(new Blob([JSON.stringify(obj)], { type: "application/json" })); }
    };
  }
  function fileRes(text, name, ctype) {
    return {
      ok: true, status: 200,
      headers: { get: function (k) {
        k = String(k).toLowerCase();
        if (k === "content-type") return ctype;
        if (k === "content-disposition") return 'attachment; filename="' + name + '"';
        return null;
      } },
      blob: function () { return Promise.resolve(new Blob([text], { type: ctype })); },
      text: function () { return Promise.resolve(text); },
      json: function () { return Promise.reject(new Error("不是 JSON")); }
    };
  }
  var PART_P = {};
  function loadPart(url) {
    /* 一个分件只注入一次（并发取同一件时共用同一个 Promise；失败也缓存 ⇒ 不反复重试打日志） */
    if (!Object.prototype.hasOwnProperty.call(PART_P, url)) {
      PART_P[url] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = url;
        s.async = true;
        s.onload = function () { resolve(); };
        s.onerror = function () { reject(new Error("内联分件缺失：" + url)); };
        (document.head || document.documentElement).appendChild(s);
      });
    }
    return PART_P[url];
  }
  function gunzip(b64, path) {
    /* S14 的第一条出路（2026-11-15）：分件可以按 `gzip+base64` 落盘，解回**原文**再交给页面。
       压缩只改落盘形态，不改内容：`data/` 下那件与解压后的这一份仍要逐字节相同（S11）。
       浏览器不支持 `DecompressionStream` 时**明确报错**，禁把「解不开」当「没有这件」。 */
    if (typeof DecompressionStream !== "function" || typeof Blob !== "function" ||
        typeof Response !== "function") {
      return Promise.reject(new Error("浏览器不支持解压（DecompressionStream）：" + path));
    }
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var stream = new Blob([arr]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  function getText(path) {
    /* S11：`file://` 下 fetch 本地文件被同源策略挡掉（双击 HTML 会空表）⇒ 改走**分件注入**：
       索引件声明「哪一件在哪个分件里」，需要哪件才注入哪件（`<script src>` 不受 fetch 的
       同源限制）。分件与 `data/` 下那件由导出端保证**逐字节相同**，取谁都不改数字。
       http 下仍走 fetch（JSON.parse 比先解析 4.69 MB 的 JS 字符串字面量更省）。 */
    var INLINE = window.__INLINE_TEXT__;
    if (INLINE && Object.prototype.hasOwnProperty.call(INLINE, path)) {
      return Promise.resolve(INLINE[path]);
    }
    var FILES = window.__INLINE_FILES__;
    var isFile = String(window.location.protocol) === "file:";
    if (isFile && FILES && Object.prototype.hasOwnProperty.call(FILES, path)) {
      return loadPart(FILES[path]).then(function () {
        var T = window.__INLINE_TEXT__;
        if (T && Object.prototype.hasOwnProperty.call(T, path)) {
          return T[path];
        }
        var G = window.__INLINE_GZIP__;
        if (G && Object.prototype.hasOwnProperty.call(G, path)) {
          return gunzip(G[path], path);
        }
        throw new Error("内联分件未带载荷：" + path);
      });
    }
    if (!orig) return Promise.reject(new Error("无 fetch"));
    return orig(path).then(function (r) {
      if (!r.ok) throw new Error("静态件缺失：" + path);
      return r.text();
    });
  }
  function getJson(path) { return getText(path).then(function (t) { return JSON.parse(t); }); }

  var metaP = null;
  window.fetch = function (url, opts) {
    var path = String(url || "").split("?")[0];
    if (path === "/api/meta") {
      if (!metaP) metaP = getJson("data/meta.json");
      return metaP.then(function (m) { return jsonRes(m); });
    }
    if (path === "/api/plan") {
      return getJson("data/plan-" + CASE + ".json").then(function (p) { return jsonRes(p); })
        .catch(function (e) {
          return jsonRes({ ok: false, error: { code: "static_missing", message: e.message } }, 404);
        });
    }
    if (path === "/api/export") {
      var fmt = "md";
      try { fmt = (JSON.parse((opts && opts.body) || "{}").fmt) || "md"; } catch (e) { fmt = "md"; }
      if (fmt === "json") {
        return getText("data/plan-" + CASE + ".json").then(function (t) {
          return fileRes(t, "plan-" + CASE + ".json", "application/json; charset=utf-8");
        });
      }
      return getText("data/list-" + CASE + ".md").then(function (t) {
        return fileRes(t, "list-" + CASE + ".md", "text/markdown; charset=utf-8");
      });
    }
    if (path === "/api/rank") {
      /* 静态版没有一分一档表可查：明确告诉前端「不可用」，禁编一个位次 */
      return Promise.resolve(jsonRes({ ok: false, reason: "static_mode" }, 200));
    }
    if (path === "/api/health") {
      /* C657：静态版没有服务端 ⇒ 自己回答「没有后端」。两种情况都错：让它漏到 orig 会
         逃出子路径前缀（S15 现场），而回一个 `gaokao-webui` 会让页面显出一个点不动的框。 */
      return Promise.resolve(jsonRes({ ok: false, service: "static-mode", reason: "no_backend" }, 200));
    }
    return orig ? orig(url, opts) : Promise.reject(new Error("无 fetch"));
  };

  function pageHead(cur, band) {
    if (band) {
      return "本页档位 <b>" + CASE + "</b>：" + band.subject_cn + " " + band.score + " 分" +
        "（本档覆盖 " + band.lo + "–" + band.hi + " 分：你的分数落在这个区间，用的就是这一页）";
    }
    return "本页案例 <b>" + CASE + "</b>" + (cur ? "：" + cur.input_cn : "");
  }
  /* 分数切换面板：选项 / 区间 / 步长**全部**来自 `__BANDS__`（生成端现算），禁在页面里写死；
     查不到档位时说的是「超出预生成范围」，不是「没有数据」。 */
  function scoreBox() {
    if (!BANDS || !BANDS.by_subject) return "";
    var opts = "", ranges = "", first = null;
    for (var s in BANDS.by_subject) {
      if (!has(BANDS.by_subject, s)) continue;
      var g = BANDS.by_subject[s];
      if (!first) first = g;
      opts += '<option value="' + s + '">' + (g.subject_cn || s) + "</option>";
      ranges += (ranges ? " / " : "") + (g.subject_cn || s) + " " + g.lo + "–" + g.hi;
    }
    if (!opts) return "";
    return " · <b>查自己的分数</b> <select id=\"band-subject\">" + opts + "</select>" +
      " <input id=\"band-score\" type=\"number\" inputmode=\"numeric\" min=\"0\" max=\"750\"" +
      " step=\"1\" placeholder=\"例如 587\" style=\"width:96px\">" +
      " <button id=\"band-go\" type=\"button\">查看这一档</button>" +
      " <span id=\"band-msg\"></span>" +
      "<div style=\"margin-top:4px\">静态版按 " + (first ? first.step_note : "") +
      " 预生成，预生成范围 " + ranges + "；超出范围请用在线服务版" +
      "（静态页不在浏览器里算方案）。</div>";
  }
  function bindScoreBox() {
    var go = document.getElementById("band-go");
    if (!go) return;
    var msg = document.getElementById("band-msg");
    var box = document.getElementById("band-score");
    function say(t) { if (msg) msg.textContent = t; }
    go.onclick = function () {
      var sel = document.getElementById("band-subject");
      var inp = document.getElementById("band-score");
      var subject = sel ? String(sel.value || "") : "";
      var seg = bandSeg(subject);
      var raw = inp ? String(inp.value || "").replace(/[^0-9]/g, "") : "";
      if (!seg) { say("先选科类"); return; }
      if (!raw) { say("先填一个整数分数（" + seg.subject_cn + " " + seg.lo + "–" + seg.hi + " 分）"); return; }
      var score = parseInt(raw, 10);
      /* 线下 ≠ 超范围（S13 · 2026-11-15 12:00）：控制线由生成端注入
         （`__BANDS__.by_subject[*].control` ← `control_line.CONTROL_LINE`，页面**不抄线值**）。
         线下分数在本科批里没有可投档的学校 ⇒ 明说不给方案，**禁**拿「超出预生成范围」糊过去
         （那句话会让人以为「分数再高一点点就有」，而真实原因是这条线）。
         线下**也有容量**（2026-11-16 22:00 / C642）：投档件里线下实有 25 / 30 行，
         但全部是「八协计划」/「边防军人子女预科班」这类**要求特定报考资格**的计划 ——
         「没有可投档的学校」这句话要说全，否则家长自己翻到那几行会以为系统在骗他。
         行数 / 所数 / 资格名全部来自生成端的 `seg.below_admission`（唯一构造点），
         页面零算术；`general_rows > 0`（线下真有普通计划）时**不造**「全部是」这一句（判据报红）。 */
      if (seg.control && score < seg.control) {
        var bmsg = seg.subject_cn + " " + score + " 分低于 2026 本科批控制线（" + seg.control + " 分）";
        if (seg.below_admission && seg.below_admission.rows && !seg.below_admission.general_rows) {
          bmsg += "：本科批在这条线以下还有 " + seg.below_admission.rows + " 条投档记录、来自 " +
            seg.below_admission.schools + " 所院校，全部是要求特定报考资格的" +
            seg.below_admission.kinds_cn + "（普通考生报不了）—— 本页不给方案（服务版同样拒绝计算）。";
        } else {
          bmsg += "：本科批里没有可以投档的学校，本页不给方案（服务版同样拒绝计算）。";
        }
        say(bmsg);
        return;
      }
      /* 超出预生成范围（2026-11-16 04:00）：上界之外**还有多少人**必须说出来 ——
         只写「超出预生成范围」读起来像「没有数据」，而真相是「上面人太少、没为这几单独
         预生成整页」。`at` / `count` / `pct_cn` 全部来自生成端注入的 `seg.tail`
         （官方一分一档现算，页面只拼字符串、不算百分数）；注入缺失 ⇒ 退回旧措辞，
         **禁**在页面里编一个数（判据 `bands_tail_note_missing` 判这段代码在不在）。 */
      if (score > seg.hi && seg.tail && seg.tail.count) {
        /* 上界之外**有没有学校在招**（2026-11-16 20:30 / C641）：人数之后紧接着容量 ——
           「402 人」不是「402 个机会」。行数 / 所数 / 年度全部来自生成端注入的
           `seg.tail_admission`（官方投档件现算），页面只拼字符串、不印分母、不算占比；
           注入为 null（件读不出 / 锚点不符）时**不造这一句**，只留上面的人数句。 */
        var msg = seg.subject_cn + " " + score + " 分超出预生成范围（" + seg.lo + "–" + seg.hi + "）：" +
          seg.tail.at + " 分及以上共 " + seg.tail.count + " 人（占" + seg.subject_cn + "考生 " +
          seg.tail.pct_cn + "），人数太少、没有为这一段单独预生成整页";
        if (seg.tail_admission) {
          msg += "；" + seg.tail_admission.year + " 年本科批在这条线之上有 " +
            seg.tail_admission.rows + " 条投档记录、来自 " + seg.tail_admission.schools +
            " 所院校 —— 这一段有学校在招";
        }
        msg += "；请用在线服务版按精确位次算。";
        say(msg);
        return;
      }
      if (score < seg.lo || score > seg.hi) {
        say(seg.subject_cn + " " + score + " 分超出预生成范围（" + seg.lo + "–" + seg.hi + "），请用在线服务版");
        return;
      }
      var hit = bandHit(subject, score);
      var b = hit ? bandOf(hit) : null;
      if (!b) { say("查不到档位（预生成表不完整，请用在线服务版）"); return; }
      say("→ " + hit + "：" + b.subject_cn + " " + b.score + " 分档（覆盖 " + b.lo + "–" + b.hi + " 分）");
      window.location.search = "?case=" + encodeURIComponent(hit);
    };
    if (box) {
      box.onkeydown = function (ev) { if (ev && ev.key === "Enter") { ev.preventDefault(); go.onclick(); } };
    }
  }

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(function () {
    var cur = null;
    for (var i = 0; i < CASES.length; i++) { if (CASES[i].id === CASE) { cur = CASES[i]; break; } }
    var band = bandOf(CASE);
    var bar = document.getElementById("static-bar");
    if (bar) {
      var links = CASES.map(function (c) {
        return '<a class="' + (c.id === CASE ? "on" : "") + '" href="?case=' +
          encodeURIComponent(c.id) + '">' + c.id + " " + (c.subject_cn || "") + " " +
          (c.short_cn || "") + "</a>";
      }).join("");
      bar.innerHTML = "<b>静态正式版（只读：不联网、不在本机跑算法）</b> · " + pageHead(cur, band) +
        scoreBox() +
        " · 数字来自产物库同一份方案件；表单不参与计算，切换案例：" + links + EXTRA_LINK;
      bindScoreBox();
    }
    if (!cur && !band) return;
    var form = document.getElementById("plan-form");
    if (form) {
      Array.prototype.forEach.call(form.querySelectorAll("input,select,textarea"),
        function (el) { el.disabled = true; });
    }
    var sub = document.getElementById("subject");
    if (sub) sub.value = cur ? cur.subject : band.subject;
    var sc = document.getElementById("score");
    if (sc) {
      var sv = cur ? cur.score : band.score;
      if (sv !== null && sv !== undefined) sc.value = String(sv);
    }
    var rk = document.getElementById("rank");
    if (rk && cur && cur.rank !== null && cur.rank !== undefined) rk.value = String(cur.rank);
    /* 首屏直接把该案例的方案渲出来：静态页不该要求读者先点一次按钮 */
    setTimeout(function () {
      if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    }, 30);
  });
})();
