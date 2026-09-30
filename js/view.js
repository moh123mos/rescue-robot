/* view.js — مشهد PixiJS v8: الطبقات، الكاميرا، البيادق، الروبوت، الجسيمات، الحركة البيئية.
   المنطق في logic.js؛ هذا الملف للعرض فقط. الإحداثيات كلها بنظام اللوحة 1254×1254. */
(function (g) {
  "use strict";
  const PIXI = g.PIXI, gsap = g.gsap;
  const BOARD = 1254;
  const TILES = g.TILES_DATA;
  const reduced = g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TEAM_COLORS = [0xe43a2a, 0x2f86e6];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const View = { cam: { x: BOARD / 2, y: BOARD / 2, zoom: 1 }, tiles: TILES, ready: false };
  let app, world, hudEl, L = {}, T = {};   // L: layers, T: textures
  let time = 0;
  const pawns = [];          // {root, body, shadow, ring, counter, tile}
  const iconSprites = {};
  let particles = [], pool = [];
  const ambient = { motes: [], leaves: [], flies: [], gold: [] };
  let flags = [], robot = null, robotRise = 0, ropeSprite = null, waterDisp = null, gateGlow = null;
  let robotBase = { x: 440, y: 420 };
  let activeTeam = 0, robotStage = 1, blinkT = 3, goldOn = false;

  /* ---------------------------------------------------------------- نسيج مولَّدة برمجياً */
  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    return PIXI.Texture.from(c);
  }
  function rr(x, px, py, w, h, r) { x.beginPath(); x.moveTo(px + r, py); x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r); x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath(); }
  function makeTextures() {
    T.glow = canvasTex(128, 128, (x, w, h) => { const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.4, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, w, h); });
    T.dot = canvasTex(32, 32, (x, w, h) => { const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(.6, "rgba(255,255,255,.8)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, w, h); });
    T.star = canvasTex(48, 48, (x) => { x.translate(24, 24); x.fillStyle = "#fff"; x.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 22, a = i * Math.PI / 5 - Math.PI / 2; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); } x.closePath(); x.fill(); });
    T.shadow = canvasTex(96, 40, (x, w, h) => { x.translate(w / 2, h / 2); x.scale(1, h / w); const gr = x.createRadialGradient(0, 0, 0, 0, 0, w / 2); gr.addColorStop(0, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = gr; x.fillRect(-w / 2, -w / 2, w, w); });
    T.leaf = canvasTex(24, 14, (x) => { x.fillStyle = "#6bb83a"; x.beginPath(); x.ellipse(12, 7, 11, 5, 0, 0, 7); x.fill(); x.strokeStyle = "#3d7a1c"; x.lineWidth = 1; x.beginPath(); x.moveTo(2, 7); x.lineTo(22, 7); x.stroke(); });
    T.noise = canvasTex(256, 256, (x, w, h) => {
      x.fillStyle = "#808080"; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) { const px = Math.random() * w, py = Math.random() * h, r = 14 + Math.random() * 36, v = Math.random() > .5 ? 255 : 0; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { const gr = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r); gr.addColorStop(0, `rgba(${v},${v},${v},.5)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); x.fillStyle = gr; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2); } }
    });
    T.noise.source.addressMode = "repeat";
    T.pawn = [pawnTex(0), pawnTex(1)];
  }
  /* بيدق بطارية ثلاثي الأبعاد: 0 = حمراء (شعلة)، 1 = زرقاء (برق) */
  function pawnTex(team) {
    const main = team === 0 ? ["#ff6a55", "#e0281a", "#8f0f08"] : ["#63b4ff", "#1f79e0", "#0c3f8f"];
    return canvasTex(96, 150, (x) => {
      const W = 96;
      // جسم البطارية
      const gr = x.createLinearGradient(14, 0, 82, 0); gr.addColorStop(0, main[0]); gr.addColorStop(.45, main[1]); gr.addColorStop(1, main[2]);
      rr(x, 14, 30, 68, 106, 20); x.fillStyle = gr; x.fill(); x.lineWidth = 4; x.strokeStyle = "#1a1a2e"; x.stroke();
      // قطب علوي
      const sg = x.createLinearGradient(0, 8, 0, 34); sg.addColorStop(0, "#f4f6fb"); sg.addColorStop(1, "#9aa3b8");
      rr(x, 31, 8, 34, 28, 8); x.fillStyle = sg; x.fill(); x.lineWidth = 4; x.stroke();
      // حزام سفلي
      x.save(); rr(x, 14, 30, 68, 106, 20); x.clip(); x.fillStyle = "rgba(0,0,0,.22)"; x.fillRect(14, 112, 68, 30);
      x.fillStyle = "rgba(255,255,255,.55)"; rr(x, 20, 44, 11, 70, 6); x.fill(); x.restore();
      // لوحة الرمز
      x.fillStyle = "rgba(255,255,255,.95)"; x.beginPath(); x.ellipse(50, 84, 27, 29, 0, 0, 7); x.fill(); x.lineWidth = 3; x.strokeStyle = "rgba(0,0,0,.25)"; x.stroke();
      if (team === 1) { // برق
        x.fillStyle = "#ffcf1a"; x.strokeStyle = "#b07800"; x.lineWidth = 2.5; x.beginPath();
        [[55, 58], [37, 88], [48, 88], [42, 112], [63, 79], [51, 79]].forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.fill(); x.stroke();
      } else {           // شعلة
        const fg = x.createLinearGradient(0, 58, 0, 112); fg.addColorStop(0, "#ffd21f"); fg.addColorStop(1, "#ff4a12");
        x.fillStyle = fg; x.strokeStyle = "#a82a08"; x.lineWidth = 2.5; x.beginPath();
        x.moveTo(50, 58); x.bezierCurveTo(60, 72, 70, 80, 66, 96); x.bezierCurveTo(63, 110, 37, 112, 34, 96); x.bezierCurveTo(32, 86, 40, 82, 42, 72); x.bezierCurveTo(46, 78, 46, 82, 50, 84); x.bezierCurveTo(52, 76, 48, 66, 50, 58); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = "#fff3a0"; x.beginPath(); x.ellipse(50, 100, 8, 9, 0, 0, 7); x.fill();
      }
    });
  }

  /* ---------------------------------------------------------------- تهيئة */
  View.init = async function (host, hud) {
    hudEl = hud;
    app = new PIXI.Application();
    await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: false, resolution: Math.min(2, g.devicePixelRatio || 1), autoDensity: true, powerPreference: "high-performance" });
    host.appendChild(app.canvas);
    app.canvas.style.touchAction = "none";
    View.app = app;

    const files = ["board", "pit_robot", "pit_clean", "pit_front", "rope_hang", "water", "gate_robot", "gate_clean", "flag_left", "flag_right", "gate_full", ...[1, 2, 3, 4, 5].map(i => "stage_" + i), ...TILES.filter(t => t.i > 0 && t.i < 20).map(t => "icon_" + t.i)];
    await Promise.all(files.map(f => PIXI.Assets.load({ alias: f, src: `assets/${f}.png`, data: { autoGenerateMipmaps: f === "board", scaleMode: "linear" } })));
    files.forEach(f => { T[f] = PIXI.Assets.get(f); });
    makeTextures();

    world = new PIXI.Container(); app.stage.addChild(world);
    for (const n of ["bg", "ambient", "pit", "tilesFx", "gate", "shadows", "pawns", "particles", "debug"]) { L[n] = new PIXI.Container(); world.addChild(L[n]); }
    L.pawns.sortableChildren = true;

    L.bg.addChild(new PIXI.Sprite(T.board));
    buildPit(); buildGate(); buildAmbient(); buildTileIcons(); buildPawns();
    app.ticker.add(tick);
    app.canvas.addEventListener("pointermove", e => { View.pointer = View.clientToWorld(e.clientX, e.clientY); });
    app.canvas.addEventListener("pointerleave", () => { View.pointer = null; });
    g.addEventListener("resize", applyCamera);
    applyCamera();
    View.ready = true;
  };

  /* ---------------------------------------------------------------- الكاميرا */
  function applyCamera() {
    if (!app) return;
    const W = app.screen.width, H = app.screen.height;
    const fit = Math.min(W, H) / BOARD, s = fit * View.cam.zoom;
    let px = W / 2 - View.cam.x * s, py = H / 2 - View.cam.y * s;
    const bw = BOARD * s;
    px = bw >= W ? clamp(px, W - bw, 0) : (W - bw) / 2;
    py = bw >= H ? clamp(py, H - bw, 0) : (H - bw) / 2;
    world.position.set(px, py); world.scale.set(s);
    const tf = `translate(${px}px,${py}px) scale(${s})`;
    if (hudEl && hudEl._tf !== tf) { hudEl.style.transform = tf; hudEl._tf = tf; }
    View.scale = s; View.offset = { x: px, y: py };
  }
  View.camTo = function (x, y, zoom = 1.5, dur = .6, ease = "power2.inOut") {
    return new Promise(res => gsap.to(View.cam, { x, y, zoom, duration: reduced ? Math.min(dur, .15) : dur, ease, overwrite: true, onComplete: res, onInterrupt: res }));
  };
  View.camHome = (dur = .7) => View.camTo(BOARD / 2, BOARD / 2, 1, dur);
  View.camFollow = function (x, y, dur = .4) {
    if (reduced) return View.camTo(x, y, 1.15, dur);
    return View.camTo(x, y - 20, 1.5, dur, "power2.out");
  };
  View.clientToWorld = (cx, cy) => { const r = app.canvas.getBoundingClientRect(); return { x: (cx - r.left - View.offset.x) / View.scale, y: (cy - r.top - View.offset.y) / View.scale }; };
  View.worldToClient = (x, y) => { const r = app.canvas.getBoundingClientRect(); return { x: r.left + View.offset.x + x * View.scale, y: r.top + View.offset.y + y * View.scale }; };
  View.worldRect = (x, y, w = 40, h = 40) => { const p = View.worldToClient(x, y); return { left: p.x - w * View.scale / 2, top: p.y - h * View.scale / 2, width: w * View.scale, height: h * View.scale }; };

  /* ---------------------------------------------------------------- الحفرة والروبوت */
  function buildPit() {
    const clean = new PIXI.Sprite(T.pit_clean); clean.position.set(440, 420); L.pit.addChild(clean);
    robot = new PIXI.Container(); L.pit.addChild(robot);
    const spr = new PIXI.Sprite(T.pit_robot); spr.anchor.set(0.5, 1);
    robot.pivotBase = { x: 440 + 130, y: 420 + 196 };           // أسفل منتصف الروبوت
    robot.position.set(robot.pivotBase.x, robot.pivotBase.y);
    spr.position.set(0, 0); robot.addChild(spr); robot.spr = spr;
    // عينان: غطاء رمش (بلون الشاشة الداكنة)
    const lidCol = 0x0f1a38;
    robot.lids = [[567, 486], [607, 508]].map(([wx, wy]) => {
      const lid = new PIXI.Graphics().ellipse(0, 0, 25, 27).fill(lidCol);
      lid.position.set(wx - robot.pivotBase.x, wy - robot.pivotBase.y); lid.scale.y = 0; robot.addChild(lid); return lid;
    });
    // وميض الأنتين
    robot.lights = [[582, 446, 0xffc83a], [643, 481, 0xffc83a]].map(([wx, wy, c]) => {
      const s = new PIXI.Sprite(T.glow); s.anchor.set(.5); s.tint = c; s.blendMode = "add"; s.width = s.height = 44;
      s.position.set(wx - robot.pivotBase.x, wy - robot.pivotBase.y); robot.addChild(s); return s;
    });
    const front = new PIXI.Sprite(T.pit_front); front.position.set(440, 572); L.pit.addChild(front);
    ropeSprite = new PIXI.Sprite(T.rope_hang); ropeSprite.anchor.set(0.35, 0); ropeSprite.position.set(498 + 74 * .35, 352); L.pit.addChild(ropeSprite);
    ropeSprite.restH = T.rope_hang.height;
  }
  function robotPose() {
    // مرحلة الارتفاع + تنفّس + ميلان
    const br = 1 + Math.sin(time * 1.9) * .015, tilt = Math.sin(time * .8) * .022;
    robot.position.set(robot.pivotBase.x, robot.pivotBase.y + robotRise.y);
    robot.scale.set(robotRise.s * (1 + (br - 1) * .5), robotRise.s * br);
    robot.rotation = tilt + robotRise.r;
    robot.lights.forEach((l, i) => { l.alpha = .35 + .65 * (.5 + .5 * Math.sin(time * 5 + i * 2)); });
    blinkT -= app.ticker.deltaMS / 1000;
    if (blinkT < 0) { blinkT = rnd(2.2, 4.6); if (!robot.blinking) { robot.blinking = true; const tl = gsap.timeline({ onComplete: () => { robot.blinking = false; } }); robot.lids.forEach(l => tl.to(l.scale, { y: 1, duration: .07 }, 0).to(l.scale, { y: 0, duration: .1, delay: .06 }, .07)); } }
    // الحبل: يتأرجح ويقصر مع الصعود
    const rise = -robotRise.y, rest = ropeSprite.restH;
    ropeSprite.rotation = Math.sin(time * 1.1) * .045 + Math.sin(time * 2.3) * .012 + robotRise.shake;
    ropeSprite.scale.y = Math.max(.3, (rest - rise * .55) / rest);
    if (Math.random() < .012 && !reduced) sparkAt(robot.pivotBase.x + rnd(-40, 40), robot.pivotBase.y + robotRise.y - rnd(40, 110), { n: 3, color: 0xffe066, speed: 40, life: .5, size: .35, tex: "star", gravity: 60 });
  }
  robotRise = { y: 0, s: 1, r: 0, shake: 0 };

  const STAGE_POSE = [
    { y: 0, s: 1, r: 0 }, { y: -26, s: .985, r: -.03 }, { y: -58, s: .95, r: .03 }, { y: -96, s: .9, r: -.02 }
  ];
  View.setRobotPose = function (n) { robotStage = n; gsap.killTweensOf(robotRise); Object.assign(robotRise, STAGE_POSE[Math.min(3, n - 1)], { shake: 0 }); };
  View.refreshTile = function (i) { const s = iconSprites[i]; if (s) s.position.set(TILES[i].x, TILES[i].y - 18); };
  View.resetRobot = function () {
    robotStage = 1; gsap.killTweensOf(robotRise); Object.assign(robotRise, STAGE_POSE[0], { shake: 0 });
    if (robot) { robot.visible = true; robot.alpha = 1; }
    if (L.gate) { gsap.killTweensOf(gateGlow); gateGlow.base = 0; if (View.gateRobot) { gsap.killTweensOf(View.gateRobot); View.gateRobot.visible = false; } goldOn = false; flags.forEach(f => { f.amp = 1; }); }
    if (robot) { robot.pivotBase.x = 570; robot.pivotBase.y = 616; robot.rotation = 0; }
  };
  /* مشهد ارتفاع الروبوت عند تغيّر المرحلة (سينمائي، قابل للتخطي عبر timeScale) */
  View.robotStage = async function (n) {
    const pose = STAGE_POSE[n - 1]; robotStage = n;
    const cx = 566, cy = 500;
    await View.camTo(cx, cy, reduced ? 1.2 : 1.75, .8);
    g.Sfx.engine(2.2);
    // شدّ الحبل + اهتزاز + غبار يتساقط
    const tl = gsap.timeline();
    tl.to(robotRise, { shake: .09, duration: .08, yoyo: true, repeat: reduced ? 0 : 11, ease: "sine.inOut" }, 0)
      .to(robotRise, { y: pose.y, s: pose.s, r: pose.r, duration: 1.6, ease: "power2.inOut" }, .3)
      .to(robotRise, { shake: 0, duration: .2 }, ">");
    const dustT = setInterval(() => { for (let i = 0; i < 2; i++) dustAt(rnd(470, 690), rnd(412, 440), { fall: true }); }, 90);
    // صورة المرحلة من الشريط السفلي: تطير للحفرة بتوهج ثم تتلاشى (cross-fade)
    const ph = stagePhoto(n); L.particles.addChild(ph);
    const box = g.STAGE_BOXES[n - 1];
    ph.position.set(box.x + box.w / 2, box.y + 50); ph.scale.set(.55); ph.alpha = 0; ph.rotation = -.1;
    tl.to(ph, { alpha: 1, duration: .25 }, .4)
      .to(ph, { x: 790, y: 470, rotation: .06, duration: .7, ease: "power2.out" }, .4)
      .to(ph.scale, { x: 1.75, y: 1.75, duration: .7, ease: "back.out(1.4)" }, .4)
      .to(ph, { alpha: 0, duration: .5, delay: .9 }, ">");
    flashGlow(robot.pivotBase.x, robot.pivotBase.y + pose.y - 70, 0xfff2a0, 230, .9);
    await new Promise(r => tl.eventCallback("onComplete", r));
    clearInterval(dustT); ph.destroy({ children: true });
    sparkAt(robot.pivotBase.x, robot.pivotBase.y + pose.y - 60, { n: 18, color: 0xffe066, speed: 160, life: .8, size: .5, tex: "star", gravity: 120 });
    await View.camHome(.8);
  };
  function stagePhoto(n) {
    const c = new PIXI.Container();
    const t = T["stage_" + n], w = t.width + 8, h = t.height + 8;
    const frame = new PIXI.Graphics().roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 8).fill(0xffffff).stroke({ width: 3, color: 0xffc72c });
    const s = new PIXI.Sprite(t); s.anchor.set(.5); c.addChild(frame, s);
    const glow = new PIXI.Sprite(T.glow); glow.anchor.set(.5); glow.blendMode = "add"; glow.tint = 0xffe066; glow.width = w * 2; glow.height = h * 2; c.addChildAt(glow, 0);
    return c;
  }

  /* ---------------------------------------------------------------- البوابة والأعلام */
  function buildGate() {
    const clean = new PIXI.Sprite(T.gate_clean); clean.position.set(1070, 744); L.gate.addChild(clean);
    gateGlow = new PIXI.Sprite(T.glow); gateGlow.anchor.set(.5); gateGlow.blendMode = "add"; gateGlow.tint = 0xffd54a; gateGlow.width = 330; gateGlow.height = 360; gateGlow.position.set(1150, 790); gateGlow.alpha = 0; gateGlow.base = 0; L.gate.addChild(gateGlow);
    const gr = new PIXI.Sprite(T.gate_robot); gr.anchor.set(.5, 1); gr.position.set(1070 + 82, 744 + 132); gr.visible = false; L.gate.addChild(gr); View.gateRobot = gr;
    flags = [["flag_left", 950, 655, .62], ["flag_right", 1196, 655, .9]].map(([k, x, y, pole]) => makeFlag(T[k], x, y, pole));
  }
  function makeFlag(tex, x, y, pole) {
    try {
      const mesh = new PIXI.MeshPlane({ texture: tex, verticesX: 12, verticesY: 8 });
      mesh.position.set(x, y); L.gate.addChild(mesh);
      const buf = mesh.geometry.getBuffer("aPosition"); const orig = Float32Array.from(buf.data);
      return { mesh, buf, orig, w: tex.width, h: tex.height, pole, amp: 1 };
    } catch (e) {
      console.warn("MeshPlane غير متاح، استخدام skew بديل", e);
      const s = new PIXI.Sprite(tex); s.position.set(x, y); L.gate.addChild(s); return { sprite: s, amp: 1 };
    }
  }
  function updateFlags() {
    for (const f of flags) {
      if (f.sprite) { f.sprite.skew.y = Math.sin(time * 3) * .02 * f.amp; continue; }
      const d = f.buf.data, o = f.orig;
      for (let i = 0; i < o.length; i += 2) {
        const u = o[i] / f.w, w = clamp((f.pole - u) / f.pole, 0, 1) ** 1.3;
        d[i] = o[i] + Math.cos(time * 3.2 + u * 7) * 2 * w * f.amp;
        d[i + 1] = o[i + 1] + Math.sin(time * 3.6 + u * 8) * 3.6 * w * f.amp;
      }
      f.buf.update();
    }
  }

  /* ---------------------------------------------------------------- الحياة البيئية */
  function buildAmbient() {
    // ماء متحرك
    const wsp = new PIXI.Sprite(T.water); wsp.position.set(545, 182); L.ambient.addChild(wsp);
    waterDisp = new PIXI.Sprite(T.noise); waterDisp.scale.set(.6); waterDisp.alpha = 0; L.ambient.addChild(waterDisp);
    try { wsp.filters = [new PIXI.DisplacementFilter({ sprite: waterDisp, scale: 7 })]; } catch (e) { console.warn("DisplacementFilter", e); }
    // بريق الماء
    for (let i = 0; i < 9; i++) { const s = new PIXI.Sprite(T.star); s.anchor.set(.5); s.tint = 0xffffff; s.blendMode = "add"; s.position.set(rnd(590, 690), rnd(200, 232)); s.scale.set(.25); s.ph = rnd(0, 6); s.sp = rnd(1.5, 3.5); s.alpha = 0; L.ambient.addChild(s); ambient.motes.push(s); s.kind = "sparkle"; }
    // غبار/ذرّات محيطة
    const nMote = reduced ? 8 : 26;
    for (let i = 0; i < nMote; i++) { const s = new PIXI.Sprite(T.dot); s.anchor.set(.5); s.tint = 0xfff4c8; s.alpha = rnd(.15, .4); s.scale.set(rnd(.15, .4)); s.position.set(rnd(0, BOARD), rnd(0, BOARD)); s.vx = rnd(4, 14); s.vy = rnd(-4, 5); s.ph = rnd(0, 6); L.ambient.addChild(s); ambient.motes.push(s); s.kind = "mote"; }
    // أوراق طائرة
    for (let i = 0; i < (reduced ? 0 : 6); i++) { const s = new PIXI.Sprite(T.leaf); s.anchor.set(.5); s.position.set(rnd(0, BOARD), rnd(-100, BOARD)); s.vx = rnd(18, 34); s.vy = rnd(14, 26); s.ph = rnd(0, 6); s.rot = rnd(1, 3); s.alpha = .85; L.ambient.addChild(s); ambient.leaves.push(s); }
    // فراشات
    for (let i = 0; i < (reduced ? 0 : 3); i++) {
      const c = new PIXI.Container(), col = [0xffa62b, 0xff6fb0, 0x7fd6ff][i];
      const w1 = new PIXI.Graphics().ellipse(-5, 0, 6, 4).fill(col), w2 = new PIXI.Graphics().ellipse(5, 0, 6, 4).fill(col);
      c.addChild(w1, w2); c.w1 = w1; c.w2 = w2; c.cx = rnd(200, 1050); c.cy = rnd(150, 450); c.ph = rnd(0, 6); c.sp = rnd(.25, .5);
      L.ambient.addChild(c); ambient.flies.push(c);
    }
    // ذرّات ذهبية حول البوابة
    for (let i = 0; i < (reduced ? 6 : 16); i++) { const s = new PIXI.Sprite(T.star); s.anchor.set(.5); s.tint = 0xffdd55; s.blendMode = "add"; s.scale.set(rnd(.12, .3)); s.alpha = 0; s.ph = rnd(0, 6); s.x0 = 1150 + rnd(-85, 85); s.y0 = 790 + rnd(-110, 100); L.ambient.addChild(s); ambient.gold.push(s); }
  }
  function updateAmbient(dt) {
    waterDisp.x += 12 * dt; waterDisp.y += 5 * dt;
    for (const s of ambient.motes) {
      if (s.kind === "sparkle") { s.alpha = Math.max(0, Math.sin(time * s.sp + s.ph)) ** 3 * .9; s.rotation += dt; continue; }
      s.x += (s.vx + Math.sin(time * .6 + s.ph) * 6) * dt; s.y += (s.vy + Math.cos(time * .5 + s.ph) * 5) * dt;
      if (s.x > BOARD + 10) s.x = -10; if (s.y > BOARD + 10) s.y = -10; if (s.y < -10) s.y = BOARD + 10;
    }
    for (const s of ambient.leaves) {
      s.x += (s.vx + Math.sin(time + s.ph) * 14) * dt; s.y += s.vy * dt; s.rotation += s.rot * dt; s.scale.y = Math.cos(time * 3 + s.ph);
      if (s.x > BOARD + 20 || s.y > BOARD + 20) { s.x = rnd(-60, 400); s.y = rnd(-60, 100); }
    }
    for (const f of ambient.flies) {
      const t = time * f.sp + f.ph;
      f.x = f.cx + Math.sin(t) * 120 + Math.sin(t * 2.3) * 30; f.y = f.cy + Math.cos(t * 1.3) * 60 + Math.sin(t * 3) * 10; f.rotation = Math.cos(t) * .5;
      const fl = Math.abs(Math.sin(time * 14 + f.ph)); f.w1.scale.x = f.w2.scale.x = .3 + fl * .7;
    }
    for (const s of ambient.gold) {
      const k = goldOn ? 1 : 0; const t = (time * .35 + s.ph) % 1;
      s.alpha = k * Math.sin(t * Math.PI) * .85; s.x = s.x0 + Math.sin(time + s.ph) * 8; s.y = s.y0 - t * 50; s.rotation = time + s.ph;
    }
    gateGlow.alpha = (gateGlow.base || 0) * (.82 + .18 * Math.sin(time * 3));
  }

  /* ---------------------------------------------------------------- أيقونات المربعات (تموّج) + ضغط المربع */
  function buildTileIcons() {
    TILES.filter(t => t.i > 0 && t.i < 20).forEach(t => {
      const s = new PIXI.Sprite(T["icon_" + t.i]); s.anchor.set(.5); s.position.set(t.x, t.y - 18); s.ph = t.i * .9; L.tilesFx.addChild(s); iconSprites[t.i] = s;
    });
  }
  function updateIcons() {
    for (const k in iconSprites) { const s = iconSprites[k]; if (s.pressing) continue; const w = 1.03 + Math.sin(time * 2.2 + s.ph) * .022; s.scale.set(w, w - Math.sin(time * 2.2 + s.ph + 1) * .012); s.rotation = Math.sin(time * 1.6 + s.ph) * .03; }
  }
  View.pressTile = function (i) {
    const t = TILES[i], s = iconSprites[i];
    flashGlow(t.x, t.y - 6, 0xffffff, 120, .75);
    if (!s) return;
    s.pressing = true; gsap.killTweensOf(s.scale);
    gsap.timeline({ onComplete: () => { s.pressing = false; } })
      .to(s.scale, { y: .8, x: 1.12, duration: .08, ease: "power2.out" })
      .to(s.scale, { y: 1.06, x: 1.03, duration: .45, ease: "elastic.out(1.4,.35)" });
  };
  function flashGlow(x, y, color, size, alpha) {
    const s = new PIXI.Sprite(T.glow); s.anchor.set(.5); s.tint = color; s.blendMode = "add"; s.position.set(x, y); s.width = s.height = size * .6; s.alpha = alpha;
    L.tilesFx.addChild(s);
    gsap.to(s, { width: size * 1.6, height: size * 1.6, alpha: 0, duration: .6, ease: "power2.out", onComplete: () => s.destroy() });
  }
  View.flash = flashGlow;

  /* ---------------------------------------------------------------- البيادق */
  function buildPawns() {
    [0, 1].forEach(ti => {
      const shadow = new PIXI.Sprite(T.shadow); shadow.anchor.set(.5); L.shadows.addChild(shadow);
      const ring = new PIXI.Sprite(T.glow); ring.anchor.set(.5); ring.blendMode = "add"; ring.tint = TEAM_COLORS[ti]; ring.width = 120; ring.height = 70; L.shadows.addChild(ring);
      const root = new PIXI.Container(); L.pawns.addChild(root);
      const body = new PIXI.Sprite(T.pawn[ti]); body.anchor.set(.5, .97); body.scale.set(.46); root.addChild(body);
      body.eventMode = "static"; body.cursor = "pointer"; body.on("pointertap", () => { if (g.Chars && g.Chars.assigned[ti]) g.Chars.poke(ti); });
      const counter = new PIXI.Container();
      const bg = new PIXI.Graphics().circle(0, 0, 17).fill(0x1a1a2e).stroke({ width: 3, color: 0xffc72c });
      const tx = new PIXI.Text({ text: "", style: { fontFamily: "Cairo, sans-serif", fontSize: 24, fontWeight: "900", fill: 0xffffff } }); tx.anchor.set(.5);
      counter.addChild(bg, tx); counter.tx = tx; counter.position.set(0, -92); counter.visible = false; root.addChild(counter);
      pawns.push({ root, body, shadow, ring, counter, tile: 0, gx: 0, gy: 0, h: 0, base: .46, lean: 0, pose: "idle", tex: {} });
    });
    if (g.Chars) g.Chars.hopListeners.push(ti => { const p = pawns[ti]; if (p && !p.moving && p.root.visible) View.jumpInPlace(ti); });
  }

  /* ---------------------------------------------------------------- الشخصيات على المسار */
  const CHAR_BOARD_H = 92;      // ارتفاع إطار الشخصية على اللوحة (px لوحة)
  View.setCharacter = async function (ti, id) {
    const p = pawns[ti], C = g.Chars, m = C && C.meta[id];
    if (!m) return;
    const tex = {};
    await Promise.all(m.poses.map(async pose => { tex[pose] = await PIXI.Assets.load({ alias: `ch_${id}_${pose}`, src: C.url(id, pose, true), data: { autoGenerateMipmaps: true, scaleMode: "linear" } }); }));
    p.tex = tex; p.charId = id; p.base = CHAR_BOARD_H / m.h;
    p.body.texture = tex.idle; p.body.anchor.set(m.cx / m.w, m.baseline / m.h); p.body.scale.set(p.base); p.body.y = 0; p.pose = "idle";
    p.counter.position.set(0, -(m.baseline * .86 * p.base) - 14);
    if (p.unbind) p.unbind();
    p.unbind = C.bind("pawn", ti, (pose) => { if (p.moving && pose === "blink") return; if (p.tex[pose]) { p.pose = pose; p.body.texture = p.tex[pose]; } });
  };
  function slotOffset(ti, tile) {
    const o = pawns[1 - ti]; return o && o.tile === tile && o.placed ? (ti === 0 ? -15 : 15) : 0;
  }
  function tilePt(tile, ti) { const t = TILES[tile]; return { x: t.x + slotOffset(ti, tile), y: t.y + 6 }; }
  function setPawnGround(p, x, y, h = 0) {
    p.gx = x; p.gy = y; p.h = h;
    p.root.position.set(x, y - h); p.root.zIndex = y;
    p.shadow.position.set(x, y + 2); p.ring.position.set(x, y);
    const k = 1 - Math.min(.45, h / 140);
    p.shadow.scale.set(k * .9, k * .9); p.shadow.alpha = .75 * k;
  }
  View.placePawn = function (ti, tile) {
    const p = pawns[ti]; p.tile = tile; p.placed = true;
    const pt = tilePt(tile, ti); setPawnGround(p, pt.x, pt.y);
    View.layoutPawns(false);
  };
  /* إزاحة جانبية عند تشارك المربع */
  View.layoutPawns = function (animate = true) {
    pawns.forEach((p, ti) => {
      if (!p.placed || p.moving) return;
      const pt = tilePt(p.tile, ti);
      if (!animate) setPawnGround(p, pt.x, pt.y);
      else { const pr = { x: p.gx, y: p.gy }; gsap.to(pr, { x: pt.x, y: pt.y, duration: .3, onUpdate: () => setPawnGround(p, pr.x, pr.y) }); }
    });
  };
  View.pawnWorld = ti => ({ x: pawns[ti].gx, y: pawns[ti].gy });
  View.pawnHeight = ti => { const p = pawns[ti], m = g.Chars && g.Chars.meta[p.charId]; return m ? m.baseline * p.base : 80; };
  View.setActiveTeam = function (ti) { activeTeam = ti; };
  View.showCounter = function (ti, n) {
    const c = pawns[ti].counter; if (n == null) { c.visible = false; return; }
    c.visible = true; c.tx.text = g.Num.digits(n); c.scale.set(.4); gsap.to(c.scale, { x: 1, y: 1, duration: .3, ease: "back.out(3)" });
  };
  View.jumpInPlace = function (ti) {
    const p = pawns[ti], b = p.base; if (p.jumping) return Promise.resolve();
    p.jumping = true; const y0 = p.root.y;
    return new Promise(res => gsap.timeline({ onComplete: () => { p.jumping = false; p.root.y = y0; res(); } })
      .to(p.body.scale, { x: b * 1.09, y: b * .83, duration: .08 })
      .to(p.body.scale, { x: b * .91, y: b * 1.13, duration: .1 })
      .to(p.root, { y: y0 - 34, duration: .2, ease: "power2.out" }, "<")
      .to(p.root, { y: y0, duration: .2, ease: "bounce.out" })
      .to(p.body.scale, { x: b, y: b, duration: .2, ease: "elastic.out(1.2,.4)" }, "<.1"));
  };

  /* حركة أساسية: تتبع مسار أرضي (MotionPath) + ارتفاع قوس + تمدد/ضغط + ظل + غبار */
  function moveAlong(ti, pts, o = {}) {
    const p = pawns[ti]; p.moving = true;
    const dur = (reduced ? .7 : 1) * (o.dur || .36), H = o.height == null ? 40 : o.height;
    const proxy = { x: pts[0].x, y: pts[0].y, t: 0 };
    const base = p.base;
    if (g.Chars && g.Chars.assigned[ti]) g.Chars.pose(ti, "jump", 0, ["pawn"]);
    return new Promise(resolve => {
      const tl = gsap.timeline({ onComplete: () => { p.moving = false; if (g.Chars && g.Chars.assigned[ti]) g.Chars.pose(ti, "idle", 0, ["pawn"]); resolve(); } });
      if (o.squash !== false) tl.to(p.body.scale, { x: base * 1.18, y: base * .78, duration: .07, ease: "power2.out" });
      const t0 = tl.duration();
      tl.to(p.body.scale, { x: base * .86, y: base * 1.2, duration: .1, ease: "power1.out" }, t0);
      tl.to(proxy, { t: 1, duration: dur, ease: o.ease || "none", onUpdate: () => { setPawnGround(p, proxy.x, proxy.y, Math.sin(Math.PI * proxy.t) * H); if (o.trail) trailAt(p.gx, p.gy - p.h - 22, o.trail); } }, t0);
      if (pts.length > 2) tl.to(proxy, { motionPath: { path: pts.map(q => ({ x: q.x, y: q.y })), curviness: 1.15 }, duration: dur, ease: o.ease || "none" }, t0);
      else tl.to(proxy, { x: pts[1].x, y: pts[1].y, duration: dur, ease: o.ease || "none" }, t0);
      tl.to(p.body.scale, { x: base, y: base, duration: dur * .6, ease: "sine.inOut" }, t0 + .1);
      const end = pts[pts.length - 1];
      tl.call(() => { // هبوط
        setPawnGround(p, end.x, end.y, 0);
        if (o.land !== false) {
          dustAt(end.x, end.y + 2, { n: 7 }); sparkAt(end.x, end.y - 6, { n: 5, color: 0xffe066, speed: 110, life: .45, size: .3, tex: "star", gravity: 200 });
          if (o.tile != null) View.pressTile(o.tile);
          g.Sfx.land();
        }
      });
      tl.to(p.body.scale, { x: base * 1.2, y: base * .8, duration: .06 });
      tl.to(p.body.scale, { x: base, y: base, duration: .3, ease: "elastic.out(1.3,.4)" });
    });
  }
  /* قفزة مربع واحد (تمر بنقاط الطريق إن وُجدت) */
  View.hop = async function (ti, from, to, step, o = {}) {
    const p = pawns[ti], tt = TILES[to];
    p.tile = to; p.placed = true;
    const a = { x: p.gx, y: p.gy }, b = tilePt(to, ti);
    let mid = (tt.via || []).map(v => ({ x: v[0], y: v[1] + 6 })), h = o.height == null ? 38 : o.height, dur = o.dur || .36;
    if (tt.leap && to === from + 1) { mid = tt.leap.map(v => ({ x: v[0], y: v[1] })); h = 70; dur = .9; }
    const len = [a, ...mid, b].reduce((s, q, i, arr) => i ? s + Math.hypot(q.x - arr[i - 1].x, q.y - arr[i - 1].y) : 0, 0);
    dur = Math.max(dur, .3 + len / 1300) * (o.fast ? .8 : 1);
    if (!o.noFollow) View.camFollow(b.x, b.y, dur + .2);
    g.Sfx.step(step || 0);
    if (step) View.showCounter(ti, step);
    await moveAlong(ti, [a, ...mid, b], { dur, height: h, tile: to, trail: o.trail });
    View.layoutPawns();
  };
  /* انزلاق سريع بأثر خطي عبر عدة مربعات (زلاجة) */
  View.slide = async function (ti, path) {
    const p = pawns[ti], pts = [{ x: p.gx, y: p.gy }];
    path.forEach(i => { (TILES[i].via || []).forEach(v => pts.push({ x: v[0], y: v[1] + 6 })); pts.push(tilePt(i, ti)); });
    p.tile = path[path.length - 1]; p.placed = true;
    const end = pts[pts.length - 1]; View.camFollow(end.x, end.y, .9);
    g.Sfx.whoosh();
    await moveAlong(ti, pts, { dur: .75 + path.length * .1, height: 10, trail: { color: 0x9be7ff, size: .5 }, ease: "power2.inOut", land: true, tile: p.tile });
    View.layoutPawns();
  };
  /* نفق: يغوص ثم يظهر عند الهدف */
  View.tunnel = async function (ti, to) {
    const p = pawns[ti], tt = TILES[to];
    g.Sfx.magic();
    const hole = new PIXI.Graphics().ellipse(0, 0, 34, 14).fill(0x0b0b12).stroke({ width: 4, color: 0x5a3a1a }); hole.position.set(p.gx, p.gy + 4); hole.scale.set(0); L.tilesFx.addChild(hole);
    await new Promise(res => gsap.timeline({ onComplete: res }).to(hole.scale, { x: 1, y: 1, duration: .25, ease: "back.out(2)" })
      .to(p.body.scale, { x: .05, y: .05, duration: .4, ease: "power2.in" }, ">.1").to(p.root, { y: p.root.y + 10, duration: .4 }, "<"));
    hole.destroy(); p.root.visible = false; p.shadow.visible = false; p.ring.visible = false;
    await View.camTo(tt.x, tt.y, 1.3, .6);
    const pt = tilePt(to, ti); p.tile = to; p.placed = true; setPawnGround(p, pt.x, pt.y);
    const hole2 = new PIXI.Graphics().ellipse(0, 0, 34, 14).fill(0x0b0b12).stroke({ width: 4, color: 0x5a3a1a }); hole2.position.set(pt.x, pt.y + 4); hole2.scale.set(0); L.tilesFx.addChild(hole2);
    gsap.to(hole2.scale, { x: 1, y: 1, duration: .25, ease: "back.out(2)" });
    p.root.visible = true; p.shadow.visible = true; p.ring.visible = true; p.body.scale.set(.05);
    sparkAt(pt.x, pt.y - 10, { n: 16, color: 0xc9a0ff, speed: 150, life: .7, size: .4, tex: "star", gravity: 60 });
    await new Promise(res => gsap.timeline({ onComplete: res }).to(p.body.scale, { x: p.base * 1.2, y: p.base * 1.2, duration: .35, ease: "back.out(3)" }).to(p.body.scale, { x: p.base, y: p.base, duration: .2 }));
    gsap.to(hole2.scale, { x: 0, y: 0, duration: .25, onComplete: () => hole2.destroy() });
    View.pressTile(to); View.layoutPawns();
  };
  View.batteryFlash = function () {
    const b = g.BATTERY_SPOT; flashGlow(b.x, b.y, 0x7fe0ff, 200, 1); g.Sfx.magic();
    sparkAt(b.x, b.y, { n: 16, color: 0x7fe0ff, speed: 140, life: .7, size: .4, tex: "star", gravity: 80 });
  };

  /* ---------------------------------------------------------------- الجسيمات */
  function getP() { return pool.pop() || (() => { const s = new PIXI.Sprite(T.dot); s.anchor.set(.5); return s; })(); }
  function emit(x, y, o) {
    const s = getP(); s.texture = o.tex === "star" ? T.star : T.dot; s.tint = o.color; s.blendMode = o.add ? "add" : "normal";
    const a = o.ang != null ? o.ang : rnd(0, Math.PI * 2), sp = rnd(.4, 1) * (o.speed || 60);
    s.position.set(x, y); s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp; s.g = o.gravity || 0; s.life = s.max = o.life || .5; s.s0 = (o.size || .4) * rnd(.7, 1.2); s.grow = o.grow || 0; s.alpha = 1; s.rot = rnd(-4, 4);
    s.scale.set(s.s0); s.visible = true; L.particles.addChild(s); particles.push(s);
  }
  function dustAt(x, y, o = {}) {
    const n = Math.round((o.n || 6) * (reduced ? .4 : 1));
    for (let i = 0; i < n; i++) emit(x + rnd(-8, 8), y, { color: 0xd9c49a, speed: 50, ang: o.fall ? Math.PI / 2 + rnd(-.3, .3) : rnd(Math.PI, Math.PI * 2), gravity: o.fall ? 120 : -20, life: o.fall ? .9 : rnd(.35, .6), size: o.fall ? .25 : .5, grow: o.fall ? 0 : 1.4 });
  }
  function sparkAt(x, y, o = {}) {
    const n = Math.round((o.n || 6) * (reduced ? .4 : 1));
    for (let i = 0; i < n; i++) emit(x, y, Object.assign({ add: true }, o));
  }
  function trailAt(x, y, o) { if (Math.random() < .85) emit(x + rnd(-5, 5), y + rnd(-8, 8), { color: o.color || 0xffffff, speed: 20, life: .45, size: o.size || .35, add: true, tex: "dot", grow: -.3, ang: Math.PI }); }
  View.burstAt = (x, y, o) => sparkAt(x, y, o);
  View.dustAt = dustAt;
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const s = particles[i]; s.life -= dt;
      if (s.life <= 0) { s.visible = false; L.particles.removeChild(s); pool.push(s); particles.splice(i, 1); continue; }
      const k = s.life / s.max;
      s.vy += s.g * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.alpha = Math.min(1, k * 1.6); s.rotation += s.rot * dt;
      s.scale.set(s.s0 * (1 + s.grow * (1 - k)) * (s.texture === T.star ? (.4 + k * .6) : 1));
    }
  }

  /* ---------------------------------------------------------------- مشهد الفوز */
  View.winScene = async function (ti) {
    g.Sfx.engine(2.4);
    await View.camTo(566, 480, reduced ? 1.2 : 1.7, .8);
    const tl = gsap.timeline();
    tl.to(robotRise, { shake: .08, duration: .08, yoyo: true, repeat: reduced ? 0 : 9 }, 0)
      .to(robotRise, { y: -150, s: .85, r: 0, duration: 1.3, ease: "power2.inOut" }, .2)
      .to(robotRise, { shake: 0, duration: .2 }, ">");
    const dustT = setInterval(() => { for (let i = 0; i < 2; i++) dustAt(rnd(470, 690), rnd(412, 440), { fall: true }); }, 90);
    await new Promise(r => tl.eventCallback("onComplete", r)); clearInterval(dustT);
    // يقفز من الحفرة في قوس نحو البوابة
    g.Sfx.whoosh();
    const start = { x: robot.x, y: robot.y }, gate = { x: 1152, y: 876 };
    const proxy = { x: start.x, y: start.y };
    View.camTo(840, 560, 1.15, 1.6);
    gsap.to(robotRise, { s: .5, duration: 1.5, ease: "power1.in" });
    await new Promise(res => gsap.to(proxy, {
      duration: 1.5, ease: "power1.inOut", motionPath: { path: [{ x: start.x, y: start.y }, { x: 820, y: 250 }, { x: gate.x, y: gate.y }], curviness: 1.3 },
      onUpdate: () => { robot.pivotBase.x = proxy.x; robot.pivotBase.y = proxy.y; robotRise.y = 0; robot.rotation = Math.sin(time * 18) * .05; trailAt(proxy.x, proxy.y - 40, { color: 0xfff0a0, size: .55 }); },
      onComplete: res
    }));
    robot.visible = false;
    View.gateRobot.visible = true; View.gateRobot.scale.set(1); goldOn = true;
    g.Sfx.win();
    gsap.to(gateGlow, { base: .9, duration: .6 });
    flags.forEach(f => gsap.to(f, { amp: 2.4, duration: .5 }));
    await View.camTo(1150, 790, 1.6, .7);
    sparkAt(1150, 790, { n: 40, color: 0xffd54a, speed: 240, life: 1.2, size: .6, tex: "star", gravity: 160 });
    // يقفز ويلوّح
    const gr = View.gateRobot;
    gsap.timeline({ repeat: 3 }).to(gr.scale, { x: 1.06, y: .92, duration: .1 }).to(gr, { y: gr.y - 26, duration: .22, ease: "power2.out" }, ">")
      .to(gr.scale, { x: .96, y: 1.08, duration: .22 }, "<").to(gr, { y: 876, duration: .28, ease: "bounce.out" }).to(gr.scale, { x: 1, y: 1, duration: .2 });
    gsap.to(gr, { rotation: .05, duration: .25, yoyo: true, repeat: 11, ease: "sine.inOut" });
    const p = pawns[ti]; View.jumpInPlace(ti);
    await new Promise(r => setTimeout(r, 1300));
  };

  /* ---------------------------------------------------------------- الحلقة الرئيسية */
  function tick(ticker) {
    const dt = Math.min(.05, ticker.deltaMS / 1000); time += dt;
    applyCamera();
    robotPose(); updateFlags(); updateAmbient(dt); updateIcons(); updateParticles(dt);
    pawns.forEach((p, ti) => {
      const act = ti === activeTeam;
      p.ring.alpha = act ? .35 + .3 * (.5 + .5 * Math.sin(time * 4)) : .08; p.ring.width = 110 + (act ? 14 * Math.sin(time * 4) : 0); p.ring.height = p.ring.width * .55;
      if (!p.moving && p.placed) {
        p.body.y = Math.sin(time * 3 + ti * 2) * 1.0 * (act ? 1.5 : 1);
        // ميلان لطيف نحو المؤشر/اللمس عند القرب
        let target = 0;
        if (View.pointer && !reduced) { const dx = View.pointer.x - p.gx, dy = View.pointer.y - p.gy; if (Math.abs(dx) < 230 && dy > -230 && dy < 110) target = clamp(dx / 170, -1, 1) * .09; }
        p.lean += (target - p.lean) * .12; p.body.rotation = p.lean;
      } else p.body.rotation = 0;
    });
  }

  View.layer = n => L[n];
  View.PIXI = PIXI; View.pawns = pawns; View.TEAM_COLORS = TEAM_COLORS;
  g.View = View;
})(window);
