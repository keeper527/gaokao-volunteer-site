/* 方案页窄屏适配（由 scripts/webui/plan_page_fit.py 生成；禁手改） */
(function () {
  "use strict";
  /* 一格放半屏会折成两行以上的，改为占一整行。**判据是「贴了列名之后这一格还能不能塞进半屏」**，
     所以量的是 `列名 + 「：」 + 值` 的字数（列名从 thead 读，**不写死中文**）：
     半屏约 155 px、字号 13 px ⇒ 一行放得下 ~11 字，超过 12 就占整行。
     只看值不看列名是不够的 —— 「章程退档风险：有章程·无硬性限」值只有 8 字，加列名 15 字必然折行。
     不看列名、不看列位：加列 / 改名都不用跟着改这里。 */
  var SPAN_CHARS = 12;
  function text(el) {
    return String(el.textContent || "").replace(/\s+/g, " ").trim();
  }
  /* 窄屏卡片把每格合成一行，读者失去「列位置」这个线索 ⇒ 列名必须贴到格上。
     列名从同一张表的 thead 读出来（禁在 JS 里另写一份中文）。 */
  function annotate(table) {
    var head = table.tHead && table.tHead.rows[0];
    if (!head) return;
    var names = [];
    for (var i = 0; i < head.cells.length; i++) names.push(text(head.cells[i]));
    var bodies = table.tBodies || [];
    for (var b = 0; b < bodies.length; b++) {
      var rows = bodies[b].rows;
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].cells;
        for (var c = 0; c < cells.length; c++) {
          var cell = cells[c];
          if (cell.colSpan > 1) continue;          /* 详情行横跨整行：没有对应列名 */
          var name = names[cell.cellIndex];
          if (name) cell.setAttribute("data-label", name);
          var shown = (name ? name.length + 1 : 0) + text(cell).length;
          if (shown > SPAN_CHARS) cell.setAttribute("data-span", "2");
          else cell.removeAttribute("data-span");
        }
      }
    }
  }
  function detailOf(tr) {
    var slot = tr.getAttribute("data-slot");
    return slot ? document.querySelector('tr[data-detail="' + slot + '"]') : null;
  }
  function syncAria(tr) {
    var det = detailOf(tr);
    tr.setAttribute("aria-expanded", det && !det.hidden ? "true" : "false");
  }
  /* 原站的可展开行只挂了 click：Tab 停不下来、Enter / Space 没反应 ⇒ 键盘用户打不开章程原文。 */
  function enhance(table) {
    var bodies = table.tBodies || [];
    for (var b = 0; b < bodies.length; b++) {
      var rows = bodies[b].rows;
      for (var r = 0; r < rows.length; r++) {
        var tr = rows[r];
        if (!tr.classList.contains("expandable")) continue;
        tr.tabIndex = 0;
        tr.setAttribute("role", "button");
        syncAria(tr);
      }
    }
  }
  function annotateAll() {
    var tables = document.querySelectorAll(".table-wrap table");
    for (var i = 0; i < tables.length; i++) { annotate(tables[i]); enhance(tables[i]); }
  }
  function closestRow(el) {
    while (el && el.nodeType === 1) {
      if (el.tagName === "TR") return el;
      el = el.parentNode;
    }
    return null;
  }
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  ready(function () {
    annotateAll();
    /* 表体是 fetch 回来之后才渲染的：一次性贴完就走 = 只贴到空表。
       用 MutationObserver 而不是定时器：重渲染几次就补几次，且不空转。 */
    if (window.MutationObserver) {
      var observer = new MutationObserver(function () { annotateAll(); });
      var wraps = document.querySelectorAll(".table-wrap");
      for (var i = 0; i < wraps.length; i++) {
        observer.observe(wraps[i], { childList: true, subtree: true });
      }
    }
    /* 键盘：复用 app.js 自己的 click 处理器（tr.click()），**不另写一套展开逻辑** ——
       两套实现迟早分叉。click 监听只负责把 aria-expanded 跟 hidden 对齐。 */
    var boxes = document.querySelectorAll(".table-wrap");
    for (var k = 0; k < boxes.length; k++) {
      boxes[k].addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return;
        var row = closestRow(ev.target);
        if (!row || !row.classList.contains("expandable")) return;
        ev.preventDefault();      /* Space 不滚页 */
        row.click();
      });
      boxes[k].addEventListener("click", function (ev) {
        var row = closestRow(ev.target);
        if (row && row.classList.contains("expandable")) syncAria(row);
      });
    }
  });
})();
