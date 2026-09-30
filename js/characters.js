/* characters.js — الواجهة الموحّدة للشخصيات التفاعلية.
   - يحمّل meta/الصور، ويخصّص شخصية لكل فريق.
   - يبثّ تغيّر الوضع (pose) لكل مكان يعرض الشخصية (بيدق Pixi، لوحة الدور، الشارة، النوافذ، الفوز).
   - يدير الرمش والتنفّس والكلام (فقاعات + صوت) وردود الفعل واللمس والتنبيه عند الانتظار. */
(function (g) {
  "use strict";
  const reduced = g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const POSES = ["idle", "blink", "talk", "jump", "happy", "sad", "cheer"];
  const rnd = (a, b) => a + Math.random() * (b - a);

  const Chars = {
    list: g.CHARACTERS, byId: {}, meta: {}, assigned: [null, null], POSES,
    ready: false, reduced
  };
  Chars.list.forEach(c => { Chars.byId[c.id] = c; });

  const st = [0, 1].map(() => ({ pose: "idle", holdUntil: 0, talking: false, nextBlink: performance.now() + rnd(1500, 4000), timer: 0, pokes: [], waitSince: 0, lastPhrase: {} }));
  const binds = [];      // {tag, ti, fn}
  const sinks = [];      // [{tag, fn(ti,text,ms,opts)->bool}]  بالأولوية

  /* ---------------------------------------------------------------- تحميل */
  Chars.load = async function () {
    await Promise.all(Chars.list.map(async c => {
      try {
        const m = await (await fetch(`assets/characters/${c.id}/meta.json`)).json();
        Chars.meta[c.id] = m;
        await Promise.all(m.poses.concat(["portrait"]).map(p => new Promise(res => { const im = new Image(); im.onload = im.onerror = res; im.src = Chars.url(c.id, p, true); })));
      } catch (e) { console.warn("[Chars] تعذّر تحميل", c.id, e); }
    }));
    // أزل الشخصيات غير المتاحة
    Chars.list = Chars.list.filter(c => Chars.meta[c.id]);
    Chars.ready = Chars.list.length > 0;
    return Chars.ready;
  };
  Chars.has = (id, pose) => !!(Chars.meta[id] && Chars.meta[id].poses.includes(pose));
  Chars.url = (id, pose, raw) => `assets/characters/${id}/${raw || Chars.has(id, pose) || pose === "portrait" ? pose : "idle"}.png`;
  Chars.get = ti => Chars.byId[Chars.assigned[ti]];
  Chars.poseUrl = (ti, pose) => Chars.url(Chars.assigned[ti], pose);
  Chars.assign = function (ti, id) { Chars.assigned[ti] = id; Chars.emit(ti, st[ti].pose, null); };

  /* ---------------------------------------------------------------- بثّ الأوضاع */
  Chars.bind = function (tag, ti, fn) { const b = { tag, ti, fn }; binds.push(b); return () => { const i = binds.indexOf(b); if (i >= 0) binds.splice(i, 1); }; };
  Chars.unbindTag = tag => { for (let i = binds.length - 1; i >= 0; i--) if (binds[i].tag === tag) binds.splice(i, 1); };
  Chars.emit = function (ti, pose, only) {
    const id = Chars.assigned[ti]; if (!id) return;
    const p = Chars.has(id, pose) ? pose : "idle";
    binds.forEach(b => { if (b.ti === ti && (!only || only.includes(b.tag))) b.fn(p, id); });
  };
  /* ضبط وضع مؤقت يعود إلى idle بعد ms (0 = دائم) */
  Chars.pose = function (ti, pose, ms = 0, only = null) {
    const s = st[ti]; clearTimeout(s.timer); s.pose = pose; s.holdUntil = ms ? performance.now() + ms : 0;
    Chars.emit(ti, pose, only);
    if (ms) s.timer = setTimeout(() => { if (s.pose === pose) { s.pose = "idle"; Chars.emit(ti, "idle", only); } }, ms);
  };
  Chars.currentPose = ti => st[ti].pose;

  /* ---------------------------------------------------------------- الفقاعات */
  Chars.addSink = (tag, fn) => { Chars.removeSink(tag); sinks.push({ tag, fn }); };
  Chars.removeSink = tag => { const i = sinks.findIndex(s => s.tag === tag); if (i >= 0) sinks.splice(i, 1); };
  function phrase(ti, key) {
    const arr = g.PHRASES[key] || []; if (!arr.length) return "";
    const s = st[ti]; let i = Math.floor(Math.random() * arr.length);
    if (arr.length > 1 && i === s.lastPhrase[key]) i = (i + 1) % arr.length;
    s.lastPhrase[key] = i; return arr[i];
  }
  /* يقول عبارة: فقاعة + تحريك الفم + صوت */
  Chars.say = function (ti, key, o = {}) {
    if (!Chars.assigned[ti]) return;
    const text = o.text || phrase(ti, key); if (!text) return;
    const ms = o.ms || Math.max(1600, 900 + text.length * 70);
    for (const s of sinks.slice().reverse()) { if (s.fn(ti, text, ms, o)) break; }
    Chars.talk(ti, ms * .6, o.voice === undefined ? "talk" : o.voice);
  };
  /* تحريك الفم (idle⇄talk) طوال مدة الكلام */
  Chars.talk = function (ti, ms, kind = "talk") {
    const s = st[ti], c = Chars.get(ti); if (!c) return;
    if (kind && g.Sfx) g.Sfx.voice(c.pitch, kind, c.voice === "robot");
    if (s.pose !== "idle" && s.pose !== "talk" && s.pose !== "blink") return;     // لا نقطع happy/sad/cheer
    clearInterval(s.talkIv); s.talking = true;
    const end = performance.now() + ms; let open = false;
    s.talkIv = setInterval(() => {
      if (performance.now() > end || (s.pose !== "idle" && s.pose !== "talk")) { clearInterval(s.talkIv); s.talking = false; if (s.pose === "talk") { s.pose = "idle"; Chars.emit(ti, "idle"); } return; }
      open = !open; s.pose = open ? "talk" : "idle"; Chars.emit(ti, s.pose);
    }, 190);
  };

  /* ---------------------------------------------------------------- ردود الفعل */
  /* kind: happy | sad | cheer | jump | turn | poke */
  Chars.react = function (ti, kind, o = {}) {
    if (!Chars.assigned[ti]) return;
    const c = Chars.get(ti);
    if (kind === "happy") { Chars.pose(ti, "happy", o.ms || 1800); g.Sfx && g.Sfx.voice(c.pitch, "happy", c.voice === "robot"); }
    else if (kind === "sad") { Chars.pose(ti, "sad", o.ms || 1700); g.Sfx && g.Sfx.voice(c.pitch, "sad", c.voice === "robot"); }
    else if (kind === "cheer") { Chars.pose(ti, "cheer", o.ms || 4000); g.Sfx && g.Sfx.voice(c.pitch, "cheer", c.voice === "robot"); }
    else if (kind === "turn") { Chars.pose(ti, "jump", 420); }
    Chars.hop(ti);
    if (o.say) setTimeout(() => Chars.say(ti, o.say, o.sayOpts), o.sayDelay == null ? 250 : o.sayDelay);
  };
  /* قفزة بصرية في كل العروض (البيدق: jumpInPlace، DOM: CSS) */
  Chars.hopListeners = [];
  Chars.hop = ti => { if (!reduced) Chars.hopListeners.forEach(f => f(ti)); };

  /* لمس الطلاب */
  Chars.poke = function (ti) {
    if (!Chars.assigned[ti]) return;
    const s = st[ti], now = performance.now();
    s.pokes = s.pokes.filter(t => now - t < 3500); s.pokes.push(now);
    const c = Chars.get(ti);
    if (s.pokes.length >= 5) { s.pokes = []; Chars.pose(ti, "sad", 1400); Chars.hop(ti); g.Sfx && g.Sfx.voice(c.pitch, "sad", c.voice === "robot"); Chars.say(ti, "dizzy", { voice: "talk" }); return; }
    Chars.pose(ti, "happy", 1100); Chars.hop(ti);
    g.Sfx && g.Sfx.voice(c.pitch, "giggle", c.voice === "robot");
    Chars.say(ti, "poke", { voice: null });
  };

  /* انتظار رمي النرد: تنبيه لطيف بعد ١٢ ثانية */
  Chars.setWaiting = function (ti, on) { st[ti].waitSince = on ? performance.now() : 0; st[1 - ti].waitSince = 0; };

  /* ---------------------------------------------------------------- حلقة الحياة: رمش + تنبيه */
  Chars.start = function () {
    setInterval(() => {
      const now = performance.now();
      [0, 1].forEach(ti => {
        const s = st[ti]; if (!Chars.assigned[ti]) return;
        if (s.pose === "idle" && !s.talking && now > s.nextBlink) {
          s.nextBlink = now + rnd(2200, 5200);
          s.pose = "blink"; Chars.emit(ti, "blink");
          setTimeout(() => { if (s.pose === "blink") { s.pose = "idle"; Chars.emit(ti, "idle"); } }, 140);
        }
        if (s.waitSince && now - s.waitSince > 12000) { s.waitSince = now; Chars.react(ti, "turn", { say: "nudge" }); }
      });
    }, 120);
  };

  g.Chars = Chars;
})(window);
