"use strict";

const STORAGE_KEY = "tcg-token-state-v1";

// 行定義: key=状態キー, start=この行の先頭番号(通し), max=この行の最大値
const ROWS = [
  { id: "alpha", label: "魔力α", key: "alpha", symbol: "tk-alpha", offset: 0, size: 5 },
  { id: "beta", label: "魔力β", key: "beta", symbol: "tk-beta", offset: 0, size: 5 },
  { id: "omega", label: "魔力Ω", key: "omega", symbol: "tk-omega", offset: 0, size: 5 },
  { id: "vol1", label: "VOL", key: "vol", symbol: "tk-vol", offset: 0, size: 5, vol: true },
  { id: "vol2", label: "VOL", key: "vol", symbol: "tk-vol", offset: 5, size: 5, vol: true },
];
const MAX = { alpha: 5, beta: 5, omega: 5, vol: 10 };

const initialState = () => ({ alpha: 0, beta: 0, omega: 0, vol: 0, limitedUsed: false, noiseStopper: false });

let state = load();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const s = initialState();
    if (raw && typeof raw === "object") {
      for (const k of Object.keys(MAX)) {
        const v = Number(raw[k]);
        if (Number.isInteger(v) && v >= 0 && v <= MAX[k]) s[k] = v;
      }
      s.limitedUsed = raw.limitedUsed === true;
      s.noiseStopper = raw.noiseStopper === true;
    }
    return s;
  } catch {
    return initialState();
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* 保存不可でも動作継続 */ }
}

const $ = (id) => document.getElementById(id);
const tokensEl = $("tokens");
const rowEls = {}; // id -> { buttons: [button...] }
const panelEls = {}; // key -> { el, body }

/* ---------- 描画 ---------- */
// 魔力α/β/Ω/VOL をそれぞれ1つの枠にまとめる(VOLは2行でも枠は1つ)
function groupPanel(row) {
  if (panelEls[row.key]) return panelEls[row.key].body;

  const el = document.createElement("div");
  el.className = "panel group" + (row.vol ? " vol" : "");

  const label = document.createElement("div");
  label.className = "group-label";
  // ギリシャ文字は日本語フォントだと字形が崩れる(Ω→и)ため、欧文フォントで描画する
  label.replaceChildren(...row.label.split(/([αβΩ])/).filter(Boolean).map((t) => {
    if (!/[αβΩ]/.test(t)) return t;
    const s = document.createElement("span");
    s.className = "greek";
    s.textContent = t;
    return s;
  }));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "row-reset";
  reset.textContent = "リセット";
  reset.setAttribute("aria-label", `${row.label}を0にする`);
  reset.addEventListener("click", () => setCount(row.key, 0));

  const body = document.createElement("div");
  body.className = "group-body";
  // 名称の下にリセットボタンを縦に並べる
  const side = document.createElement("div");
  side.className = "group-side";
  side.append(label, reset);
  el.append(side, body);
  tokensEl.append(el);
  panelEls[row.key] = { el, body };
  return body;
}

function buildTokens() {
  for (const row of ROWS) {
    const body = groupPanel(row);

    const grid = document.createElement("div");
    grid.className = "row-tokens";
    const buttons = [];
    for (let i = 1; i <= row.size; i++) {
      const n = row.offset + i;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "token";
      b.setAttribute("aria-label", `${row.label} ${n}`);
      b.dataset.kind = row.key;
      b.dataset.n = n;
      if (n >= 10) b.dataset.two = "";
      b.innerHTML =
        `<span class="img"><svg aria-hidden="true"><use href="#${row.symbol}"/></svg>` +
        `<span class="num">${n}</span>` +
        (row.vol ? `<svg class="lock" aria-hidden="true"><use href="#ic-lock"/></svg>` : "") + "</span>";
      b.addEventListener("click", () => setCount(row.key, n));
      grid.append(b);
      buttons.push(b);
    }
    body.append(grid);
    rowEls[row.id] = { buttons };
  }
}

