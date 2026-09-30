/* ui.js — واجهة DOM: HUD، النوافذ (بطاقات/اختيار/معلومة/فوز)، لوحة المعلّم، اللافتات. النص العربي كله هنا (RTL). */
(function (g) {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const reduced = g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fmt = s => g.Num.fmt(s);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const STAR = '<svg viewBox="0 0 24 24"><defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset="1" stop-color="#ffb000"/></linearGradient></defs><path d="M12 1.8l3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.5l-6.3 3.7 1.5-7.1L1.8 9.2l7.2-.8z" fill="url(#sg)" stroke="#c77700" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  const TYPES = {
    challenge: { label: "تحدي", color: "#f2b705", icon: "💡" },
    mystery: { label: "مفاجأة", color: "#8a4fd6", icon: "🎁" },
    team: { label: "مهمة جماعية", color: "#e862b5", icon: "👥" },
    choose: { label: "اختر طريقك", color: "#35b34a", icon: "🧭" },
    spot: { label: "اكتشف الخطأ", color: "#3b82f6", icon: "🔍" },
    hazard: { label: "منطقة خطر", color: "#e5432f", icon: "⚠️" },
    tool: { label: "أداة إنقاذ", color: "#19b5e6", icon: "🧰" },
    comeback: { label: "فرصة عودة", color: "#ff8a1c", icon: "🌪️" },
    battery: { label: "محطة البطارية", color: "#2fb6e0", icon: "🔋" },
    info: { label: "", color: "#f2b705", icon: "✨" }
  };

  const UI = { TYPES, reduced, sleep, fmt };
  let hud, teamEls = [], dicePanel, hudDie, rollCb = null, rollReady = false;
  let activeModal = null;     // { onEnter, onEsc }

  /* ---------------------------------------------------------------- HUD */
  UI.buildHud = function () {
    hud = $("#hud");
    const P = g.HUD_POS;
    hud.innerHTML = "";
    const names = ["الفريق الأول", "الفريق الثاني"];
    [0, 1].forEach(i => {
      const p = P["team" + i];
      const t = el("div", "tp " + (i === 0 ? "red" : "blue"));
      t.id = "tp" + i;
      Object.assign(t.style, { left: p.x + "px", top: p.y + "px", width: p.w + "px", height: p.h + "px" });
      t.innerHTML = `<div class="badge">🐾</div><div class="ttl">${names[i]}</div>
        <input class="nm" maxlength="18" aria-label="اسم ${names[i]}" placeholder="اكتبوا اسم الفريق">
        <div class="stars">${Array(5).fill('<div class="star">' + STAR + "</div>").join("")}</div>
        <div class="lvl">Level <b>1</b></div><div class="cnt">0</div>
        <div class="pw"><span>Rescue Power</span><div class="bar">${'<div class="seg"></div>'.repeat(5)}</div></div>
        <div class="extra"></div>`;
      hud.appendChild(t);
      teamEls.push({ root: t, name: $(".nm", t), stars: [...t.querySelectorAll(".star")], lvl: $(".lvl b", t), cnt: $(".cnt", t), segs: [...t.querySelectorAll(".seg")], extra: $(".extra", t) });
    });

    // لوحة النرد
    dicePanel = el("button", "wood"); dicePanel.id = "dicePanel"; dicePanel.setAttribute("aria-label", "ارمِ النرد (Space)");
    Object.assign(dicePanel.style, { left: "10px", top: "403px", width: "172px", height: "190px" });
    dicePanel.innerHTML = `<img class="bg" src="assets/panel_dice.png" alt="">
      <div id="hudDie" class="hide-qm">${'<i></i>'.repeat(9)}<div class="qm">؟</div></div>`;
    hud.appendChild(dicePanel);
    hudDie = $("#hudDie", dicePanel);
    dicePanel.addEventListener("click", () => { if (rollReady && rollCb) rollCb(); });

    // دور الفريق
    const turn = el("div", "wood"); turn.id = "turnPanel"; turn.style.cursor = "default";
    Object.assign(turn.style, { left: "10px", top: "587px", width: "172px", height: "142px" });
    turn.innerHTML = `<img class="bg" src="assets/panel_turn.png" alt=""><div id="turnPawns"><img id="tpawn0" src="assets/turn_red.png" style="left:28px" alt=""><img id="tpawn1" src="assets/turn_blue.png" style="left:86px" alt=""></div>`;
    hud.appendChild(turn);

    // بطاقات اللعبة
    const cards = el("button", "wood"); cards.id = "cardsPanel"; cards.setAttribute("aria-label", "بطاقات اللعبة");
    Object.assign(cards.style, { left: "10px", top: "723px", width: "172px", height: "186px" });
    cards.innerHTML = `<img class="bg" src="assets/panel_cards.png" alt=""><img id="deckImg" src="assets/cards_stack.png" alt="">`;
    hud.appendChild(cards);
    cards.addEventListener("click", () => { g.Sfx.click(); UI.msgToast("تُسحب بطاقة عند الوقوف على: تحدي 💡 مفاجأة 🎁 مهمة جماعية 👥 وغيرها", 3200); });

    // مراحل الإنقاذ: إطار توهج + حلقة الرقم
    g.STAGE_BOXES.forEach((b, i) => {
      const box = el("div", "stage-box"); box.id = "stagebox" + i;
      Object.assign(box.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
      const dot = el("div", "stage-dot"); dot.id = "stagedot" + i;
      Object.assign(dot.style, { left: b.cx + "px", top: b.cy + "px" });
      hud.append(box, dot);
    });
    UI.setStage(1, false);
  };

  UI.teamEl = i => teamEls[i];
  UI.names = () => teamEls.map(t => t.name.value.trim());
  UI.bindNames = (onChange) => teamEls.forEach((t, i) => t.name.addEventListener("input", () => onChange(i, t.name.value)));
  UI.setName = (i, v) => { teamEls[i].name.value = v; };
  UI.teamName = (i, def) => (teamEls[i].name.value.trim() || def || ["فريق الشعلة", "فريق البرق"][i]);

  UI.syncTeam = function (i, team, bump) {
    const t = teamEls[i], L = g.Logic;
    t.stars.forEach((s, k) => s.classList.toggle("on", k < Math.min(5, team.shards)));
    const lvl = L.levelOf(team.shards);
    t.lvl.textContent = g.Num.digits(lvl);
    t.cnt.textContent = g.Num.digits(team.shards);
    const inLevel = team.shards % L.CONFIG.shardsPerLevel;
    t.segs.forEach((s, k) => s.classList.toggle("on", k < inLevel));
    t.extra.innerHTML = "";
    team.tools.forEach(id => { const tl = g.CARDS.tools.find(x => x.id === id); if (tl) t.extra.appendChild(el("span", "chip", tl.icon)); });
    for (let k = 0; k < team.keys; k++) t.extra.appendChild(el("span", "chip", "🗝️"));
    if (bump && !reduced) { t.root.classList.remove("bump"); void t.root.offsetWidth; t.root.classList.add("bump"); }
  };
  UI.setActive = function (i) {
    teamEls.forEach((t, k) => t.root.classList.toggle("active", k === i));
    [0, 1].forEach(k => $("#tpawn" + k).classList.toggle("on", k === i));
    const p = $("#tpawn" + i);
    if (!reduced) g.gsap.fromTo(p, { y: 0 }, { y: -14, duration: .18, yoyo: true, repeat: 3, ease: "power2.out", onComplete: () => g.gsap.set(p, { y: 0 }) });
  };
  UI.setDie = function (v) {
    hudDie.classList.toggle("hide-qm", v != null);
    [...hudDie.querySelectorAll("i")].forEach((p, k) => p.classList.toggle("on", v != null && PIPS[v].includes(k)));
  };
  UI.dieRect = () => hudDie.getBoundingClientRect();
  UI.setRollReady = function (on, cb, hint) {
    rollReady = on; rollCb = on ? cb : null;
    dicePanel.classList.toggle("ready", on);
    const h = $("#rollHint");
    h.onclick = () => { if (rollReady && rollCb) rollCb(); };
    if (on) { h.textContent = hint || "اضغطوا على منطقة النرد أو مفتاح المسافة (Space) لرمي النرد 🎲"; h.classList.remove("hidden"); } else h.classList.add("hidden");
  };
  UI.setStage = function (n, animate = true) {
    g.STAGE_BOXES.forEach((_, i) => {
      $("#stagebox" + i).classList.toggle("on", i === n - 1);
      const d = $("#stagedot" + i); d.classList.toggle("on", i === n - 1); d.classList.toggle("done", i < n - 1);
    });
  };
  UI.deckRect = () => $("#deckImg").getBoundingClientRect();
  UI.teamRect = i => teamEls[i].root.getBoundingClientRect();
  UI.barRect = i => $(".pw", teamEls[i].root).getBoundingClientRect();

  /* ---------------------------------------------------------------- toasts */
  UI.roundToast = function (title, sub) {
    const layer = $("#toastLayer");
    const t = el("div", "round-toast", `<b>${fmt(title)}</b><span>${fmt(sub || "")}</span>`);
    layer.appendChild(t);
    g.Sfx.toast();
    const tl = g.gsap.timeline({ onComplete: () => t.remove() });
    tl.fromTo(t, { y: -80, scale: .5, opacity: 0, rotation: -4 }, { y: 0, scale: 1, opacity: 1, rotation: 0, duration: .45, ease: "back.out(2)" })
      .to(t, { rotation: reduced ? 0 : 2.5, duration: .07, yoyo: true, repeat: reduced ? 0 : 7, ease: "sine.inOut" })
      .to(t, { filter: "drop-shadow(0 0 26px rgba(255,214,60,.95))", duration: .4, yoyo: true, repeat: 1 }, "<")
      .to(t, { y: -40, opacity: 0, scale: .9, duration: .3, ease: "power2.in" }, "+=0.05");
    return new Promise(r => tl.eventCallback("onComplete", () => { t.remove(); r(); }));
  };
  UI.msgToast = function (text, ms = 1900) {
    const layer = $("#toastLayer");
    const t = el("div", "msg-toast", fmt(text)); layer.appendChild(t);
    g.gsap.fromTo(t, { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: .3, ease: "back.out(2)" });
    return new Promise(r => setTimeout(() => g.gsap.to(t, { opacity: 0, y: -20, duration: .3, onComplete: () => { t.remove(); r(); } }), ms));
  };

  /* ---------------------------------------------------------------- نوافذ عامة */
  function root() { return $("#modalRoot"); }
  function setKeys(h) { activeModal = h; }
  document.addEventListener("keydown", e => {
    if (!activeModal) return;
    if (e.key === "Enter") { e.preventDefault(); activeModal.onEnter && activeModal.onEnter(); }
    else if (e.key === "Escape") { e.preventDefault(); activeModal.onEsc && activeModal.onEsc(); }
  });

  function closeAnim(node, dur = .3) {
    return new Promise(res => g.gsap.to(node, { opacity: 0, scale: .92, duration: reduced ? .01 : dur, ease: "power2.in", onComplete: () => { node.remove(); res(); } }));
  }

  function makeTimer(sec, onEnd) {
    const C = 2 * Math.PI * 40;
    const w = el("div", "timer", `<svg viewBox="0 0 100 100"><circle class="t-bg" cx="50" cy="50" r="40" fill="none" stroke-width="10"/><circle class="t-fg" cx="50" cy="50" r="40" fill="none" stroke-width="10" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg><div class="t-num">${g.Num.digits(sec)}</div>`);
    const fg = $(".t-fg", w), num = $(".t-num", w);
    let iv = null, left = sec, t0 = 0;
    const api = {
      el: w, running: false,
      start() {
        if (api.running) return; api.running = true; t0 = performance.now(); left = sec;
        iv = setInterval(() => {
          const el_ = (performance.now() - t0) / 1000; left = Math.max(0, sec - el_);
          fg.style.strokeDashoffset = String(C * (1 - left / sec));
          num.textContent = g.Num.digits(Math.ceil(left));
          w.classList.toggle("low", left <= 5);
          if (left <= 5 && left > 0 && Math.ceil(left) !== api._lastBeep) { api._lastBeep = Math.ceil(left); g.Sfx.step(0); }
          if (left <= 0) { api.stop(); g.Sfx.wrong(); onEnd && onEnd(); }
        }, 100);
      },
      stop() { clearInterval(iv); api.running = false; }
    };
    return api;
  }

  /* ---------------------------------------------------------------- بطاقة سؤال */
  UI.showCard = function (o) {
    const card = o.card, T = TYPES[o.type || card.type] || TYPES.info;
    const color = o.color || T.color;
    const settings = o.settings || {};
    const auto = settings.mode === "auto" && card.answerNum != null && card.kind !== "numberline";
    return new Promise(resolve => {
      const back = el("div", "backdrop");
      const c3 = el("div", "card3d"); c3.style.setProperty("--cc", color);
      const face = el("div", "card-face");
      const tag = `<div class="card-tag">${o.tag || T.label}${o.teamName ? " · " + o.teamName : ""}</div>`;
      const ico = `<div class="card-ico">${o.icon || T.icon}</div>`;
      face.innerHTML = `${tag}${ico}<h2 class="card-title">${fmt(card.title)}</h2><p class="card-text">${fmt(card.text)}</p><div class="slot"></div>`;
      const slot = $(".slot", face);
      const bk = el("div", "card-back", "؟");
      c3.append(face, bk); back.appendChild(c3); root().appendChild(back);
      if (o.bonusText) face.insertBefore(el("div", "note", fmt(o.bonusText)), $(".slot", face));

      let done = false, revealed = false, timer = null;
      const timerSec = card.timer || settings.timer || 0;
      if (timerSec) {
        const box = el("div", "timer-wrap");
        timer = makeTimer(timerSec, () => { });
        box.appendChild(timer.el);
        const ctl = el("div", "timer-ctl");
        const go = el("button", "btn blue", "▶ ابدأ المؤقت"); go.style.minWidth = "0";
        go.onclick = () => { g.Sfx.click(); timer.start(); go.disabled = true; };
        ctl.appendChild(go); box.appendChild(ctl); face.insertBefore(box, slot);
        if (card.timer) setTimeout(() => { if (!done) { timer.start(); go.disabled = true; } }, 900);
      }

      const finish = async (correct) => {
        if (done) return; done = true; if (timer) timer.stop();
        slot.querySelectorAll("button").forEach(b => b.disabled = true);
        setKeys(null);
        const rect = c3.getBoundingClientRect();
        if (correct) {
          g.Sfx.correct();
          g.gsap.fromTo(face, { boxShadow: "0 0 0 0 rgba(63,191,79,.0)" }, { boxShadow: "0 0 0 18px rgba(63,191,79,.6), 0 0 80px 30px rgba(120,255,140,.7)", duration: .35, yoyo: true, repeat: 1 });
          await sleep(reduced ? 200 : 650);
        } else {
          g.Sfx.wrong();
          if (!reduced) c3.classList.add("shake");
          face.appendChild(el("div", "friendly", o.wrongText || "حاولوا في دوركم القادم! 💪"));
          await sleep(reduced ? 600 : 1250);
        }
        const r2 = c3.getBoundingClientRect();
        await closeAnim(back, .3);
        resolve({ correct, rect: r2.width ? r2 : rect });
      };

      const revealBox = () => {
        if (revealed) return; revealed = true; g.Sfx.reveal();
        const ab = el("div", "answer-box", `<small>الإجابة</small>${fmt(card.answer || "")}${card.explain ? `<small style="margin-top:.3em">${fmt(card.explain)}</small>` : ""}`);
        slot.insertBefore(ab, slot.firstChild);
      };

      const teacherButtons = () => {
        slot.innerHTML = "";
        const row = el("div", "btn-row");
        const rev = el("button", "btn blue", "👁 اكشف الإجابة");
        const ok = el("button", "btn good", "✔ صحيحة"), no = el("button", "btn bad", "✘ خاطئة");
        ok.hidden = no.hidden = true;
        rev.onclick = () => { g.Sfx.click(); revealBox(); rev.hidden = true; ok.hidden = no.hidden = false; ok.focus(); };
        ok.onclick = () => finish(true); no.onclick = () => finish(false);
        row.append(rev, ok, no); slot.appendChild(row);
        setKeys({ onEnter: () => revealed ? finish(true) : rev.click(), onEsc: () => revealed ? finish(false) : rev.click() });
        setTimeout(() => rev.focus(), 900);
      };

      const autoButtons = () => {
        const ch = g.Logic.makeChoices(card.answerNum);
        const box = el("div", "choices");
        ch.forEach(v => {
          const b = el("button", "choice", g.Num.digits(v));
          b.onclick = async () => {
            if (done) return; const ok = v === card.answerNum;
            b.classList.add(ok ? "ok" : "no");
            if (!ok) { box.querySelectorAll(".choice").forEach(x => { if (x.textContent === g.Num.digits(card.answerNum)) x.classList.add("ok"); }); }
            await sleep(450); finish(ok);
          };
          box.appendChild(b);
        });
        slot.appendChild(box); setKeys(null);
      };

      const numberLine = () => {
        const nl = card.nl, cells = [];
        const line = el("div", "nline");
        for (let n = 0; n <= nl.max; n++) { const c = el("div", "nl-n", `<span>${g.Num.digits(n)}</span>`); c.dataset.n = n; line.appendChild(c); cells.push(c); }
        const frog = el("div", "nl-frog", "🐸"); line.appendChild(frog);
        slot.appendChild(line);
        let cur = nl.from, jumps = 0;
        const place = () => { const c = cells[cur]; frog.style.left = (c.offsetLeft + c.offsetWidth / 2) + "px"; };
        cells[cur].classList.add("start");
        setTimeout(place, 950);
        cells.forEach(c => c.addEventListener("click", () => {
          if (done) return; const n = +c.dataset.n;
          if (n !== cur + 1) { g.Sfx.wrong(); g.gsap.fromTo(c, { x: -6 }, { x: 0, duration: .4, ease: "elastic.out(2,.3)" }); return; }
          const from = cells[cur], hop = el("div", "nl-hop");
          const a = from.offsetLeft + from.offsetWidth / 2, b = c.offsetLeft + c.offsetWidth / 2;
          hop.style.left = a + "px"; hop.style.width = (b - a) + "px"; line.appendChild(hop);
          cur = n; jumps++; c.classList.add("vis"); place(); g.Sfx.step(jumps);
          if (jumps >= nl.jumps) { revealBox(); setTimeout(() => finish(true), 900); }
        }));
        const row = el("div", "btn-row");
        const no = el("button", "btn bad", "✘ لم ننجح"); no.onclick = () => finish(false);
        row.appendChild(no); slot.appendChild(row);
        setKeys({ onEnter: () => { }, onEsc: () => { } });
      };

      if (card.kind === "numberline") numberLine(); else if (auto) autoButtons(); else teacherButtons();

      // حركة السحب من الحزمة + قلب 3D
      g.Sfx.flip();
      const dr = o.fromRect || UI.deckRect();
      const vw = g.innerWidth, vh = g.innerHeight;
      const dx = dr.left + dr.width / 2 - vw / 2, dy = dr.top + dr.height / 2 - vh / 2;
      g.gsap.set(c3, { transformPerspective: 1600 });
      g.gsap.fromTo(back, { opacity: 0 }, { opacity: 1, duration: .25 });
      if (reduced) { g.gsap.set(c3, { rotationY: 0 }); bk.style.display = "none"; }
      else {
        g.gsap.timeline()
          .fromTo(c3, { x: dx, y: dy, scale: .14, rotationY: 180 }, { x: 0, y: 0, scale: 1, duration: .55, ease: "power2.out" })
          .to(c3, { rotationY: 0, duration: .5, ease: "power2.inOut" }, "-=.05");
      }
    });
  };

  /* ---------------------------------------------------------------- اختر طريقك */
  UI.showChoose = function (teamName) {
    return new Promise(resolve => {
      const back = el("div", "backdrop");
      const c3 = el("div", "card3d"); c3.style.setProperty("--cc", TYPES.choose.color);
      const face = el("div", "card-face");
      face.innerHTML = `<div class="card-tag">اختر طريقك · ${teamName}</div><div class="card-ico">🧭</div>
        <h2 class="card-title">أمامكم طريقان!</h2><p class="card-text">تشاوروا واختاروا قبل أن تروا السؤال:</p>
        <div class="pathbtns">
          <button class="pathbtn" data-k="safe"><span class="arrows">⬅ ⬆ ➡</span>الطريق الآمن<small>تقدّم خطوة واحدة</small></button>
          <button class="pathbtn hard" data-k="hard"><span class="arrows">⬅ ⬆ ➡</span>الطريق الصعب<small>تقدّم ${fmt("3")} خطوات</small></button>
        </div>`;
      c3.appendChild(face); back.appendChild(c3); root().appendChild(back);
      face.querySelectorAll(".pathbtn").forEach(b => b.onclick = async () => {
        g.Sfx.click(); setKeys(null);
        const k = b.dataset.k; await closeAnim(back, .25); resolve(k);
      });
      setKeys({ onEnter: () => face.querySelector(".pathbtn").click(), onEsc: () => { } });
      g.Sfx.flip();
      g.gsap.fromTo(back, { opacity: 0 }, { opacity: 1, duration: .25 });
      if (!reduced) g.gsap.fromTo(c3, { y: 60, scale: .7, rotationX: 20 }, { y: 0, scale: 1, rotationX: 0, duration: .5, ease: "back.out(1.6)" });
    });
  };

  /* ---------------------------------------------------------------- نافذة معلومة (أزرار مخصصة) */
  UI.showInfo = function (o) {
    const T = TYPES[o.type] || TYPES.info;
    return new Promise(resolve => {
      const back = el("div", "backdrop");
      const c3 = el("div", "card3d"); c3.style.setProperty("--cc", o.color || T.color);
      const face = el("div", "card-face");
      face.innerHTML = `${o.tag || T.label ? `<div class="card-tag">${o.tag || T.label}</div>` : ""}<div class="card-ico">${o.icon || T.icon}</div>
        <h2 class="card-title">${fmt(o.title || "")}</h2><p class="card-text">${fmt(o.text || "")}</p><div class="btn-row"></div>`;
      const row = $(".btn-row", face);
      (o.buttons || [{ text: "تابعوا ▶", cls: "good" }]).forEach((b, i) => {
        const btn = el("button", "btn " + (b.cls || "good"), b.text);
        btn.onclick = async () => { g.Sfx.click(); setKeys(null); await closeAnim(back, .25); resolve(i); };
        row.appendChild(btn);
      });
      c3.appendChild(face); back.appendChild(c3); root().appendChild(back);
      setKeys({ onEnter: () => row.firstChild.click(), onEsc: () => row.lastChild.click() });
      g.Sfx[o.sfx || "flip"]();
      g.gsap.fromTo(back, { opacity: 0 }, { opacity: 1, duration: .25 });
      if (!reduced) g.gsap.fromTo(c3, { y: 70, scale: .6, rotationX: 25 }, { y: 0, scale: 1, rotationX: 0, duration: .55, ease: "back.out(1.7)" });
      setTimeout(() => row.firstChild && row.firstChild.focus(), 500);
    });
  };

  /* ---------------------------------------------------------------- شفرة طاقة تطير إلى لوحة الفريق */
  UI.flyShard = function (fromRect, teamIdx, n = 1) {
    return new Promise(resolve => {
      const layer = $("#fxLayer"), to = UI.barRect(teamIdx);
      const sx = fromRect.left + fromRect.width / 2, sy = fromRect.top + fromRect.height / 2;
      const tx = to.left + to.width * .75, ty = to.top + to.height / 2;
      let pending = n;
      for (let k = 0; k < n; k++) {
        const s = el("div", "shard-fly", "⚡"); layer.appendChild(s);
        const mx = (sx + tx) / 2 + (Math.random() - .5) * 160, my = Math.min(sy, ty) - 120 - Math.random() * 60;
        g.gsap.set(s, { x: sx, y: sy, scale: .3 });
        g.gsap.timeline({ delay: k * .18 })
          .to(s, { scale: 1.6, duration: .2, ease: "back.out(3)" })
          .to(s, { duration: reduced ? .3 : .75, ease: "power2.inOut", motionPath: { path: [{ x: sx, y: sy }, { x: mx, y: my }, { x: tx, y: ty }], curviness: 1.4 } }, ">")
          .to(s, { scale: .5, opacity: 0, duration: .2 }, ">-.1")
          .call(() => { g.Sfx.shard(); s.remove(); if (--pending === 0) resolve(); });
      }
    });
  };
  UI.flyIcon = function (icon, fromRect, toRect) {
    return new Promise(resolve => {
      const s = el("div", "shard-fly", icon); s.style.fontSize = "44px"; $("#fxLayer").appendChild(s);
      const sx = fromRect.left + fromRect.width / 2, sy = fromRect.top + fromRect.height / 2;
      const tx = toRect.left + toRect.width / 2, ty = toRect.top + toRect.height + 16;
      g.gsap.set(s, { x: sx, y: sy, scale: .2 });
      g.gsap.timeline({ onComplete: () => { s.remove(); resolve(); } })
        .to(s, { scale: 2, duration: .3, ease: "back.out(3)" })
        .to(s, { duration: reduced ? .3 : .8, ease: "power2.inOut", motionPath: { path: [{ x: sx, y: sy }, { x: (sx + tx) / 2, y: Math.min(sy, ty) - 140 }, { x: tx, y: ty }], curviness: 1.4 } })
        .to(s, { scale: .8, duration: .15 });
    });
  };

  /* ---------------------------------------------------------------- شاشة البداية */
  UI.showSplash = function (names) {
    return new Promise(resolve => {
      const sp = el("div", "splash");
      sp.innerHTML = `<div class="splash-card">
        <div style="font-size:calc(var(--u)*7)">🤖🔋</div>
        <h1>إنقاذ <em>الروبوت</em> من الحفرة</h1>
        <p>الروبوت «حاسوب» فقد طاقته وتناثرت شفرات تشغيله في مدينة الأرقام!<br>تسابقوا لجمع شفرات الطاقة عبر الجولات وأنقذوه معاً.</p>
        <div class="teams-in">
          <div class="team-in red">🔥 الفريق الأول (الشعلة)<input id="sn0" maxlength="18" value=""></div>
          <div class="team-in blue">⚡ الفريق الثاني (البرق)<input id="sn1" maxlength="18" value=""></div>
        </div>
        <div class="btn-row"><button class="btn good" id="startBtn">▶ ابدأوا اللعب</button></div>
        <p class="note">مفتاح المسافة (Space) لرمي النرد · ⚙ لوحة المعلّم</p></div>`;
      root().appendChild(sp);
      $("#sn0", sp).value = names[0]; $("#sn1", sp).value = names[1];
      const go = async () => {
        g.Sfx.resume(); g.Sfx.click(); setKeys(null);
        const n = [$("#sn0", sp).value.trim() || "فريق الشعلة", $("#sn1", sp).value.trim() || "فريق البرق"];
        await closeAnim(sp, .35); resolve(n);
      };
      $("#startBtn", sp).onclick = go;
      setKeys({ onEnter: () => { if (document.activeElement && document.activeElement.tagName === "INPUT") go(); else go(); }, onEsc: () => { } });
      g.gsap.from(".splash-card", { y: 50, scale: .8, opacity: 0, duration: .7, ease: "back.out(1.6)" });
    });
  };

  /* ---------------------------------------------------------------- شاشة الفوز */
  UI.showWin = function (state, names) {
    return new Promise(resolve => {
      const w = state.winner, wt = state.teams[w];
      const sp = el("div", "splash"); sp.style.background = "radial-gradient(circle at 50% 40%, rgba(255,230,120,.25), rgba(10,20,10,.55))";
      const card = (i) => `<div class="result ${i === 0 ? "red" : "blue"} ${i === w ? "win" : ""}"><b>${i === w ? "🏆 " : ""}${names[i]}</b>شفرات الطاقة: ${g.Num.digits(state.teams[i].shards)} ⚡<br>الإجابات الصحيحة: ${g.Num.digits(state.teams[i].correct)}</div>`;
      sp.innerHTML = `<div style="text-align:center;pointer-events:auto">
        <div class="win-banner">تم الإنقاذ! 🎉</div>
        <div class="splash-card" style="margin-top:calc(var(--u)*2)">
          <h1 style="font-size:calc(var(--u)*4.2)">فاز <em class="t${w}">${names[w]}</em> وشغّل الروبوت «حاسوب»!</h1>
          <div class="result-table">${card(0)}${card(1)}</div>
          <p>عدد الأدوار: <b>${g.Num.digits(state.turnCount)}</b></p>
          <div class="btn-row"><button class="btn good" id="againBtn">🔄 العبوا مجدداً</button></div>
        </div></div>`;
      root().appendChild(sp);
      g.gsap.from(sp.querySelector(".win-banner"), { y: -300, scale: 1.4, opacity: 0, duration: .9, ease: "bounce.out" });
      g.gsap.from(sp.querySelector(".splash-card"), { y: 120, opacity: 0, duration: .6, delay: .9, ease: "back.out(1.4)" });
      $("#againBtn", sp).onclick = () => { g.Sfx.click(); setKeys(null); sp.remove(); resolve(); };
      setKeys({ onEnter: () => $("#againBtn", sp).click(), onEsc: () => { } });
    });
  };

  /* ---------------------------------------------------------------- لوحة المعلّم */
  UI.toggleTeacher = function (api) {
    const ex = $("#teacherPanel"); if (ex) { ex.remove(); return; }
    const s = api.settings();
    const p = el("div", "panel"); p.id = "teacherPanel";
    const sw = (id, label, on) => `<div class="row"><label for="${id}">${label}</label><span class="switch"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><i></i></span></div>`;
    p.innerHTML = `<h3>⚙ لوحة المعلّم</h3>
      <div class="row"><label for="sMode">طريقة التقييم</label><select id="sMode"><option value="teacher" ${s.mode === "teacher" ? "selected" : ""}>المعلّم يحكم (افتراضي)</option><option value="auto" ${s.mode === "auto" ? "selected" : ""}>اختيار تلقائي (٣ إجابات)</option></select></div>
      <div class="row"><label for="sTimer">مؤقت الأسئلة</label><select id="sTimer">${[0, 15, 30, 45, 60].map(v => `<option value="${v}" ${s.timer === v ? "selected" : ""}>${v ? g.Num.digits(v) + " ثانية" : "بدون"}</option>`).join("")}</select></div>
      <div class="row"><label for="sQ">عدد أسئلة التحديات</label><select id="sQ">${[3, 4, 5, 6].map(v => `<option value="${v}" ${(s.qCount || 6) === v ? "selected" : ""}>${g.Num.digits(v)}</option>`).join("")}</select></div>
      ${sw("sSound", "الصوت", s.sound)}${sw("sMusic", "الموسيقى", s.music)}${sw("sEast", "الأرقام الهندية (١٢٣)", s.eastern)}
      <div class="row" style="flex-wrap:wrap;justify-content:center">
        <button class="btn blue" id="aSkip">⏭ تخطّي دور</button>
        <button class="btn purple" id="aUndo">↩ تراجع الدور</button>
        <button class="btn bad" id="aRestart">🔄 إعادة اللعبة</button>
        <button class="btn gray" id="aClose">✖ إغلاق</button></div>
      <p class="note">التخطّي والتراجع يعملان عند انتظار رمي النرد.</p>`;
    root().appendChild(p);
    const on = (id, ev, fn) => $("#" + id, p).addEventListener(ev, fn);
    on("sMode", "change", e => api.set({ mode: e.target.value }));
    on("sTimer", "change", e => api.set({ timer: +e.target.value }));
    on("sQ", "change", e => api.set({ qCount: +e.target.value }));
    on("sSound", "change", e => api.set({ sound: e.target.checked }));
    on("sMusic", "change", e => api.set({ music: e.target.checked }));
    on("sEast", "change", e => api.set({ eastern: e.target.checked }));
    on("aSkip", "click", () => api.action("skip"));
    on("aUndo", "click", () => api.action("undo"));
    on("aRestart", "click", () => { if (confirm("إعادة اللعبة من البداية؟")) api.action("restart"); });
    on("aClose", "click", () => p.remove());
    g.gsap.from(p, { x: -80, opacity: 0, duration: .3 });
  };

  g.UI = UI;
})(window);
