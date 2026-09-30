/* logic.js — منطق اللعبة فقط (بدون DOM). الحالة كائن واحد قابل للتسلسل (JSON). */
(function (g) {
  "use strict";
  const TILES = g.TILES_DATA;
  const FINISH = TILES.length - 1;

  const CONFIG = {
    finish: FINISH,
    stageThresholds: [0, 3, 6, 9],          // مجموع شفرات الفريقين → مراحل الروبوت 1..4 (5 = الفوز)
    shardsPerLevel: 5,                      // مستوى الفريق = 1 + floor(shards/5)
    rewards: { challenge: 1, hazard: 1, spot: 1, team: 2, tool: 1, battery: 1, comeback: 1, encourage: 1 },
    batteryTile: 12,                        // المرور بالمربع 12 يمنح شفرة (محطة البطارية)
    comebackSteps: 4,
    maxTeamShardsShown: 5
  };

  function randInt(n) {                     // عدد صحيح عشوائي آمن 0..n-1
    const a = new Uint32Array(1);
    const lim = Math.floor(0x100000000 / n) * n;
    do { crypto.getRandomValues(a); } while (a[0] >= lim);
    return a[0] % n;
  }
  function shuffle(arr) {                   // Fisher-Yates
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function newState(names, settings, chars) {
    return {
      v: 1,
      teams: [0, 1].map(i => ({ name: names[i] || "", char: (chars && chars[i]) || null, pos: 0, shards: 0, tools: [], keys: 0, skip: 0, battery: false, answers: 0, correct: 0 })),
      turn: 0, turnCount: 0, extraRoll: false,
      round: 1, robotStage: 1, decks: {}, over: false, winner: null,
      settings: Object.assign({ mode: "teacher", timer: 0, sound: true, eastern: true, music: true }, settings || {})
    };
  }

  /* سحب بلا تكرار حتى تنفد المجموعة ثم إعادة الخلط */
  function draw(state, deck, bank, limit) {
    const lim = Math.min(limit || bank.length, bank.length);
    let d = state.decks[deck];
    if (!d || d.i >= d.order.length || d.lim !== lim) d = state.decks[deck] = { order: shuffle(bank.map((_, i) => i)).slice(0, lim), i: 0, lim };
    return bank[d.order[d.i++]];
  }

  function totalShards(s) { return s.teams[0].shards + s.teams[1].shards; }
  function stageFromShards(total) {
    let st = 1;
    for (let i = 1; i < CONFIG.stageThresholds.length; i++) if (total >= CONFIG.stageThresholds[i]) st = i + 1;
    return st;
  }
  function levelOf(shards) { return 1 + Math.floor(shards / CONFIG.shardsPerLevel); }

  /* إضافة شفرات — تُرجع تغيّر مرحلة الروبوت إن حدث */
  function addShards(state, ti, n) {
    state.teams[ti].shards += n;
    const from = state.robotStage;
    const to = Math.max(from, stageFromShards(totalShards(state)));
    state.robotStage = to;
    return to !== from ? { from, to } : null;
  }

  /* مسار الحركة: مؤشرات المربعات التي يمر بها البيدق (لا يتخطى النهاية) */
  function pathFor(pos, steps) {
    const target = Math.min(FINISH, pos + steps);
    const p = [];
    for (let i = pos + 1; i <= target; i++) p.push(i);
    return p;
  }

  function roundOfTile(i) { return TILES[i].round; }
  function isTrailing(state, ti) { return state.teams[ti].pos < state.teams[1 - ti].pos; }

  /* الممر السري: أول مربع في الجولة التالية (وفي الجولة الأخيرة: المربع قبل البوابة) */
  function shortcutTarget(pos) {
    const r = TILES[pos].round;
    for (let i = pos + 1; i <= FINISH; i++) if (TILES[i].round !== r) return Math.min(i, FINISH - 1);
    return Math.max(pos, FINISH - 1);
  }

  /* خيارات الاختيار التلقائي: الصحيحة + مشتتان منطقيان */
  function makeChoices(n) {
    const pool = [n - 1, n + 1, n - 2, n + 2, n + 10, n - 10, n + 3].filter(v => v >= 0 && v !== n);
    const pick = shuffle(pool).slice(0, 2);
    return shuffle([n, ...pick]);
  }

  function checkWin(state) {
    const t = state.teams[state.turn];
    if (t.pos >= FINISH) { state.over = true; state.winner = state.turn; return true; }
    return false;
  }

  function nextTurn(state) {
    state.turnCount++;
    if (state.extraRoll) { state.extraRoll = false; return state.turn; }
    let next = 1 - state.turn;
    // دور متوقَّف (رياح التوقف)
    if (state.teams[next].skip > 0) { state.teams[next].skip--; next = state.turn; }
    state.turn = next;
    return next;
  }

  g.Logic = { TILES, CONFIG, FINISH, randInt, shuffle, newState, draw, totalShards, stageFromShards, levelOf, addShards, pathFor, roundOfTile, isTrailing, shortcutTarget, makeChoices, checkWin, nextTurn };
})(window);
