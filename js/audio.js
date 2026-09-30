/* audio.js — أصوات مولَّدة برمجياً (Web Audio). لا ملفات خارجية. تبدأ بعد أول نقرة. */
(function (g) {
  "use strict";
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let muted = false, musicOn = true, musicTimer = null, started = false;

  function ensure() {
    if (ctx) return ctx;
    const AC = g.AudioContext || g.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.7; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
    return ctx;
  }
  function resume() { const c = ensure(); if (c && c.state === "suspended") c.resume(); started = true; }

  /* نغمة بسيطة: تردد، مدة، نوع، حجم، تأخير، انزلاق للتردد */
  function tone(f, dur, type = "sine", vol = 0.3, delay = 0, slideTo = null, dest = null) {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), a = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(a); a.connect(dest || sfxGain);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol = 0.2, delay = 0, freq = 1200, q = 0.8, type = "bandpass") {
    const c = ensure(); if (!c || muted) return;
    const t = c.currentTime + delay;
    const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const a = c.createGain(); a.gain.value = vol;
    s.connect(f); f.connect(a); a.connect(sfxGain); s.start(t);
  }
  const semi = (base, n) => base * Math.pow(2, n / 12);

  const Sfx = {
    resume,
    get muted() { return muted; },
    setMuted(m) { muted = !!m; if (master) master.gain.value = muted ? 0 : 0.9; if (!muted) resume(); },
    click() { tone(660, 0.07, "triangle", 0.18); tone(990, 0.05, "sine", 0.1, 0.03); },
    diceRoll() { for (let i = 0; i < 9; i++) noise(0.06, 0.16, i * 0.085 + Math.random() * 0.02, 600 + Math.random() * 1400, 1.2); },
    diceHit(v = 1) { tone(130, 0.14, "sine", 0.45 * v, 0, 60); noise(0.05, 0.22 * v, 0, 2200, 0.7); },
    step(n = 0) { tone(semi(392, n * 2), 0.11, "triangle", 0.3); tone(semi(392, n * 2) * 2, 0.06, "sine", 0.1, 0.01); },
    land() { tone(180, 0.08, "sine", 0.3, 0, 90); noise(0.05, 0.12, 0, 900, 0.6); },
    flip() { noise(0.14, 0.18, 0, 3500, 0.6, "highpass"); tone(520, 0.12, "triangle", 0.12, 0.02, 820); },
    whoosh() { noise(0.35, 0.16, 0, 900, 0.5, "bandpass"); },
    correct() { [0, 4, 7, 12].forEach((n, i) => tone(semi(523, n), 0.22, "triangle", 0.28, i * 0.09)); },
    wrong() { tone(260, 0.18, "sine", 0.18, 0, 200); tone(220, 0.22, "sine", 0.14, 0.14, 170); },
    shard() { tone(1320, 0.25, "sine", 0.2); tone(1760, 0.35, "sine", 0.14, 0.06); tone(2640, 0.3, "sine", 0.06, 0.12); },
    reveal() { tone(440, 0.1, "triangle", 0.15); tone(660, 0.14, "triangle", 0.15, 0.07); },
    toast() { tone(587, 0.12, "triangle", 0.18); tone(784, 0.2, "triangle", 0.18, 0.1); },
    /* صوت الشخصية: نقرات ناعمة بحسب pitch؛ robot = موجة مربعة + تذبذب */
    voice(pitch = 1, kind = "talk", robot = false) {
      const f0 = 330 * pitch, type = robot ? "square" : "triangle", vol = robot ? .09 : .2;
      const seq = {
        talk:   [[1, .09], [1.22, .08], [.94, .09], [1.12, .08]],
        giggle: [[1.5, .07], [1.25, .07], [1.6, .07], [1.3, .07], [1.7, .09]],
        happy:  [[1, .1], [1.26, .1], [1.5, .16]],
        sad:    [[1.1, .18], [.9, .26]],
        cheer:  [[1, .08], [1.26, .08], [1.5, .08], [2, .2]]
      }[kind] || [[1, .1]];
      let t = 0;
      seq.forEach(([m, d], i) => {
        const slide = robot ? null : (kind === "sad" ? f0 * m * .85 : f0 * m * (1 + (i % 2 ? -.06 : .08)));
        tone(f0 * m, d, type, vol, t, slide);
        if (robot) tone(f0 * m * 2.01, d * .8, "sine", .05, t);
        t += d * .92;
      });
    },
    magic() { [0, 3, 7, 10, 14].forEach((n, i) => tone(semi(659, n), 0.3, "sine", 0.16, i * 0.07)); },
    engine(dur = 2.2) {
      const c = ensure(); if (!c || muted) return;
      const t = c.currentTime, o = c.createOscillator(), a = c.createGain(), f = c.createBiquadFilter();
      o.type = "sawtooth"; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(150, t + dur);
      f.type = "lowpass"; f.frequency.value = 500;
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(0.22, t + 0.3); a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f); f.connect(a); a.connect(sfxGain); o.start(t); o.stop(t + dur + 0.05);
      for (let i = 0; i < dur * 7; i++) noise(0.05, 0.08, i * 0.14, 300 + i * 40, 1);
    },
    win() {
      [0, 4, 7, 12, 7, 12, 16, 19].forEach((n, i) => tone(semi(523, n), 0.3, "triangle", 0.3, i * 0.13));
      [0, 7, 12].forEach((n, i) => tone(semi(262, n), 1.6, "sine", 0.18, 1.1 + i * 0.02));
    },

    /* موسيقى خلفية هادئة: أربعة أوتار متكررة + لحن بسيط */
    music(on) {
      musicOn = on;
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      if (!on || !ensure()) return;
      const chords = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]];
      const mel = [12, 14, 16, 14, 12, 9, 12, 7];
      let bar = 0;
      const play = () => {
        if (muted || !started) return;
        const ch = chords[bar % 4];
        ch.forEach(n => tone(semi(261.6, n), 1.9, "sine", 0.5, 0, null, musicGain));
        for (let i = 0; i < 4; i++) tone(semi(261.6, mel[(bar * 4 + i) % 8] + (ch[0] > 5 ? 0 : 0)), 0.45, "triangle", 0.35, i * 0.5, null, musicGain);
        bar++;
      };
      play();
      musicTimer = setInterval(play, 2000);
    }
  };
  g.Sfx = Sfx;
})(window);