function render() {
  for (const row of ROWS) {
    const cur = state[row.key];
    rowEls[row.id].buttons.forEach((b, i) => {
      const n = row.offset + i + 1;
      const on = n <= cur;
      b.classList.toggle("off", !on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  panelEls.vol.el.classList.toggle("noise-on", state.noiseStopper);

  const noise = $("noise");
  noise.setAttribute("aria-pressed", String(state.noiseStopper));
  noise.querySelector(".noise-state").textContent = state.noiseStopper ? "ON" : "OFF";

  $("limited").setAttribute("aria-pressed", String(state.limitedUsed));
}

/* ---------- 操作 ---------- */
function setCount(key, n) {
  if (key === "vol" && state.noiseStopper && n > state.vol) {
    navigator.vibrate?.(30);
    return; // ノイズストッパーON中はVOL増加を無効化
  }
  state[key] = n;
  save();
  render();
}

$("noise").addEventListener("click", () => {
  state.noiseStopper = !state.noiseStopper;
  save();
  render();
});

$("limited").addEventListener("click", () => {
  state.limitedUsed = !state.limitedUsed;
  save();
  render();
});

/* ---------- 全体リセット + Undo ---------- */
const UNDO_MS = 5000;
const undoBtn = $("undo");
const undoCount = $("undoCount");
const undoNum = $("undoNum");
let undoSnapshot = null;
let undoDeadline = 0;
let undoTimer = null;

// 確認なしでワンタップ即リセット。上部に「元に戻す」と残り秒数を一定時間表示する
$("resetAll").addEventListener("click", () => {
  // 連続タップ時は、リセット済みの状態を上書きしないよう最初のスナップショットを保持
  if (!undoSnapshot) undoSnapshot = { ...state };
  state = initialState();
  save();
  render();
  startUndoWindow();
});

function startUndoWindow() {
  undoDeadline = performance.now() + UNDO_MS;
  // 円弧の縮むアニメーションを頭からやり直す
  undoCount.hidden = false;
  undoCount.style.setProperty("--undo-ms", `${UNDO_MS}ms`);
  undoCount.classList.remove("run");
  void undoCount.offsetWidth;
  undoCount.classList.add("run");
  clearInterval(undoTimer);
  undoTimer = setInterval(tickUndo, 200);
  tickUndo();
}

function tickUndo() {
  const remain = Math.ceil((undoDeadline - performance.now()) / 1000);
  if (remain <= 0) { endUndoWindow(); return; }
  undoNum.textContent = remain;
  undoCount.hidden = false;
  undoBtn.hidden = false;
}

function endUndoWindow() {
  clearInterval(undoTimer);
  undoSnapshot = null;
  undoNum.textContent = "";
  undoCount.classList.remove("run");
  undoCount.hidden = true;
  undoBtn.hidden = true;
}

undoBtn.addEventListener("click", () => {
  if (undoSnapshot) {
    state = undoSnapshot;
    save();
    render();
  }
  endUndoWindow();
});

/* ---------- ダイス ---------- */
const diceResult = $("diceResult");
const diceTotal = $("diceTotal");
const diceBtns = $("diceBtns");
const ROLL_BASE_MS = 500;   // 最初のダイスが止まるまで
const ROLL_STAGGER_MS = 80; // 以降のダイスを順にずらす
const ROLL_TICK_MS = 50;
let rollToken = 0;

for (let n = 1; n <= 5; n++) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn";
  b.textContent = n;
  b.setAttribute("aria-label", `ダイスを${n}個振る`);
  b.addEventListener("click", () => roll(n));
  diceBtns.append(b);
}

const rand6 = () => 1 + Math.floor(Math.random() * 6);

function roll(count) {
  const token = ++rollToken; // 演出中の再タップは前回を打ち切って振り直す
  diceResult.replaceChildren();
  diceTotal.textContent = "";

  const finals = Array.from({ length: count }, rand6);
  const els = finals.map(() => {
    const d = document.createElement("div");
    d.className = "die rolling";
    d.textContent = rand6();
    diceResult.append(d);
    return d;
  });

  const start = performance.now();
  const stopAt = els.map((_, i) => ROLL_BASE_MS + i * ROLL_STAGGER_MS);
  const settled = new Array(count).fill(false);

  const timer = setInterval(() => {
    if (token !== rollToken) { clearInterval(timer); return; }
    const t = performance.now() - start;
    let done = 0;
    els.forEach((d, i) => {
      if (settled[i]) { done++; return; }
      if (t >= stopAt[i]) {
        settled[i] = true;
        d.textContent = finals[i];
        d.classList.remove("rolling");
        d.classList.add("pop");
        navigator.vibrate?.(15);
        done++;
      } else {
        d.textContent = rand6();
      }
    });
    if (done === count) {
      clearInterval(timer);
      if (count > 1) diceTotal.textContent = `合計 ${finals.reduce((a, b) => a + b, 0)}`;
    }
  }, ROLL_TICK_MS);
}

/* ---------- 配色切替(ダーク / ブライト) ---------- */
const THEME_KEY = "tcg-token-theme";
const THEME_COLORS = { dark: "#080b14", bright: "#e4ddd0" };
const themeBtns = document.querySelectorAll(".theme-switch button");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // 選択中の配色を強調表示する
  themeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.theme === theme)));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}
themeBtns.forEach((b) => b.addEventListener("click", () => {
  applyTheme(b.dataset.theme);
  try { localStorage.setItem(THEME_KEY, b.dataset.theme); } catch { /* 保存不可でも動作継続 */ }
}));
applyTheme(document.documentElement.dataset.theme === "bright" ? "bright" : "dark");

/* ---------- Wake Lock(画面スリープ防止) ---------- */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch { /* 非対応・拒否時は無視 */ }
}
document.addEventListener("visibilitychange", requestWakeLock);
document.addEventListener("pointerdown", () => { if (!wakeLock || wakeLock.released) requestWakeLock(); }, { passive: true });

/* ---------- PWA ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

buildTokens();
render();
requestWakeLock();
