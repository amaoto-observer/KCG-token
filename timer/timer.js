"use strict";
/* =====================================================================
   タイマー版: 試合時間・ターン(先攻/後攻それぞれで数える)・対戦情報
   - 時刻はすべて Date.now() の差で計算する(画面を閉じても・裏に回っても正しく進む)
   - 表示は MM:SS の 2 桁ずつ。99:59 の次は 00:00 に戻る
   - 「全てリセット」後も「元に戻す」が可能な間は、元のタイマーは裏で進み続ける
     (リセット前の状態をそのまま保持し、元に戻すとその時点の経過時間で復帰する)
   ===================================================================== */
(() => {
  const MATCH_KEY = "tcg-timer-match-v1";
  const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  const ICON = {
    pause: '<svg class="tm-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg class="tm-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>',
    swap: '<svg class="tm-ico" viewBox="0 0 24 24" aria-hidden="true" style="fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg>',
    person: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="5.5" r="3"/><path d="M2.5 14.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/></svg>',
  };

  /* ---------- 状態 ----------
     t.status: "idle"(開始前) | "running"(計測中) | "paused"(一時停止中)
     t.side: 今のターンの手番(1=先攻, 2=後攻)、t.n: その手番の何ターン目か
     t.laps: 終わったターン [{ side, n, ms }]、t.acc: 今のターンの一時停止までの累計、t.since: 計測を再開した時刻
     info: 対戦情報。名前・デッキ名は「自分/相手」に結びつける(先後を入れ替えても入れ替わって表示される) */
  const idleTimer = () => ({ status: "idle", startedAt: 0, side: 1, n: 1, laps: [], acc: 0, since: 0 });
  const emptyInfo = (myDeck = "") => ({ seat: 0, myDeck, oppDeck: "", oppName: "" });
  let { t, info } = load();
  let undoSnap = null;

  function load() {
    const d = { t: idleTimer(), info: emptyInfo() };
    try {
      const raw = JSON.parse(localStorage.getItem(MATCH_KEY));
      if (raw && raw.t && ["idle", "running", "paused"].includes(raw.t.status)) {
        const r = raw.t;
        d.t = { status: r.status, startedAt: +r.startedAt || 0, side: r.side === 2 ? 2 : 1, n: Math.max(1, +r.n || 1),
          laps: Array.isArray(r.laps) ? r.laps.filter((l) => l && (l.side === 1 || l.side === 2) && +l.n >= 1 && +l.ms >= 0).map((l) => ({ side: l.side, n: +l.n, ms: +l.ms })) : [],
          acc: Math.max(0, +r.acc || 0), since: +r.since || 0 };
        if (d.t.status === "running" && !d.t.since) d.t.status = "paused";
      }
      if (raw && raw.info) {
        const i = raw.info, str = (v) => (typeof v === "string" ? v.slice(0, 40) : "");
        d.info = { seat: i.seat === 1 || i.seat === 2 ? i.seat : 0, myDeck: str(i.myDeck), oppDeck: str(i.oppDeck), oppName: str(i.oppName) };
      }
    } catch { /* 読めなければ初期状態 */ }
    return d;
  }
  function save() {
    try { localStorage.setItem(MATCH_KEY, JSON.stringify({ t, info })); } catch { /* 保存不可でも動作継続 */ }
  }

  /* ---------- 時間の計算と表示 ---------- */
  const curMs = () => (t.status === "idle" ? 0 : t.acc + (t.status === "running" ? Math.max(0, Date.now() - t.since) : 0));
  const sideMs = (side) => t.laps.reduce((s, l) => s + (l.side === side ? l.ms : 0), 0) + (t.status !== "idle" && t.side === side ? curMs() : 0);
  const matchMs = () => sideMs(1) + sideMs(2);
  const sideTurns = (side) => t.laps.filter((l) => l.side === side).length + (t.status !== "idle" && t.side === side ? 1 : 0);
  // MM:SS(2 桁ずつ、十の位も 0 で埋める)。100 分で 00:00 に戻る
  const fmt = (ms) => { const s = Math.floor(ms / 1000) % 6000; return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
  // 1 文字ずつ固定幅の枠に入れる(数字が変わっても位置が動かない)。変化したときだけ書き換える
  const setTime = (el, ms) => {
    const s = fmt(ms);
    if (el._v === s) return;
    el._v = s;
    el.innerHTML = [...s].map((c) => (c === ":" ? '<i class="c">:</i>' : `<i>${c}</i>`)).join("");
  };
  const sideName = (side) => (side === 1 ? "先攻" : "後攻");
  const who = (side, n) => `<span class="p${side}">${sideName(side)} ${n}T</span>`;
  const stat = () => (t.status === "idle" ? '<span class="tm-stat">開始前</span>'
    : t.status === "paused" ? `<span class="tm-stat">${ICON.pause}一時停止中</span>` : '<span class="tm-stat"><span class="tm-dot"></span>計測中</span>');
  const nowTag = () => `<span class="now-tag">${t.status === "paused" ? "‖ 一時停止中" : "● 計測中"}</span>`;

  /* ---------- 標準タイマー ---------- */
  const main = $("tmMain"), pauseBtn = $("tmPause");
  // 装飾(テーマごとに片方だけ表示)。ダークのグリッチ用に回路の複製(水色・桃色)を 2 枚重ねる
  main.insertAdjacentHTML("afterbegin", DECO_BRIGHT + DECO_DARK_TAIL + DECO_DARK_GLOW);
  const glow = main.querySelector(".rays.deco-d.glow");
  ["m", "c"].forEach((k) => { const g = glow.cloneNode(true); g.classList.remove("glow"); g.classList.add("ghost", "ghost-" + k); glow.after(g); });

  let lastKey = "";
  function renderMain() {
    root.classList.toggle("idle", t.status === "idle");
    root.classList.toggle("paused", t.status === "paused");
    main.classList.toggle("side2", t.side === 2);
    const key = `${t.status}|${t.side}|${t.n}`;
    if (key !== lastKey) {
      lastKey = key;
      main.querySelector(".tm-mark").innerHTML = t.status === "paused" ? ICON.pause : '<span class="tm-dot"></span>';
      $("tmWho").innerHTML = who(t.side, t.n);
      $("tmHint").innerHTML = t.status === "idle" ? `${ICON.play}タップで開始` : `${ICON.swap}タップで交代`;
      $("tmPauseLabel").textContent = t.status === "paused" ? "再開" : "一時停止";
      pauseBtn.setAttribute("aria-label", t.status === "paused" ? "再開" : "一時停止");
      main.setAttribute("aria-label", t.status === "idle" ? "タイマーを開始" : t.status === "paused" ? "一時停止中" : `${sideName(t.side)}のターンを終えて交代`);
    }
    setTime($("tmMatch"), matchMs());
    setTime($("tmCur"), curMs());
  }

  // 開始・交代・再開のときだけの演出(ダーク: グリッチ→尾が伸びる / ブライト: 花びらが舞い降りる)
  function playFx() {
    main.classList.remove("fx-play");
    void main.offsetWidth;
    main.classList.add("fx-play");
  }

  main.addEventListener("click", () => {
    const now = Date.now();
    if (t.status === "idle") {
      t = { status: "running", startedAt: now, side: 1, n: 1, laps: [], acc: 0, since: now };
      playFx();
      navigator.vibrate?.(15);
    } else if (t.status === "running") {
      t.laps.push({ side: t.side, n: t.n, ms: curMs() });
      if (t.side === 1) t.side = 2; else { t.side = 1; t.n++; }
      t.acc = 0; t.since = now;
      playFx();
      navigator.vibrate?.(15);
    } else {
      navigator.vibrate?.(30); // 一時停止中は交代できない
      return;
    }
    save(); renderAll();
  });

  pauseBtn.addEventListener("click", () => {
    const now = Date.now();
    if (t.status === "running") { t.acc += Math.max(0, now - t.since); t.status = "paused"; }
    else if (t.status === "paused") { t.since = now; t.status = "running"; playFx(); }
    else return;
    save(); renderAll();
  });

  /* ---------- タイマー詳細 ---------- */
  const detail = $("detail");
  const cards = { 1: $("ddCard1"), 2: $("ddCard2") };
  for (const s of [1, 2]) {
    cards[s].innerHTML = `<div class="dd-top"><span class="lbl p${s}">${sideName(s)}</span><span class="dd-tot"><span class="cnt"></span>ターン合計 <span class="tm-time"></span></span></div>
      <div class="dd-line">${ICON.person}<span class="dd-self">あなた</span><input class="dd-input" data-k="name" type="text" maxlength="40" enterkeyhint="done" autocomplete="off"></div>
      <div class="dd-line"><span class="dd-k">デッキ</span><input class="dd-input" data-k="deck" type="text" maxlength="40" enterkeyhint="done" autocomplete="off"></div>`;
    cards[s].querySelectorAll(".dd-input").forEach((inp) => {
      inp.addEventListener("input", () => {
        if (!info.seat) return;
        const mine = info.seat === s;
        if (inp.dataset.k === "name") { if (!mine) info.oppName = inp.value; }
        else if (mine) info.myDeck = inp.value; else info.oppDeck = inp.value;
        save();
      });
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    });
  }
  document.querySelectorAll(".dd-seg button").forEach((b) => b.addEventListener("click", () => {
    document.activeElement?.blur?.();
    info.seat = +b.dataset.seat;
    save(); renderInfo();
  }));

  // 対戦情報(入力欄の中身)は、先後の切替・リセット・元に戻す・画面を開いたときだけ書き換える(入力中に消えないように)
  function renderInfo() {
    const seat = info.seat;
    document.querySelectorAll(".dd-seg button").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.seat === seat)));
    $("ddNotice").hidden = seat !== 0;
    for (const s of [1, 2]) {
      const c = cards[s], mine = seat === s, name = c.querySelector('[data-k="name"]'), deck = c.querySelector('[data-k="deck"]');
      c.classList.toggle("off", seat === 0);
      c.querySelector(".dd-self").hidden = !mine;
      name.hidden = mine;
      name.disabled = deck.disabled = seat === 0;
      name.placeholder = seat === 0 ? "—" : "相手の名前を入力";
      deck.placeholder = seat === 0 ? "—" : "デッキ名を入力";
      name.value = seat === 0 || mine ? "" : info.oppName;
      deck.value = seat === 0 ? "" : mine ? info.myDeck : info.oppDeck;
    }
  }

  let turnsKey = "";
  function renderDetail() {
    if (detail.hidden) return;
    const d = t.startedAt ? new Date(t.startedAt) : null;
    $("ddStart").textContent = d ? `開始 ${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}(${WEEK[d.getDay()]}) ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "開始 —";
    setTime($("ddMatch"), matchMs());
    setTime($("ddCur"), curMs());
    const head = `${t.status}|${t.side}|${t.n}`;
    if ($("ddStat")._k !== head) { $("ddStat")._k = head; $("ddStat").innerHTML = stat(); $("ddWho").innerHTML = who(t.side, t.n); }
    for (const s of [1, 2]) {
      cards[s].querySelector(".cnt").textContent = sideTurns(s);
      setTime(cards[s].querySelector(".dd-tot .tm-time"), sideMs(s));
    }
    // ターンごとの記録: 構成が変わったときだけ作り直し、計測中の欄は毎回時間だけ更新
    const tl = $("ddTurns");
    const key = `${t.status}|${t.side}|${t.n}|${t.laps.length}`;
    if (key !== turnsKey) {
      turnsKey = key;
      if (t.status === "idle") {
        tl.innerHTML = '<div class="tl-empty">タイマーを開始すると、ここにターンごとの記録が並びます</div>';
      } else {
        const cell = (side, n) => {
          const lap = t.laps.find((l) => l.side === side && l.n === n), now = t.side === side && t.n === n;
          const time = lap || now ? `<span class="tm-time"${now ? ' id="ddNowLap"' : ""}></span>` : '<span class="tl-wait">—</span>';
          return `<div class="tl-row p${side}${now ? " now" : ""}"><span class="lbl p${side}">${sideName(side)}${now ? nowTag() : ""}</span>${time}</div>`;
        };
        let h = "";
        for (let n = t.n; n >= 1; n--) h += `<div class="tl-box"><span class="tl-n tm-sub">${n}T</span><div class="tl-rows">${cell(2, n)}${cell(1, n)}</div></div>`;
        tl.innerHTML = h;
        tl.querySelectorAll(".tl-row").forEach((row) => {
          const tm = row.querySelector(".tm-time");
          if (!tm || tm.id) return;
          const side = row.classList.contains("p1") ? 1 : 2, n = +row.closest(".tl-box").querySelector(".tl-n").textContent.replace("T", "");
          setTime(tm, t.laps.find((l) => l.side === side && l.n === n).ms);
        });
      }
    }
    const nowLap = $("ddNowLap");
    if (nowLap) setTime(nowLap, curMs());
  }

  $("openDetail").addEventListener("click", () => { detail.hidden = false; turnsKey = ""; $("ddStat")._k = ""; renderInfo(); renderDetail(); });
  $("closeDetail").addEventListener("click", () => { document.activeElement?.blur?.(); detail.hidden = true; });

  function renderAll() { renderMain(); renderDetail(); }

  /* ---------- 全てリセット / 元に戻す(app.js から呼ばれる) ---------- */
  window.TimerHooks = {
    // リセット: 元に戻せるよう、リセット前の状態(計測中なら開始時刻ごと)を保持する。
    // 保持している間も時刻の差で計算するので、元に戻した時点でその間の経過も含まれる
    reset() {
      undoSnap = JSON.parse(JSON.stringify({ t, info }));
      t = idleTimer();
      info = emptyInfo(info.myDeck); // 自分のデッキ名だけ残す
      save(); renderInfo(); renderAll();
    },
    undo() {
      if (!undoSnap) return;
      ({ t, info } = undoSnap);
      undoSnap = null;
      lastKey = ""; turnsKey = "";
      save(); renderInfo(); renderAll();
    },
    undoEnd() { undoSnap = null; },
  };

  renderInfo();
  renderAll();
  setInterval(renderAll, 200);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") renderAll(); });

  // 1 画面に収める: 端末の文字の高さや画面の大きさの違いで中身が下にはみ出す場合、はみ出さなくなるまでトークンを小さくする
  const appEl = document.getElementById("app");
  // まずボタン類の高さを少しずつ下げ、それでも収まらなければ余白を詰め(tight)、トークンを小さくする(小さくしても高さが減らなくなったら止める)
  // はみ出し量 = 最後の枠の下端 − (#app の下端 − 下の余白)。
  // Safari は scrollHeight に下の余白を含めないため、scrollHeight ではなく実際の位置で測る
  const over = () => {
    const last = appEl.lastElementChild;
    if (!last) return 0;
    const limit = appEl.getBoundingClientRect().bottom - parseFloat(getComputedStyle(appEl).paddingBottom);
    return Math.ceil(last.getBoundingClientRect().bottom - limit);
  };
  // iOS のホーム画面起動では、表示領域が画面より短く(下端がホームバーより上で切れ)、その下はページから描けない。
  // その場合は表示領域の下端がすでにホームバーを避けているので、下の安全領域ぶんの余白を取らない
  // 実機では、ページの高さ(innerHeight)よりさらに上で切れることがある(見える下端 = 画面の高さ − 上の安全領域)。
  // そのため見える高さは両者の小さいほうとし、ページ全体の高さをそれに合わせる
  const safeProbe = document.createElement("div");
  safeProbe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
  document.body.append(safeProbe);
  function fixGap() {
    const root = document.documentElement;
    const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    const portrait = window.innerHeight > window.innerWidth;
    const gap = standalone && portrait ? screen.height - window.innerHeight : 0;
    const short = gap >= 20;
    const safeTop = safeProbe.offsetHeight;
    const visH = short ? Math.min(window.innerHeight, screen.height - safeTop) : window.innerHeight;
    root.classList.toggle("short-vp", short);
    if (short) root.style.setProperty("--app-h", visH + "px"); else root.style.removeProperty("--app-h");
    // ボタンの高さなどの基準にする「画面の高さの 1%」を、実際に見える高さから決める
    root.style.setProperty("--vh", visH / 100 + "px");
    root.style.setProperty("--vh-full", visH / 100 + "px");
  }
  function fit() {
    fixGap();
    appEl.classList.remove("tight");
    appEl.style.removeProperty("--tk");
    if (over() <= 0) return;
    // はみ出す分だけ、ボタン類の高さの基準(--vh)をなめらかに下げる(各ボタンは下限で止まる)
    const root = document.documentElement, full = window.innerHeight / 100;
    const fitVh = () => {
      let lo = 3, hi = full;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        root.style.setProperty("--vh", mid + "px");
        if (over() <= 0) lo = mid; else hi = mid;
      }
      root.style.setProperty("--vh", lo + "px");
    };
    fitVh();
    if (over() <= 0) return;
    // それでも収まらないときだけ、余白を詰め(tight)、トークンを小さくする
    appEl.classList.add("tight");
    const img = appEl.querySelector(".token .img");
    if (!img) return;
    let size = Math.floor(img.getBoundingClientRect().width), best = size, bestOver = over();
    while (bestOver > 0 && size > 32) {
      size -= 1;
      appEl.style.setProperty("--tk", size + "px");
      const o = over();
      if (o < bestOver) { best = size; bestOver = o; } else if (size < best - 4) break;
    }
    appEl.style.setProperty("--tk", best + "px");
    fitVh(); // 詰めて余った高さはボタン類に戻す
  }
  let fitTimer = 0;
  const fitSoon = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 60); };
  fit();
  window.addEventListener("resize", fitSoon);
  window.addEventListener("orientationchange", fitSoon);
  window.addEventListener("load", fitSoon);
  if (window.visualViewport) visualViewport.addEventListener("resize", fitSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);
  // ホーム画面から起動した直後は画面の高さが一時的に違う値になり、resize が来ないことがあるため、大きさが変わったら測り直す
  let sizeKey = "";
  setInterval(() => {
    const k = `${window.innerWidth}x${window.innerHeight}x${appEl.clientHeight}`;
    if (k !== sizeKey) { sizeKey = k; fit(); }
  }, 500);
})();
