/* main.js — المتحكّم: آلة الحالات SETUP → TURN_START → ROLLING → MOVING → TILE_EFFECT → RESOLVE → WIN */
(function (g) {
  "use strict";
  const { Logic, UI, View, Sfx, CARDS, Chars, gsap } = g;
  const TILES = g.TILES_DATA, FINISH = Logic.FINISH, CFG = Logic.CONFIG;
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";
  const log = (...a) => console.log("%c[لعبة]", "color:#e8811a;font-weight:700", ...a);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const reduced = UI.reduced;
  const TEAM_TAG = ["🔥", "⚡"];
  const TEAM_CONFETTI = [["#e43a2a", "#ff8a5c", "#ffd54a", "#ffffff"], ["#2f86e6", "#7fd0ff", "#ffd54a", "#ffffff"]];

  let state, settings, history = [], pendingStage = null, lastAwarded = 0, busy = false, forcedRoll = null, actionResolve = null, restarting = false;

  /* ---------------------------------------------------------------- الإعدادات المحفوظة (localStorage فقط) */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("rescue." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("rescue." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
  settings = Object.assign({ mode: "teacher", timer: 0, sound: true, music: true, eastern: true, qCount: 6 }, LS.get("settings", {}));
  g.Num.eastern = settings.eastern;

  const nameOf = i => UI.teamName(i);
  async function applyChars(ids) {
    [0, 1].forEach(i => Chars.assign(i, ids[i]));
    LS.set("chars", ids);
    await Promise.all([0, 1].map(i => View.setCharacter(i, ids[i])));
    UI.refreshCharacters();
  }
  const team = i => state.teams[i];

  /* ---------------------------------------------------------------- تحكم بالسرعة (تخطي الحركات بالنقر) */
  function setSpeed(k) { gsap.globalTimeline.timeScale(k); $("#skipHint").classList.toggle("hidden", k === 1 || !busy); }
  const $ = s => document.querySelector(s);
  function setBusy(b) { busy = b; if (!b) setSpeed(1); else $("#skipHint").classList.toggle("hidden", true); }
  document.addEventListener("pointerdown", e => {
    if (!busy || e.target.closest("#corner, .panel, .backdrop")) return;
    setSpeed(4.5); $("#skipHint").classList.add("hidden");
  });
  // تلميح التخطي يظهر بعد ثانية من الانشغال
  let hintT = null;
  function busyHint() { clearTimeout(hintT); hintT = setTimeout(() => { if (busy && gsap.globalTimeline.timeScale() === 1) $("#skipHint").classList.remove("hidden"); }, 1400); }

  /* ---------------------------------------------------------------- مزامنة الواجهة */
  function syncAll(bump) { [0, 1].forEach(i => UI.syncTeam(i, team(i), bump)); UI.setStage(state.robotStage); }
  function persistNames() { LS.set("names", UI.names()); }
  function applySettings() {
    g.Num.eastern = settings.eastern; Sfx.setMuted(!settings.sound); Sfx.music(settings.music && settings.sound);
    $("#btnSound").textContent = settings.sound ? "🔊" : "🔇"; $("#btnSound").classList.toggle("off", !settings.sound);
    $("#btnMusic").classList.toggle("off", !settings.music);
    syncAll(false); LS.set("settings", settings);
  }

  /* ---------------------------------------------------------------- لعبة جديدة */
  function newGame() {
    state = Logic.newState([nameOf(0), nameOf(1)], settings, Chars.assigned);
    history = []; pendingStage = null;
    [0, 1].forEach(i => Chars.pose(i, "idle"));
    View.resetRobot(); View.setRobotPose(1);
    [0, 1].forEach(i => View.placePawn(i, 0));
    UI.setDie(null); syncAll(false);
    View.camHome(.01);
  }
  function restoreSnapshot(json) {
    state = JSON.parse(json);
    [0, 1].forEach(i => View.placePawn(i, team(i).pos));
    View.setRobotPose(state.robotStage); syncAll(false); UI.setDie(null);
  }

  /* ---------------------------------------------------------------- انتظار الإجراء (رمي / تخطي / تراجع) */
  function waitForAction(ti) {
    setBusy(false);
    return new Promise(res => {
      Chars.setWaiting(ti, true);
      actionResolve = a => { if (!actionResolve) return; actionResolve = null; Chars.setWaiting(ti, false); UI.setRollReady(false); res(a); };
      UI.setRollReady(true, () => actionResolve && actionResolve({ type: "roll" }), `دور ${nameOf(ti)} ${TEAM_TAG[ti]} — اضغطوا على منطقة النرد أو Space لرمي النرد 🎲`);
    });
  }
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && actionResolve && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.querySelector(".backdrop")) {
      e.preventDefault(); actionResolve({ type: "roll" });
    }
  });

  /* ---------------------------------------------------------------- النرد */
  async function rollDice(v) {
    setBusy(true); busyHint(); UI.setDie(null);
    if (g.Dice3D) {
      try { await g.Dice3D.roll(v, UI.dieRect(), Sfx); } catch (e) { console.warn("Dice3D فشل، استخدام البديل", e); await fallbackDice(v); }
    } else await fallbackDice(v);
    UI.setDie(v);
    if (v === 6) Chars.react(state.turn, "happy", { say: "roll6" }); else if (v === 1) Chars.say(state.turn, "rollLow");
    const d = document.querySelector("#hudDie");
    gsap.fromTo(d, { scale: 1.5 }, { scale: 1, duration: .5, ease: "elastic.out(1.4,.4)" });
    Sfx.diceHit(.6);
    log("نتيجة النرد:", v);
  }
  async function fallbackDice(v) {
    Sfx.diceRoll();
    for (let i = 0; i < 10; i++) { UI.setDie(1 + Logic.randInt(6)); await sleep(70 + i * 12); }
  }

  /* ---------------------------------------------------------------- الشفرات والمراحل */
  async function awardShards(ti, n, fromRect) {
    const ch = Logic.addShards(state, ti, n);
    await UI.flyShard(fromRect || screenCenterRect(), ti, n);
    UI.syncTeam(ti, team(ti), true);
    if (g.confetti && !reduced) {
      const r = UI.teamRect(ti);
      g.confetti({ particleCount: 30, spread: 65, startVelocity: 28, scalar: .8, origin: { x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height) / innerHeight }, colors: ["#ffd54a", "#fff3a5", ...TEAM_CONFETTI[ti]], zIndex: 70 });
    }
    if (ch) pendingStage = ch.to;
    lastAwarded = ti; Chars.react(ti, "happy", { say: "shard" });
    log(`${nameOf(ti)}: +${n} شفرة → ${team(ti).shards}`);
  }
  async function flushStage() {
    if (!pendingStage) return;
    const n = pendingStage; pendingStage = null;
    setBusy(true); busyHint();
    await sleep(250);
    UI.setStage(n);
    Chars.react(lastAwarded, "cheer", { ms: 2600, say: "stage", sayDelay: 900 }); Chars.react(1 - lastAwarded, "happy", { ms: 2400 });
    await View.robotStage(n);
    UI.msgToast(`تقدّم الإنقاذ! المرحلة ${n} من ٥ 🤖`, 1800);
    await sleep(600);
    setBusy(false);
  }
  function screenCenterRect() { return { left: innerWidth / 2 - 30, top: innerHeight / 2 - 30, width: 60, height: 60 }; }

  /* ---------------------------------------------------------------- لافتات الجولات */
  function roundBanner(idx) {
    const map = { 0: ["الجولة الأولى", "الوصول إلى مكان الحفرة"], 6: ["الجولة الثانية", "تجهيز خطة الإنقاذ وأدواتها"], 12: ["الجولة الثالثة", "محطة الحصول على البطارية"], 13: ["الجولة الرابعة", "سحب الروبوت وإنقاذه بالكامل"] };
    if (map[idx]) UI.roundToast(map[idx][0], map[idx][1]);
  }
  /* عبور محطة البطارية (المربع 12): شفرة لمرة واحدة لكل فريق */
  async function maybeBattery(ti, idx) {
    if (idx !== CFG.batteryTile || team(ti).battery) return;
    team(ti).battery = true;
    View.batteryFlash(); Chars.say(ti, "battery");
    UI.msgToast("🔋 محطة البطارية! شفرة طاقة مجانية", 1700);
    await sleep(500);
    await awardShards(ti, CFG.rewards.battery, View.worldRect(g.BATTERY_SPOT.x, g.BATTERY_SPOT.y, 60, 60));
  }

  /* ---------------------------------------------------------------- الحركة */
  async function moveSteps(ti, steps, opts = {}) {
    const t = team(ti), path = Logic.pathFor(t.pos, steps);
    let n = 0;
    for (const idx of path) {
      n++;
      const from = t.pos;
      await View.hop(ti, from, idx, opts.counter === false ? 0 : n, opts.hop || {});
      t.pos = idx;
      roundBanner(idx);
      await maybeBattery(ti, idx);
    }
    View.showCounter(ti, null);
    return path.length;
  }

  /* ---------------------------------------------------------------- الأسئلة */
  async function askQuestion(ti, card, type, o = {}) {
    setSpeed(1);
    const t = team(ti);
    if (o.allowKey && t.keys > 0) {
      const k = await UI.showInfo({ ti, type: "mystery", icon: "🗝️", title: "مفتاح البوابة", text: "معكم مفتاح ذهبي! هل تستخدمونه لتخطي هذا التحدي بدون الإجابة؟", sfx: "magic", buttons: [{ text: "🗝️ استخدموا المفتاح", cls: "purple" }, { text: "سنجيب بأنفسنا", cls: "gray" }] });
      if (k === 0) { t.keys--; UI.syncTeam(ti, t); return { correct: true, key: true, rect: screenCenterRect() }; }
    }
    if (window.Sfx) Sfx.flip();
    await View.camHome(.35);
    const r = await UI.showCard({ ti, card, type, settings, teamName: nameOf(ti), wrongText: o.wrongText, bonusText: o.bonusText, icon: o.icon });
    t.answers++; if (r.correct) t.correct++;
    return r;
  }
  const pick = (deck, bank) => Logic.draw(state, deck, bank, deck === "challenge" ? settings.qCount : 0);

  /* ---------------------------------------------------------------- أثر المربع */
  async function resolveTile(ti, forceType) {
    setSpeed(1);
    const t = team(ti), tile = TILES[t.pos], type = forceType || tile.type;
    log(`${nameOf(ti)} على المربع ${tile.i} (${type})`);
    if (type === "start" || type === "finish") return;
    await sleep(250);
    const R = CFG.rewards;
    if (["challenge", "hazard", "spot", "team"].includes(type)) {
      const bank = CARDS[type], card = pick(type, bank);
      const r = await askQuestion(ti, card, type, { allowKey: true });
      if (r.correct) await awardShards(ti, card.reward || R[type], r.rect);
      return;
    }
    if (type === "mystery") return mystery(ti);
    if (type === "choose") return chooseFlow(ti);
    if (type === "comeback") return comebackFlow(ti);
    if (type === "tool") return toolFlow(ti);
  }

  async function mystery(ti) {
    const t = team(ti), card = pick("mystery", CARDS.mystery);
    await View.camHome(.35);
    const first = card.effect === "oops" ? null : await UI.showInfo({ ti, type: "mystery", icon: card.icon, title: card.title, text: card.text, sfx: "magic", buttons: [{ text: "✨ نفّذوا الأثر", cls: "purple" }] });
    const dr = screenCenterRect();
    switch (card.effect) {
      case "slide2": {
        const path = Logic.pathFor(t.pos, 2);
        if (!path.length) return;
        setBusy(true); busyHint(); Chars.react(ti, "happy", { say: "slide", ms: 1600 });
        const from = t.pos; await View.slide(ti, path); t.pos = path[path.length - 1];
        for (const i of path) { roundBanner(i); await maybeBattery(ti, i); }
        View.showCounter(ti, null); setBusy(false);
        break;
      }
      case "rollagain":
        state.extraRoll = true; Sfx.magic(); UI.msgToast("⚡ شحنة طاقة! ارموا النرد مرة أخرى", 2200);
        break;
      case "shortcut": {
        const target = Logic.shortcutTarget(t.pos);
        if (target <= t.pos) { UI.msgToast("أنتم بالفعل في أعلى مرحلة! 🎉", 2000); break; }
        setBusy(true); busyHint(); Chars.say(ti, "tunnel");
        const from = t.pos; await View.tunnel(ti, target); t.pos = target;
        if (from < CFG.batteryTile && target >= CFG.batteryTile) { await maybeBattery(ti, CFG.batteryTile); }
        roundBanner(target); setBusy(false);
        break;
      }
      case "oops": {
        Chars.say(ti, "oops");
        const r = await askQuestion(ti, card, "mystery", { wrongText: "توقفوا لدورة واحدة 🌪️ — ثم تواصلون!", icon: card.icon });
        if (r.correct) UI.msgToast("🌪️ تبددت العاصفة! تابعوا اللعب", 2000);
        else { t.skip = 1; }
        break;
      }
      case "key":
        t.keys++; Sfx.magic(); Chars.react(ti, "happy", { say: "key" });
        await UI.flyIcon("🗝️", dr, UI.teamRect(ti));
        UI.syncTeam(ti, t, true);
        UI.msgToast("🗝️ احتفظوا بالمفتاح لتخطي تحدٍّ قادم", 2200);
        break;
    }
    if (state.teams[ti].pos >= FINISH) return;
  }

  async function chooseFlow(ti) {
    const t = team(ti);
    await View.camHome(.35);
    const k = await UI.showChoose(nameOf(ti), ti);
    const card = CARDS.choose[k];
    const r = await askQuestion(ti, card, "choose", { icon: k === "safe" ? "🟢" : "🔥", bonusText: null });
    if (r.correct) {
      UI.msgToast(`أحسنتم! تقدّموا ${g.Num.digits(card.steps)} ${card.steps === 1 ? "خطوة" : "خطوات"} 🚀`, 1600);
      setBusy(true); busyHint(); await sleep(400);
      await bonusMove(ti, card.steps, { trail: { color: 0x7dffb0, size: .45 }, fast: true });
      setBusy(false);
    }
  }
  async function bonusMove(ti, steps, o = {}) {
    const t = team(ti), path = Logic.pathFor(t.pos, steps); let n = 0;
    for (const idx of path) {
      n++; const from = t.pos;
      await View.hop(ti, from, idx, n, { fast: true, trail: o.trail, height: o.height });
      t.pos = idx; roundBanner(idx); await maybeBattery(ti, idx);
    }
    View.showCounter(ti, null);
  }

  async function comebackFlow(ti) {
    const t = team(ti);
    await View.camHome(.35);
    if (Logic.isTrailing(state, ti)) {
      const card = CARDS.comeback[0];
      const r = await askQuestion(ti, card, "comeback", { icon: "🌪️" });
      if (r.correct) {
        UI.msgToast("🌪️ رياح الإنقاذ! قفزة ٤ خطوات كاملة", 1700);
        setBusy(true); busyHint(); Sfx.whoosh(); await sleep(450);
        await bonusMove(ti, CFG.comebackSteps, { trail: { color: 0xffffff, size: .7 }, height: 62 });
        setBusy(false);
      }
    } else {
      await UI.showInfo({ ti, type: "comeback", icon: "💪", title: "فرصة عودة", text: "هذه الفرصة للفريق المتأخر فقط، وأنتم في المقدمة! أحسنتم 👏 ونمنحكم شفرة طاقة تشجيعية.", buttons: [{ text: "شكراً! ⚡", cls: "good" }] });
      await awardShards(ti, R_ENC(), screenCenterRect());
    }
  }
  const R_ENC = () => CFG.rewards.encourage;

  async function toolFlow(ti) {
    const t = team(ti), tools = CARDS.tools, tool = tools[Logic.randInt(tools.length)];
    await View.camHome(.35);
    await UI.showInfo({ ti, type: "tool", icon: tool.icon, title: `حصلتم على: ${tool.name}!`, text: "أداة إنقاذ جديدة تُضاف إلى صندوق أدوات فريقكم، ومعها شفرة طاقة ⚡", sfx: "magic", buttons: [{ text: "أضيفوها! 🧰", cls: "blue" }] });
    t.tools.push(tool.id);
    await UI.flyIcon(tool.icon, screenCenterRect(), UI.teamRect(ti));
    UI.syncTeam(ti, t, true);
    await awardShards(ti, CFG.rewards.tool, screenCenterRect());
  }

  /* ---------------------------------------------------------------- الدور */
  async function playTurn() {
    const ti = state.turn;
    UI.setActive(ti); View.setActiveTeam(ti);
    Chars.react(ti, "turn", { say: "turn", sayDelay: 450 });
    history.push(JSON.stringify(state)); if (history.length > 30) history.shift();
    await View.camHome(.6);
    const act = await waitForAction(ti);
    if (act.type === "restart") return;
    if (act.type === "skip") { log("تخطّي الدور"); Logic.nextTurn(state); return; }
    if (act.type === "undo") {
      history.pop();
      if (history.length < 1) { UI.msgToast("لا يوجد ما يُتراجع عنه", 1500); return; }
      restoreSnapshot(history.pop()); log("تراجع"); return;
    }
    const v = forcedRoll || Logic.randInt(6) + 1; forcedRoll = null;
    await rollDice(v);
    await moveSteps(ti, v);
    if (Logic.checkWin(state)) return;
    await resolveTile(ti);
    if (Logic.checkWin(state)) return;
    setBusy(true);
    await flushStage();
    setBusy(false);
    Logic.nextTurn(state);
    const nx = state.turn;
    if (nx !== ti) UI.msgToast(`دور ${nameOf(nx)} ${TEAM_TAG[nx]}`, 1300);
    else if (state.extraRoll === false && team(ti).skip === 0 && history.length) { /* دور إضافي أو فريق متوقف */ }
  }

  /* ---------------------------------------------------------------- الفوز */
  async function winFlow() {
    const w = state.winner, names = [nameOf(0), nameOf(1)];
    setBusy(true); busyHint();
    UI.setRollReady(false);
    UI.setStage(5);
    Chars.react(w, "cheer", { ms: 600000, say: "win", sayDelay: 1500 }); Chars.react(1 - w, "happy", { ms: 600000, say: "lose", sayDelay: 2500 });
    await View.winScene(w);
    const colors = TEAM_CONFETTI[w];
    if (g.confetti) {
      const fire = (r, o) => g.confetti(Object.assign({ particleCount: Math.floor(200 * r), colors, zIndex: 70, origin: { x: .5, y: .7 } }, o));
      fire(.25, { spread: 26, startVelocity: 55 }); fire(.2, { spread: 60 }); fire(.35, { spread: 100, decay: .91, scalar: .8 }); fire(.1, { spread: 120, startVelocity: 25, decay: .92, scalar: 1.2 }); fire(.1, { spread: 120, startVelocity: 45 });
      const end = Date.now() + 2200;
      (function side() { g.confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0, y: .75 }, colors, zIndex: 70 }); g.confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1, y: .75 }, colors, zIndex: 70 }); if (Date.now() < end) requestAnimationFrame(side); })();
    }
    setBusy(false);
    await UI.showWin(state, names);
  }

  /* ---------------------------------------------------------------- الحلقة الكبرى */
  async function mainLoop() {
    const saved = LS.get("names", []);
    const r = await UI.showSplash([saved[0] || "", saved[1] || ""], Chars.assigned);
    UI.setName(0, r.names[0]); UI.setName(1, r.names[1]); persistNames();
    if (Chars.ready) await applyChars(r.chars);
    applySettings();
    while (true) {                         // «العب مجدداً» / إعادة اللعبة تبدأ لعبة جديدة بنفس الفريقين
      restarting = false;
      newGame();
      roundBanner(0); await sleep(1400);
      while (!state.over && !restarting) await playTurn();
      if (restarting) continue;
      await winFlow();
    }
  }

  /* ---------------------------------------------------------------- واجهة المعلّم */
  const teacherApi = {
    settings: () => settings,
    set(patch) { Object.assign(settings, patch); applySettings(); },
    action(a) {
      if (a === "restart") { restarting = true; UI.msgToast("إعادة اللعبة…", 900); if (actionResolve) actionResolve({ type: "restart" }); else { UI.msgToast("ستُعاد اللعبة عند انتهاء الحركة", 1500); } return; }
      if (!actionResolve) { UI.msgToast("انتظروا انتهاء الحركة ثم حاولوا", 1500); return; }
      actionResolve({ type: a });
    }
  };

  /* ---------------------------------------------------------------- أدوات التطوير ?debug=1 */
  function debugTools() {
    const P = View.PIXI, L = View.layer("debug");
    const gfx = new P.Graphics(); L.addChild(gfx);
    const labels = TILES.map(t => { const tx = new P.Text({ text: String(t.i), style: { fontSize: 18, fontWeight: "900", fill: 0xffffff, stroke: { color: 0, width: 4 } } }); tx.anchor.set(.5); L.addChild(tx); return tx; });
    const bat = new P.Graphics(); L.addChild(bat);
    const redraw = () => {
      gfx.clear();
      TILES.forEach((t, i) => {
        gfx.circle(t.x, t.y, 9).fill({ color: t.type === "finish" ? 0xffd54a : 0xff2d9a, alpha: .85 });
        (t.via || []).forEach(v => gfx.circle(v[0], v[1], 5).fill({ color: 0x00e5ff, alpha: .9 }));
        (t.leap || []).forEach(v => gfx.circle(v[0], v[1], 5).fill({ color: 0xffa000, alpha: .9 }));
        labels[i].position.set(t.x, t.y - 20);
      });
      bat.clear().circle(g.BATTERY_SPOT.x, g.BATTERY_SPOT.y, 10).fill({ color: 0x00ff66, alpha: .9 });
    };
    redraw();
    const panel = document.createElement("div"); panel.className = "dbg";
    panel.innerHTML = `<h4>🛠 وضع المعايرة</h4><div class="pos" id="dbgPos">انقر على اللوحة…</div>
      <div>النرد المفروض: ${[1, 2, 3, 4, 5, 6].map(n => `<button data-r="${n}">${n}</button>`).join("")}</div>
      <div>اذهب إلى مربع: <select id="dbgTile">${TILES.map(t => `<option value="${t.i}">${t.i} ${t.type}</option>`).join("")}</select><button id="dbgGo">اذهب</button></div>
      <div>أثر فوري: <select id="dbgType">${["challenge", "mystery", "team", "choose", "comeback", "hazard", "spot", "tool"].map(x => `<option>${x}</option>`).join("")}</select><button id="dbgFx">نفّذ</button></div>
      <div>شفرات: <button id="dbgSh0">+1 🔴</button><button id="dbgSh1">+1 🔵</button><button id="dbgSh3">+3 🔴</button></div>
      <div>شخصية: <select id="dbgCh">${["happy", "sad", "cheer", "turn"].map(x => `<option>${x}</option>`).join("")}</select><button id="dbgC0">🔴</button><button id="dbgC1">🔵</button> <select id="dbgPh">${Object.keys(g.PHRASES).map(x => `<option>${x}</option>`).join("")}</select><button id="dbgS0">قل🔴</button><button id="dbgS1">قل🔵</button></div>
      <div><button id="dbgCopy">📋 نسخ JSON للمربعات</button><button id="dbgGrid">شبكة</button><button id="dbgHide">إخفاء النقاط</button></div>
      <div style="opacity:.7;font-size:11px">اسحب النقاط الوردية لتعديل المربعات. سيان = via، برتقالي = leap، أخضر = البطارية.</div>`;
    document.body.appendChild(panel);
    const pos = panel.querySelector("#dbgPos");
    panel.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { forcedRoll = +b.dataset.r; pos.textContent = "النرد القادم = " + forcedRoll; });
    panel.querySelector("#dbgGo").onclick = () => { const i = +panel.querySelector("#dbgTile").value; team(state.turn).pos = i; View.placePawn(state.turn, i); log("انتقال إلى", i); };
    panel.querySelector("#dbgFx").onclick = async () => { const ti = state.turn; const ty = panel.querySelector("#dbgType").value; await resolveTile(ti, ty); await flushStage(); };
    panel.querySelector("#dbgSh0").onclick = async () => { await awardShards(0, 1); await flushStage(); };
    panel.querySelector("#dbgSh1").onclick = async () => { await awardShards(1, 1); await flushStage(); };
    panel.querySelector("#dbgSh3").onclick = async () => { await awardShards(0, 3); await flushStage(); };
    [0, 1].forEach(i => { panel.querySelector("#dbgC" + i).onclick = () => Chars.react(i, panel.querySelector("#dbgCh").value); panel.querySelector("#dbgS" + i).onclick = () => Chars.say(i, panel.querySelector("#dbgPh").value); });
    panel.querySelector("#dbgCopy").onclick = () => { const js = JSON.stringify(TILES.map(t => t)); navigator.clipboard && navigator.clipboard.writeText(js); console.log(js); pos.textContent = "نُسخ JSON (وطُبع في console)"; };
    panel.querySelector("#dbgHide").onclick = () => { L.visible = !L.visible; };
    // سحب النقاط + طباعة الإحداثيات
    let drag = null;
    const cv = View.app.canvas;
    cv.addEventListener("pointerdown", e => {
      const w = View.clientToWorld(e.clientX, e.clientY);
      pos.textContent = `x:${Math.round(w.x)} y:${Math.round(w.y)}`; console.log("نقرة", Math.round(w.x), Math.round(w.y));
      let best = null, bd = 22;
      TILES.forEach(t => { const d = Math.hypot(t.x - w.x, t.y - w.y); if (d < bd) { bd = d; best = { tile: t }; } });
      (function () { const d = Math.hypot(g.BATTERY_SPOT.x - w.x, g.BATTERY_SPOT.y - w.y); if (d < bd) { bd = d; best = { bat: true }; } })();
      TILES.forEach(t => { (t.via || []).forEach((v, k) => { const d = Math.hypot(v[0] - w.x, v[1] - w.y); if (d < bd) { bd = d; best = { pt: v }; } }); (t.leap || []).forEach(v => { const d = Math.hypot(v[0] - w.x, v[1] - w.y); if (d < bd) { bd = d; best = { pt: v }; } }); });
      drag = best; if (drag) cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return; const w = View.clientToWorld(e.clientX, e.clientY);
      if (drag.tile) { drag.tile.x = Math.round(w.x); drag.tile.y = Math.round(w.y); View.refreshTile(drag.tile.i); [0, 1].forEach(i => View.placePawn(i, team(i).pos)); }
      else if (drag.bat) { g.BATTERY_SPOT.x = Math.round(w.x); g.BATTERY_SPOT.y = Math.round(w.y); }
      else if (drag.pt) { drag.pt[0] = Math.round(w.x); drag.pt[1] = Math.round(w.y); }
      redraw(); pos.textContent = `x:${Math.round(w.x)} y:${Math.round(w.y)}`;
    });
    cv.addEventListener("pointerup", () => { drag = null; });
    g.__dbg = { forceRoll: n => { forcedRoll = n; }, resolveTile, awardShards, flushStage, get state() { return state; }, View, UI, Logic };
  }

  /* ---------------------------------------------------------------- الإقلاع */
  async function boot() {
    g.gsap.registerPlugin(g.MotionPathPlugin);
    UI.buildHud();
    try { await (document.fonts && document.fonts.ready); } catch (e) { /* ignore */ }
    await Chars.load();
    await View.init(document.getElementById("stageHost"), document.getElementById("hud"));
    if (Chars.ready) {
      const sv = LS.get("chars", []), ids = Chars.list.map(c => c.id);
      const a = ids.includes(sv[0]) ? sv[0] : ids[0], b = ids.includes(sv[1]) && sv[1] !== a ? sv[1] : ids.find(x => x !== a);
      await applyChars([a, b]); Chars.start();
    }
    UI.bindNames(() => persistNames());
    const saved = LS.get("names", null);
    if (saved) { UI.setName(0, saved[0] || ""); UI.setName(1, saved[1] || ""); }
    // أزرار ثابتة
    $("#btnSound").onclick = () => { Sfx.resume(); settings.sound = !settings.sound; applySettings(); Sfx.click(); };
    $("#btnMusic").onclick = () => { Sfx.resume(); settings.music = !settings.music; applySettings(); };
    $("#btnGear").onclick = () => { Sfx.resume(); Sfx.click(); UI.toggleTeacher(teacherApi); };
    document.addEventListener("pointerdown", () => Sfx.resume(), { once: true });
    state = Logic.newState(["", ""], settings, Chars.assigned);
    [0, 1].forEach(i => View.placePawn(i, 0));
    View.setActiveTeam(0);
    syncAll(false);
    if (DEBUG) debugTools();
    g.__game = { get state() { return state; }, settings };
    log("جاهز ✅", DEBUG ? "(وضع المعايرة)" : "");
    mainLoop().catch(e => { console.error(e); });
  }
  boot().catch(e => { console.error("فشل الإقلاع", e); document.body.insertAdjacentHTML("beforeend", `<div style="position:fixed;inset:0;z-index:999;background:#300;color:#fff;padding:30px;font:20px sans-serif;direction:rtl">تعذّر تشغيل اللعبة: ${e && e.message}<br>تأكدوا من التشغيل عبر serve.bat (وليس file://) ومن اتصال الإنترنت لتحميل المكتبات.</div>`); });
})(window);
