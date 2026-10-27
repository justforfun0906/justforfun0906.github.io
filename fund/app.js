"use strict";
// Fund dashboard: renders data/live.json (built by harness/fundsite.py on the trading server) and re-polls it.
// Every string from the data goes in through textContent: agent text and names are data, never markup.

const DATA_URL = "data/live.json";
const POLL_MS = 60_000;
const STALE_MIN = 25;
const SLEEVE_COLOR = { core: "var(--s1)", satellite: "var(--s2)", defensive: "var(--s3)", "?": "var(--unk)", cash: "var(--cash)" };
const PHASE = { open: "盤中", closed: "已收盤", pre: "盤前" };

let D = null;
let sortKey = "weight", sortDir = -1, group = "overview";
const opened = new Set();

// --- tiny DOM helpers ----------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// --- formatting ----------------------------------------------------------------------------------------
const nf = (d) => new Intl.NumberFormat("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
const F0 = nf(0), F1 = nf(1), F2 = nf(2);
const ok = (x) => x != null && Number.isFinite(x);
const pct = (x, d = 2, sign = true) => ok(x) ? (sign && x > 0 ? "+" : x < 0 ? "−" : "") + nf(d).format(Math.abs(x * 100)) + "%" : "—";
const pp = (x) => ok(x) ? (x > 0 ? "+" : x < 0 ? "−" : "") + F2.format(Math.abs(x * 100)) + " pp" : "—";
const money = (x) => ok(x) ? (x < 0 ? "−" : "") + F0.format(Math.abs(x)) : "—";
const yi = (x) => ok(x) ? F2.format(x / 1e8) + " 億" : "—";
const num = (x, d = 2) => ok(x) ? (x < 0 ? "−" : "") + nf(d).format(Math.abs(x)) : "—";
const dirClass = (x) => !ok(x) || Math.abs(x) < 1e-9 ? "flat" : x > 0 ? "up" : "down";
const arrow = (x) => !ok(x) || Math.abs(x) < 1e-9 ? "" : x > 0 ? "▲ " : "▼ ";
const signed = (x, f) => ok(x) ? h("span", { class: dirClass(x) }, arrow(x) + f(x)) : h("span", { class: "flat" }, "—");
const hhmm = (iso) => iso ? iso.slice(11, 16) : "";
const ago = (iso) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "剛剛" : m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`;
};

// --- tooltip -------------------------------------------------------------------------------------------
const tip = $("tip");
function showTip(ev, title, rows) {
  tip.replaceChildren(h("div", { class: "t" }, title),
    ...rows.map(([name, val, color]) => h("div", { class: "r" },
      h("span", {}, color ? h("i", { class: "key-line", style: `background:${color}` }) : null, name), h("b", {}, val))));
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
  tip.style.left = Math.max(8, x) + "px";
  tip.style.top = Math.max(8, y) + "px";
}
const hideTip = () => { tip.hidden = true; };

// --- line chart: series share one y-axis; crosshair snaps to the nearest x ----------------------------------
function lineChart(el, { series, xs, xLabel, yFmt, tipTitle, xDomain, area, zero }) {
  el.replaceChildren();
  const W = el.clientWidth, H = el.clientHeight;
  if (!xs.length || W < 50) { el.append(h("div", { class: "empty" }, "尚無資料")); return; }
  const m = { l: 48, r: 92, t: 10, b: 24 };
  if (W < 480) m.r = 64;
  const all = series.flatMap((sr) => sr.ys).filter(ok);
  let lo = Math.min(...all, zero ?? Infinity), hi = Math.max(...all, zero ?? -Infinity);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const [x0, x1] = xDomain || [xs[0], xs[xs.length - 1]];
  const X = (v) => m.l + (x1 === x0 ? (W - m.l - m.r) / 2 : (v - x0) / (x1 - x0) * (W - m.l - m.r));
  const Y = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  const ticks = niceTicks(lo, hi, H < 150 ? 3 : 5);
  const ax = s("g", { class: "axis" });
  for (const t of ticks) {
    ax.append(s("line", { class: "gridline", x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
    ax.append(s("text", { x: m.l - 8, y: Y(t) + 4, "text-anchor": "end" }, yFmt(t)));
  }
  if (zero != null && zero > lo && zero < hi) ax.append(s("line", { class: "baseline", x1: m.l, x2: W - m.r, y1: Y(zero), y2: Y(zero) }));
  const lab = xLabel(xs, X);
  for (const [v, t] of lab) ax.append(s("text", { x: X(v), y: H - 6, "text-anchor": "middle" }, t));
  svg.append(ax);
  series.forEach((sr, i) => {
    const pts = xs.map((x, j) => [x, sr.ys[j]]).filter((p) => ok(p[1]));
    if (!pts.length) return;
    const d = pts.map((p, j) => (j ? "L" : "M") + X(p[0]).toFixed(1) + "," + Y(p[1]).toFixed(1)).join("");
    if (area && i === 0) svg.append(s("path", { d: d + `L${X(pts.at(-1)[0])},${Y(zero ?? lo)}L${X(pts[0][0])},${Y(zero ?? lo)}Z`, fill: "var(--s1-wash)" }));
    svg.append(s("path", { d, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    const e = pts.at(-1);
    svg.append(s("circle", { cx: X(e[0]), cy: Y(e[1]), r: 4, fill: sr.color, stroke: "var(--surface)", "stroke-width": 2 }));
    if (sr.label) sr._end = [X(e[0]), Y(e[1]), sr.label(e[1])];
  });
  // end labels; push apart only when they collide
  const ends = series.filter((sr) => sr._end).map((sr) => sr._end).sort((a, b) => a[1] - b[1]);
  for (let i = 1; i < ends.length; i++) if (ends[i][1] - ends[i - 1][1] < 14) ends[i][1] = ends[i - 1][1] + 14;
  for (const [x, y, t] of ends) svg.append(s("text", { class: "endlabel", x: x + 9, y: y + 4 }, t));
  // crosshair
  const cross = s("line", { x1: 0, x2: 0, y1: m.t, y2: H - m.b, stroke: "var(--axis)", "stroke-width": 1, visibility: "hidden" });
  const dots = series.map((sr) => s("circle", { r: 4, fill: sr.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" }));
  svg.append(cross, ...dots);
  const hit = s("rect", { x: m.l, y: 0, width: Math.max(0, W - m.l - m.r), height: H, fill: "transparent" });
  hit.addEventListener("pointermove", (ev) => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    let j = 0;
    xs.forEach((x, k) => { if (Math.abs(X(x) - px) < Math.abs(X(xs[j]) - px)) j = k; });
    cross.setAttribute("x1", X(xs[j])); cross.setAttribute("x2", X(xs[j])); cross.setAttribute("visibility", "visible");
    series.forEach((sr, k) => {
      const v = sr.ys[j];
      dots[k].setAttribute("visibility", ok(v) ? "visible" : "hidden");
      if (ok(v)) { dots[k].setAttribute("cx", X(xs[j])); dots[k].setAttribute("cy", Y(v)); }
    });
    showTip(ev, tipTitle(j), series.map((sr) => [sr.name, sr.tipFmt(sr.ys[j], j), sr.color]));
  });
  hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); });
  svg.append(hit);
  el.append(svg);
}
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const legend = (el, items) => el.replaceChildren(...items.map(([name, color, box]) =>
  h("span", {}, h("i", { class: box ? "key-box" : "key-line", style: `background:${color}` }), name)));

// --- sections --------------------------------------------------------------------------------------------
function renderHeader() {
  const open = D.phase === "open";
  const p = $("phase");
  p.className = "pill " + D.phase;
  p.replaceChildren(h("i", { class: "dot" }), `${PHASE[D.phase] || D.phase} · ${D.session}`);
  $("updated").textContent = `資料時間 ${hhmm(D.generated_at)}（${ago(D.generated_at)}）`;
  const mins = (Date.now() - new Date(D.generated_at).getTime()) / 60000;
  const st = $("stale");
  st.hidden = !(open && mins > STALE_MIN);
  st.textContent = `盤中資料已 ${Math.round(mins)} 分鐘未更新，數字可能落後。`;
  $("fund-name").textContent = D.fund;
  document.title = `${D.fund} · 基金儀表板`;
}

function renderHero() {
  $("nav").textContent = money(D.nav);
  $("nav-yi").textContent = `≈ ${yi(D.nav)}元 · 現金 ${money(D.cash)}`;
  $("source").textContent = D.source;
  $("day").replaceChildren(signed(D.day_pnl, (x) => money(Math.abs(x)) + `（${pct(D.day_ret)}）`));
  $("taiex-day").replaceChildren(signed(D.taiex_day, (x) => pct(x)));
  $("day-excess").replaceChildren(signed(ok(D.taiex_day) ? D.day_ret - D.taiex_day : null, pp));
  const fees = ok(D.fees_today) && D.fees_today > 0 ? `今日手續費與交易稅 ${money(D.fees_today)}（已計入）。` : "";
  $("fill-note").textContent = (D.phase === "open" ? "盤中以成交均價（VWAP）估算當日委託成交；收盤後以官方結算為準。" : "") + fees;

  const pts = D.intraday || [];
  const base = pts[0];
  legend($("intra-legend"), [["本基金", "var(--s1)"], ["加權指數", "var(--bench)"]]);
  if (!base || pts.length < 2) {
    $("intra").replaceChildren(h("div", { class: "empty" }, D.phase === "pre" ? "09:00 開盤後開始記錄" : "開盤後開始記錄"));
    return;
  }
  const t = (p) => { const d = new Date(p.t); return d.getUTCHours() + 8 + d.getUTCMinutes() / 60; };
  const xs = pts.map(t);
  lineChart($("intra"), {
    xs, zero: 0, xDomain: [9, 13.5],
    series: [
      { name: "本基金", color: "var(--s1)", ys: pts.map((p) => p.nav / base.nav - 1), label: (v) => "本基金 " + pct(v), tipFmt: (v, j) => pct(v) + "  " + money(pts[j].nav) },
      { name: "加權指數", color: "var(--bench)", ys: pts.map((p) => ok(p.taiex) && ok(base.taiex) ? p.taiex / base.taiex - 1 : null), label: (v) => "加權 " + pct(v), tipFmt: (v) => pct(v) },
    ],
    yFmt: (v) => pct(v, Math.abs(v) < 0.01 ? 1 : 1, false).replace("−", "-"),
    xLabel: () => [[9, "09:00"], [10, "10:00"], [11, "11:00"], [12, "12:00"], [13, "13:00"], [13.5, "13:30"]].filter(([v]) => v !== 13.5 || $("intra").clientWidth > 420),
    tipTitle: (j) => hhmm(pts[j].t),
  });
}

function renderTiles() {
  const R = D.realised || {}, K = D.risk || {};
  const tile = (label, value, detail, cls) => h("div", { class: "tile" }, h("div", { class: "label" }, label),
    h("div", { class: "v " + (cls || "") }, value), h("div", { class: "d" }, detail));
  $("tiles").replaceChildren(
    tile("累積報酬", pct(R.ret), `加權 ${pct(R.taiex_ret)} · 超額 ${pp(R.excess)}`, dirClass(R.ret)),
    tile("最大回撤", ok(R.mdd) ? pct(R.mdd, 2, false) : "—", `目前 ${ok(R.dd_now) ? pct(R.dd_now, 2, false) : "—"}`),
    tile("Beta（加權）", num(K.beta_taiex), `預估，${K.window_days || 120} 日 · 實現 ${num(R.beta)}`),
    tile("年化波動", pct(K.vol_ann, 1, false), `預估 · 加權 ${pct(K.taiex_vol_ann, 1, false)}`),
    tile("現金比重", pct(D.cash_weight, 1, false), "規定 0–25%"),
    tile("持股檔數", `${K.n ?? "—"} 檔`, `有效檔數 ${num(K.eff_n, 1)} · 前五大 ${pct(K.top5, 1, false)}`),
  );
}

function renderCurve() {
  const c = D.curve || [];
  legend($("cum-legend"), [["本基金", "var(--s1)"], ["加權指數", "var(--bench)"]]);
  if (c.length < 2) {
    $("cum").replaceChildren(h("div", { class: "empty" }, "第一個交易日收盤後開始累積"));
    $("dd").replaceChildren();
    return;
  }
  const xs = c.map((_, i) => i);
  const xl = (xs, X) => {
    const step = Math.max(1, Math.ceil(c.length / Math.max(2, Math.floor($("cum").clientWidth / 90))));
    return xs.filter((i) => i % step === 0 || i === c.length - 1).map((i) => [i, c[i].date.slice(5)]);
  };
  const title = (j) => c[j].date + (c[j].live ? "（盤中）" : j === 0 ? "（基期）" : "");
  lineChart($("cum"), {
    xs, xLabel: xl, tipTitle: title, zero: 100,
    series: [
      { name: "本基金", color: "var(--s1)", ys: c.map((p) => p.nav / c[0].nav * 100), label: (v) => "本基金 " + F1.format(v), tipFmt: (v, j) => F2.format(v) + "  " + yi(c[j].nav) },
      { name: "加權指數", color: "var(--bench)", ys: c.map((p) => ok(p.taiex) ? p.taiex / c[0].taiex * 100 : null), label: (v) => "加權 " + F1.format(v), tipFmt: (v, j) => F2.format(v) + "  " + F0.format(c[j].taiex) },
    ],
    yFmt: (v) => F1.format(v),
  });
  let peak = -Infinity;
  const dd = c.map((p) => { peak = Math.max(peak, p.nav); return p.nav / peak - 1; });
  lineChart($("dd"), {
    xs, xLabel: xl, tipTitle: title, zero: 0, area: true,
    series: [{ name: "回撤", color: "var(--s1)", ys: dd, label: (v) => pct(v, 2, false), tipFmt: (v) => pct(v, 2, false) }],
    yFmt: (v) => pct(v, 1, false).replace("−", "-"),
  });
}

function renderRisk() {
  const K = D.risk || {}, R = D.realised || {};
  const need = (n) => `需 ≥ ${n} 個交易日`;
  const rows = [
    ["sec", "市場敏感度（預估）"],
    ["Beta vs 加權指數", num(K.beta_taiex), "權重加總各股 120 日 Beta"],
    ["Beta vs 櫃買指數", num(K.beta_tpex), "投組模擬報酬回歸"],
    ["Beta vs 費半（前一晚）", num(K.beta_sox), "台股當日 vs 美股前一交易日 SOX"],
    ["與加權指數相關係數", num(K.corr_taiex), ""],
    ["sec", "波動與下檔風險（預估）"],
    ["年化波動度", pct(K.vol_ann, 1, false), `加權指數 ${pct(K.taiex_vol_ann, 1, false)}`],
    ["追蹤誤差（年化）", pct(K.te_ann, 1, false), "相對加權指數"],
    ["1 日 VaR 95%", ok(K.var95_1d) ? pct(-K.var95_1d, 2, false) + `（${yi(K.var95_1d * D.nav)}）` : "—", "歷史模擬：最差 5% 交易日"],
    ["1 日 CVaR 95%", ok(K.cvar95_1d) ? pct(-K.cvar95_1d, 2, false) : "—", "最差 5% 交易日的平均損失"],
    ["sec", "集中度"],
    ["有效持股檔數", num(K.eff_n, 1), "1 / Σ(股票權重²)"],
    ["前五大權重", pct(K.top5, 1, false), ""],
    ["最大單一個股（不含 2330）", pct(K.max_name, 1, false), "上限 10%"],
    ["sec", `實現績效（${R.days || 0} 個交易日）`],
    ["年化波動度", R.vol_ann != null ? pct(R.vol_ann, 1, false) : "—", R.vol_ann != null ? "" : need(5)],
    ["Sharpe 比率", num(R.sharpe), R.sharpe != null ? "無風險利率以 0 計" : need(5)],
    ["資訊比率", num(R.ir), R.ir != null ? "超額報酬 / 追蹤誤差" : need(5)],
    ["勝過加權的天數比例", R.days ? pct(R.hit, 0, false) : "—", ""],
    ["最佳 / 最差單日", R.days ? `${pct(R.best)} / ${pct(R.worst)}` : "—", ""],
  ];
  $("risk").replaceChildren(...rows.map((r) => r[0] === "sec"
    ? h("tr", { class: "sec" }, h("td", { colspan: 3 }, r[1]))
    : h("tr", {}, h("td", {}, r[0], r[2] ? h("div", { class: "note-m" }, r[2]) : null), h("td", {}, r[1]), h("td", { class: "note" }, r[2]))));
}

function renderAllocation() {
  const S = D.sleeves || {}, names = D.sleeve_names || {};
  const parts = ["core", "satellite", "defensive", "?"].filter((k) => S[k] > 0).map((k) => [k, S[k], names[k] || k]);
  parts.push(["cash", Math.max(0, D.cash_weight), "現金"]);
  const bar = $("sleeves");
  bar.replaceChildren(...parts.map(([k, v, n]) => {
    const seg = h("div", { class: "seg" + (k === "cash" || k === "?" ? " dark" : ""), style: `flex:${v} 1 0;background:${SLEEVE_COLOR[k]}`, tabindex: 0 },
      v >= 0.09 ? `${n} ${pct(v, 0, false)}` : "");
    const t = (ev) => showTip(ev, n, [["占淨值", pct(v, 1, false), null]]);
    seg.addEventListener("pointermove", t); seg.addEventListener("pointerleave", hideTip);
    return seg;
  }));
  const ai = (S.core || 0) + (S.satellite || 0);
  bar.append(h("div", { class: "mark", style: "left:60%", title: "AI 部位下限 60%" }));
  legend($("sleeve-legend"), [...parts.map(([k, v, n]) => [`${n} ${pct(v, 1, false)}`, SLEEVE_COLOR[k], true]), ["虛線：AI 下限 60%（目前 " + pct(ai, 1, false) + "）", "transparent", false]]);
  const seg = Object.entries(D.segments || {});
  const max = Math.max(0.32, ...seg.map(([, v]) => v));
  $("segments").replaceChildren(...seg.map(([n, v]) => h("div", { class: "hbar" },
    h("span", { class: "name", title: n }, n),
    h("div", { class: "track" }, h("div", { class: "fill", style: `width:${v / max * 100}%` }), h("div", { class: "cap", style: `left:${0.3 / max * 100}%` })),
    h("span", { class: "v" }, pct(v, 1, false)))));
}

function renderContrib() {
  const rows = (D.holdings || []).filter((r) => ok(r.contrib));
  const pos = rows.filter((r) => r.contrib > 0).sort((a, b) => b.contrib - a.contrib).slice(0, 8);
  const neg = rows.filter((r) => r.contrib < 0).sort((a, b) => a.contrib - b.contrib).slice(0, 8);
  const max = Math.max(1e-6, ...rows.map((r) => Math.abs(r.contrib)));
  const bar = (r) => {
    const el = h("div", { class: "cbar", tabindex: 0 },
      h("span", { class: "name" }, `${r.ticker} ${r.name}`),
      h("div", { class: "track" }, h("div", { class: "fill", style: `width:${Math.abs(r.contrib) / max * 100}%;background:var(--${r.contrib > 0 ? "up" : "down"})` })),
      h("span", { class: "v" }, (r.contrib > 0 ? "+" : "−") + F1.format(Math.abs(r.contrib * 1e4))));
    el.addEventListener("pointermove", (ev) => showTip(ev, `${r.ticker} ${r.name}`, [["貢獻", F1.format(r.contrib * 1e4) + " bp", null], ["損益", money(r.pnl), null], ["漲跌", pct(r.chg), null]]));
    el.addEventListener("pointerleave", hideTip);
    return el;
  };
  const fees = ok(D.fees_today) && D.fees_today > 0 ? h("p", { class: "muted small", style: "margin-top:8px" }, `另：手續費與交易稅 −${F1.format(D.fees_today / D.start_nav * 1e4)} bp`) : null;
  $("contrib").replaceChildren(rows.length ? h("div", { class: "contrib" },
    h("div", {}, h("h3", {}, "正貢獻"), pos.length ? pos.map(bar) : h("p", { class: "muted small" }, "無")),
    h("div", {}, h("h3", {}, "負貢獻"), neg.length ? neg.map(bar) : h("p", { class: "muted small" }, "無"))) : h("p", { class: "muted" }, "尚無資料"), fees);
}

// holdings table: column groups ------------------------------------------------------------------------
const COLS = {
  overview: [
    ["weight", "權重", (r) => pct(r.weight, 2, false)],
    ["last", "現價", (r) => num(r.last, r.last >= 1000 ? 0 : 2)],
    ["chg", "漲跌", (r) => signed(r.chg, (x) => pct(x))],
    ["contrib", "今日貢獻 bp", (r) => signed(r.contrib, (x) => F1.format(Math.abs(x * 1e4)))],
    ["pnl", "今日損益", (r) => signed(r.pnl, (x) => money(Math.abs(x)))],
    ["shares", "持股（張）", (r) => F0.format(r.shares / 1000)],
    ["trade", "今日交易", (r) => r.buy || r.sell ? h("span", { class: "trade" }, `${r.buy ? "買" : "賣"} ${F0.format((r.buy || r.sell) / 1000)} 張 @ ${num(r.vwap)}`) : "", (r) => (r.buy || 0) - (r.sell || 0)],
  ],
  technical: [
    ["r5", "5 日", (r) => signed(r.r5, (x) => pct(x, 1))],
    ["r20", "20 日", (r) => signed(r.r20, (x) => pct(x, 1))],
    ["r60", "60 日", (r) => signed(r.r60, (x) => pct(x, 1))],
    ["rsi14", "RSI 14", (r) => num(r.rsi14, 0)],
    ["ma20", "距 MA20", (r) => pct(r.ma20, 1)],
    ["ma60", "距 MA60", (r) => pct(r.ma60, 1)],
    ["hi52", "距 52 週高", (r) => pct(r.hi52, 1)],
    ["vol20", "20 日波動", (r) => pct(r.vol20, 0, false)],
    ["beta", "Beta 加權", (r) => num(r.beta)],
    ["beta_sox", "Beta 費半", (r) => num(r.beta_sox)],
  ],
  flows: [
    ["foreign5", "外資 5 日（張）", (r) => signed(r.foreign5, (x) => F0.format(Math.abs(x)))],
    ["trust5", "投信 5 日（張）", (r) => signed(r.trust5, (x) => F0.format(Math.abs(x)))],
    ["weight", "權重", (r) => pct(r.weight, 2, false)],
    ["chg", "漲跌", (r) => signed(r.chg, (x) => pct(x))],
  ],
  fundamental: [
    ["per", "本益比", (r) => num(r.per, 1)],
    ["pbr", "股價淨值比", (r) => num(r.pbr, 2)],
    ["yield", "殖利率", (r) => ok(r.yield) ? F2.format(r.yield) + "%" : "—"],
    ["rev_yoy", "月營收 YoY", (r) => signed(ok(r.rev_yoy) ? r.rev_yoy / 100 : null, (x) => pct(x, 1))],
    ["segment_zh", "次產業", (r) => r.segment_zh || "—"],
  ],
};
const GROUPS = [["overview", "概覽"], ["technical", "技術面"], ["flows", "籌碼面"], ["fundamental", "基本面"]];

function renderHoldings() {
  $("groups").replaceChildren(...GROUPS.map(([k, n]) => h("button", {
    class: "chip", role: "tab", type: "button", "aria-selected": String(k === group),
    onclick: () => { group = k; renderHoldings(); },
  }, n)));
  const cols = COLS[group];
  const val = (r, c) => c[3] ? c[3](r) : r[c[0]];
  const rows = [...(D.holdings || [])].sort((a, b) => {
    if (sortKey === "ticker") return sortDir * a.ticker.localeCompare(b.ticker);
    const c = cols.find((c) => c[0] === sortKey);
    const va = c ? val(a, c) : a[sortKey], vb = c ? val(b, c) : b[sortKey];
    if (typeof va === "string" || typeof vb === "string") return sortDir * String(va ?? "").localeCompare(String(vb ?? ""));
    return sortDir * ((ok(va) ? va : -Infinity) - (ok(vb) ? vb : -Infinity));
  });
  const th = (key, label, isNum) => h("th", {
    class: isNum ? "n" : "", "aria-sort": sortKey === key ? (sortDir < 0 ? "descending" : "ascending") : null, scope: "col",
    onclick: () => { if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = key === "ticker" || key === "segment_zh" ? 1 : -1; } renderHoldings(); },
  }, label);
  const why = (D.today_plan || {}).why || {};
  const body = [];
  for (const r of rows) {
    const sold = r.shares === 0;
    body.push(h("tr", { class: "row", style: sold ? "opacity:.6" : "", onclick: () => { opened.has(r.ticker) ? opened.delete(r.ticker) : opened.add(r.ticker); renderHoldings(); } },
      h("td", {}, h("div", { class: "tk" }, h("i", { class: "key-box", style: `background:${SLEEVE_COLOR[r.sleeve] || SLEEVE_COLOR["?"]}`, title: (D.sleeve_names || {})[r.sleeve] || "" }),
        h("b", {}, r.ticker), r.name, sold ? h("small", {}, "已出清") : null)),
      ...cols.map((c) => h("td", { class: c[0] === "segment_zh" || c[0] === "trade" ? "" : "n" }, c[2](r)))));
    if (opened.has(r.ticker)) body.push(h("tr", { class: "why" }, h("td", { colspan: cols.length + 1 },
      why[r.ticker] ? `${(D.today_plan.actions || {})[r.ticker]?.action || ""} · ${why[r.ticker]}` : "今日 D-Plan 未調整此檔（沿用既有部位）。")));
  }
  $("holdings").replaceChildren(
    h("thead", {}, h("tr", {}, th("ticker", "股票"), ...cols.map((c) => th(c[0], c[1], c[0] !== "segment_zh" && c[0] !== "trade")))),
    h("tbody", {}, body));
  const n = (D.holdings || []).filter((r) => r.shares > 0).length;
  $("hold-count").textContent = `${n} 檔`;
}

function renderChecks() {
  $("checks").replaceChildren(...(D.checks || []).map((c) => h("li", {},
    h("span", { class: "ic " + (c.ok == null ? "na" : c.ok ? "ok" : "bad") }, c.ok == null ? "–" : c.ok ? "✓" : "✗"),
    h("span", {}, c.rule, c.ok === false ? h("span", { class: "bad small" }, "　未通過") : null),
    h("span", { class: "val" }, c.value))));
  const as = Object.entries(D.active_share || {}).sort((a, b) => a[1] - b[1]);
  $("as-details").hidden = !as.length;
  $("as-list").replaceChildren(...as.map(([e, v]) => h("span", {}, h("b", {}, e), pct(v, 1, false))));
  const w = D.official_warnings || [];
  $("warnings").replaceChildren(w.length
    ? h("div", { class: "banner", style: "margin-top:12px" }, `官方警告 ${w.length} 次：`, ...w.map((x) => h("div", { class: "small" }, `${x.date} ${x.message || x.check}`)))
    : h("p", { class: "muted small", style: "margin-top:10px" }, "初賽期間官方警告：0 次"));
}

function renderMarket() {
  $("market").replaceChildren(...(D.market || []).map((m) => h("div", { class: "m" },
    h("div", { class: "label" }, m.label),
    h("div", { class: "v" }, num(m.value, m.value >= 1000 ? 0 : m.value >= 100 ? 1 : 2)),
    h("div", { class: "c" }, signed(m.chg, (x) => pct(x))),
    h("div", { class: "dt" }, m.live ? "即時" : m.date || ""))));
}

function renderView() {
  const p = D.today_plan;
  const ZH = { neutral: "中性", risk_on: "偏多", risk_off: "偏空", bull: "多頭", bear: "空頭", defensive: "防禦", aggressive: "積極", balanced: "平衡", increase: "加碼", reduce: "減碼", hold: "持平" };
  const z = (x) => ZH[x] || x || "—";
  $("view-card").hidden = !p;
  if (p) {
    $("badges").replaceChildren(
      h("span", { class: "badge" }, "交易日 ", h("b", {}, p.trade_date)),
      h("span", { class: "badge" }, "市場狀態 ", h("b", {}, z(p.regime))),
      h("span", { class: "badge" }, "操作立場 ", h("b", {}, z(p.stance))),
      h("span", { class: "badge" }, "部位方向 ", h("b", {}, z(p.posture))),
      p.cash_range ? h("span", { class: "badge" }, "目標現金 ", h("b", {}, p.cash_range.map((x) => pct(x, 0, false)).join("–"))) : null,
      h("span", { class: "badge" }, "委託 ", h("b", {}, `買 ${p.orders.BUY} / 賣 ${p.orders.SELL}`)));
    $("logic").textContent = p.logic || "—";
    $("counter").textContent = p.counter || "—";
    $("meta").textContent = `模型 ${p.model || "—"} · 工具呼叫 ${p.tool_calls ?? "—"} 次 · 全程由 Agent 自主決策`;
  }
  const q = D.pending_plan;
  $("pending").replaceChildren(q ? h("div", { class: "pending" },
    h("b", {}, `下一交易日 ${q.trade_date} 的 D-Plan 已完成：`),
    `${z(q.stance)}立場、${z(q.posture)}，委託 ${q.orders.BUY + q.orders.SELL} 筆。`,
    q.actions ? "" : "個股明細於開盤後公布。") : "");
}

function render() {
  renderHeader(); renderHero(); renderTiles(); renderCurve(); renderRisk();
  renderAllocation(); renderContrib(); renderHoldings(); renderChecks(); renderMarket(); renderView();
}

// --- data loop -----------------------------------------------------------------------------------------
async function load() {
  try {
    const r = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const changed = !D || d.generated_at !== D.generated_at;
    D = d;
    if (changed) render(); else renderHeader();
  } catch (e) {
    if (!D) $("phase").textContent = "資料載入失敗";
  }
}

// theme toggle: OS default, the button pins the opposite
const savedTheme = (() => { try { return localStorage.getItem("fund-theme"); } catch { return null; } })();
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("theme").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("fund-theme", document.documentElement.dataset.theme); } catch { /* private mode */ }
});

let rt;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => D && (renderHero(), renderCurve()), 150); });
load();
setInterval(load, POLL_MS);
