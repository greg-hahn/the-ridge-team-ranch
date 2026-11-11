/* The Ridge @ Team Ranch — scroll film
   One fixed canvas. Scroll position is the only clock: nothing here plays on its own.
   Lenis smooths the wheel, GSAP ScrollTrigger maps each scene to its scroll range and
   scrubs the copy, and the canvas paints the frame that scroll position asks for. */
(function () {
  'use strict';

  var root = document.documentElement;
  if (!root.classList.contains('cine')) return;
  if (!window.gsap || !window.ScrollTrigger || !window.Lenis || !window.RIDGE_MEDIA) {
    root.classList.remove('cine'); // fall back to the still-frame page
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  var MEDIA = window.RIDGE_MEDIA;
  var portrait = window.matchMedia('(max-width: 900px) and (orientation: portrait)');
  var variant = portrait.matches ? 'm' : 'd';

  /* ------------------------------------------------------------------
     The journey. Each scene is a <section>; each beat is one clip.
     in / out describe how a beat is joined to its neighbours:
       bloom  light blooms from a doorway or window, the cut happens inside it
       ember  the fire's glow darkens the room and becomes the porch lights
       join   consecutive clips share a photo as end frame and start frame;
              a few percent of overlap hides any difference between the two renders
     Points are [x, y] fractions of the frame, per variant (d desktop, m mobile crop).
     ------------------------------------------------------------------ */
  var PT = MEDIA.points;

  var SCENES = [
    { id: 'arrival', beats: [
      { clip: 'arrival', out: { fx: 'bloom', span: 0.17, zoom: 1.22, at: 'door' } }
    ] },
    { id: 'dining', beats: [
      { clip: 'hall', w: 3.0, in: { fx: 'bloom', span: 0.13, zoom: 1.10, at: 'hallDoor' } },
      { clip: 'tokitchen', w: 2.2, join: 0.05 }
    ] },
    { id: 'kitchen', beats: [
      { clip: 'kitchen', join: 0.04 }
    ] },
    { id: 'living', beats: [
      { clip: 'toliving', w: 1.6, join: 0.06 },
      { clip: 'living', w: 3.0, join: 0.04, out: { fx: 'bloom', span: 0.13, zoom: 1.14, at: 'livingDoor' } }
    ] },
    { id: 'bathroom', beats: [
      { clip: 'bath', in: { fx: 'bloom', span: 0.12, zoom: 1.08, at: 'bathIn' },
                      out: { fx: 'bloom', span: 0.13, zoom: 1.14, at: 'bathWindow' } }
    ] },
    { id: 'bedroom', beats: [
      { clip: 'bed', in: { fx: 'bloom', span: 0.11, zoom: 1.08, at: 'bedWindow' },
                     out: { fx: 'ember', span: 0.15, zoom: 1.25, at: 'fire' } }
    ] },
    { id: 'night', beats: [
      { clip: 'night', z: [1.09, 1.05], in: { fx: 'ember', span: 0.16, zoom: 1.0, at: 'porch' } }
    ] },
    { id: 'mark', beats: [ { clip: 'night', hold: true, z: [1.05, 1.0] } ],
      dim: function (p) { return 0.52 * smooth(0.05, 0.5, p); } },
    { id: 'book', beats: [ { clip: 'night', hold: true } ],
      dim: function (p) { return 0.52 + 0.1 * smooth(0, 0.6, p); } }
  ];

  /* ---------- helpers ---------- */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(a, b, v) { var t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function pad(n) { return ('000' + n).slice(-4); }
  function pt(name) { var p = PT[name]; return p ? p[variant] : [0.5, 0.5]; }

  /* ---------- DOM ---------- */
  var stage = document.querySelector('.stage');
  var canvas = document.getElementById('film');
  var ctx = canvas.getContext('2d', { alpha: false });
  var bar = document.querySelector('.progress i');

  /* ---------- frame stores and loader ---------- */
  var gen = 0, stores = {}, hi = [], lo = [], active = 0, MAX_ACTIVE = 6;
  var dirty = true;

  function Store(name) {
    var info = MEDIA[variant][name];
    this.name = name; this.n = info.n; this.w = info.w; this.h = info.h;
    this.img = new Array(this.n);
    this.st = new Uint8Array(this.n);   // 0 idle, 1 queued, 2 ready, 3 failed
    this.tries = new Uint8Array(this.n);
    this.level = 0;
  }
  Store.prototype.near = function (i) {
    if (this.st[i] === 2) return i;
    for (var d = 1; d < this.n; d++) {
      if (i - d >= 0 && this.st[i - d] === 2) return i - d;
      if (i + d < this.n && this.st[i + d] === 2) return i + d;
    }
    return -1;
  };

  function buildStores() {
    stores = {};
    Object.keys(MEDIA[variant]).forEach(function (k) { stores[k] = new Store(k); });
  }

  function frameUrl(name, i) {
    return 'media/frames/' + variant + '/' + name + '/' + pad(i + 1) + '.webp';
  }

  function enqueue(store, i, urgent) {
    if (store.st[i] !== 0) return;
    store.st[i] = 1;
    (urgent ? hi : lo).push([store, i, gen]);
  }

  function pump() {
    while (active < MAX_ACTIVE) {
      var job = hi.shift() || lo.shift();
      if (!job) return;
      if (job[2] !== gen) continue;
      run(job);
    }
  }

  function run(job) {
    var store = job[0], i = job[1], g = job[2];
    var im = new Image();
    active++;
    function settle(ok) {
      active--;
      if (g === gen) {
        if (ok) {
          store.img[i] = im; store.st[i] = 2;
          if (cur && cur.clip === store.name) dirty = true;
        } else {
          store.st[i] = (++store.tries[i] < 3) ? 0 : 3;
        }
      }
      pump();
    }
    im.decoding = 'async';
    im.onload = function () {
      if (im.decode) im.decode().then(function () { settle(true); }, function () { settle(true); });
      else settle(true);
    };
    im.onerror = function () { settle(false); };
    im.src = frameUrl(store.name, i);
  }

  // Coarse-to-fine order, so a nearby frame is on hand long before the clip is complete.
  function order(n, coarseOnly) {
    var seen = new Uint8Array(n), out = [n - 1, 0];
    seen[0] = seen[n - 1] = 1;
    var steps = coarseOnly ? [16, 8] : [16, 8, 4, 2, 1];
    steps.forEach(function (s) {
      for (var i = 0; i < n; i += s) if (!seen[i]) { seen[i] = 1; out.push(i); }
    });
    return out;
  }

  function ensure(name, level, urgent) {
    var store = stores[name];
    if (!store) return;
    if (urgent) promote(store);
    if (store.level >= level) return;
    store.level = level;
    order(store.n, level < 2).forEach(function (i) { enqueue(store, i, urgent); });
    pump();
  }

  function promote(store) {
    var keep = [], move = [];
    lo.forEach(function (j) { (j[0] === store ? move : keep).push(j); });
    if (move.length) { lo = keep; hi = hi.concat(move); }
  }

  /* ---------- timeline ---------- */
  var flat = [];      // every beat in order
  var scenes = [];    // { el, u, beats, range }
  var cur = null;

  SCENES.forEach(function (sc) {
    var el = document.getElementById(sc.id);
    var u = parseFloat(getComputedStyle(el).getPropertyValue('--u')) || 3;
    var total = 0;
    sc.beats.forEach(function (b) { b.w = b.w || 1; total += b.w; });
    var acc = 0;
    sc.beats.forEach(function (b) {
      b.a = acc / total; b.b = (acc + b.w) / total; acc += b.w;
      b.index = flat.length; b.scene = sc;
      flat.push(b);
    });
    scenes.push({ el: el, u: u, cfg: sc, start: 0, end: 1, st: null });
  });

  function unitPx() { return stage.offsetHeight || window.innerHeight; }

  function sample(y) {
    var i = 0;
    while (i < scenes.length - 1 && y >= scenes[i].end) i++;
    var s = scenes[i];
    var p = clamp01((y - s.start) / Math.max(1, s.end - s.start));
    var beats = s.cfg.beats, b = beats[beats.length - 1], k;
    for (k = 0; k < beats.length; k++) if (p < beats[k].b) { b = beats[k]; break; }
    var t = clamp01((p - b.a) / (b.b - b.a));
    var store = stores[b.clip];
    var out = {
      beat: b, clip: b.clip, t: t,
      f: b.hold ? store.n - 1 : t * (store.n - 1),
      zoom: b.z ? lerp(b.z[0], b.z[1], t) : 1,
      origin: [0.5, 0.5], fx: null, fxk: 0, join: 0,
      dim: s.cfg.dim ? s.cfg.dim(p) : 0
    };
    var e;
    if (b.in && t < b.in.span) {
      e = 1 - t / b.in.span;
      out.fx = b.in; out.fxk = e; out.origin = pt(b.in.at);
      out.zoom *= lerp(1, b.in.zoom, e * e);
    } else if (b.out && t > 1 - b.out.span) {
      e = (t - (1 - b.out.span)) / b.out.span;
      out.fx = b.out; out.fxk = e; out.origin = pt(b.out.at);
      out.zoom *= lerp(1, b.out.zoom, e * e);
    }
    if (b.join && t < b.join && b.index > 0) out.join = t / b.join;
    return out;
  }

  /* ---------- painting ---------- */
  var W = 0, H = 0, quality = 1, slow = 0;

  function resize() {
    var cw = stage.clientWidth, ch = stage.clientHeight;
    if (!cw || !ch) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cap = (variant === 'd' ? 1920 : 1080) / cw;   // never render far past the source frames
    var ratio = Math.min(dpr, cap) * quality;
    var w = Math.max(2, Math.round(cw * ratio)), h = Math.max(2, Math.round(ch * ratio));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    W = w; H = h; dirty = true;
  }

  // Cover-fit placement of a frame, optionally zoomed about a point of the frame.
  function place(store, zoom, origin) {
    var s0 = Math.max(W / store.w, H / store.h);
    var x0 = (W - store.w * s0) / 2, y0 = (H - store.h * s0) / 2;
    var s = s0 * zoom;
    var px = x0 + origin[0] * store.w * s0, py = y0 + origin[1] * store.h * s0;
    var x = px - origin[0] * store.w * s, y = py - origin[1] * store.h * s;
    x = Math.min(0, Math.max(W - store.w * s, x));
    y = Math.min(0, Math.max(H - store.h * s, y));
    return { x: x, y: y, w: store.w * s, h: store.h * s };
  }

  function onCanvas(store, p, zoom, origin) {
    var r = place(store, zoom, origin);
    return [r.x + p[0] * r.w, r.y + p[1] * r.h];
  }

  function drawClip(name, f, zoom, origin, alpha) {
    var store = stores[name];
    var a = Math.floor(f), frac = f - a, b = Math.min(store.n - 1, a + 1);
    var exact = store.st[a] === 2 && store.st[b] === 2;
    var ia = exact ? a : store.near(Math.round(f));
    if (ia < 0) { enqueueNow(store, Math.round(f)); return false; }
    var r = place(store, zoom, origin);
    // In motion, neighbouring frames are blended so the camera glides between them.
    // As scrolling slows the blend backs off, so a parked frame is always one sharp frame.
    var w = frac < 0.5 ? frac * mix : 1 - (1 - frac) * mix;
    if (exact && w > 0.98) { ia = b; w = 0; }
    ctx.globalAlpha = alpha;
    ctx.drawImage(store.img[ia], r.x, r.y, r.w, r.h);
    if (exact && w > 0.02 && b !== a) {
      ctx.globalAlpha = alpha * w;
      ctx.drawImage(store.img[b], r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
    if (!exact) { enqueueNow(store, a); enqueueNow(store, b); }
    return true;
  }

  function enqueueNow(store, i) {
    if (store.st[i] === 0) { store.st[i] = 1; hi.unshift([store, i, gen]); pump(); }
  }

  function bloom(k, c) {
    var e = k * k * (3 - 2 * k), d = Math.sqrt(W * W + H * H);
    var g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], d * (0.05 + 1.05 * e));
    g.addColorStop(0, 'rgba(255,248,234,' + Math.min(1, e * 1.7) + ')');
    g.addColorStop(0.42, 'rgba(255,244,224,' + (e * 0.82) + ')');
    g.addColorStop(1, 'rgba(255,240,214,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    var wash = smooth(0.5, 1, k);
    if (wash > 0) { ctx.globalAlpha = wash; ctx.fillStyle = '#fff6e6'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  function ember(k, c) {
    var e = k * k * (3 - 2 * k), m = Math.min(W, H);
    ctx.globalAlpha = Math.min(1, e * 1.04); ctx.fillStyle = '#060302'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    var g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], m * (0.07 + 0.5 * e));
    g.addColorStop(0, 'rgba(255,206,138,' + Math.min(1, 0.25 + e) * 0.95 * Math.min(1, k * 6) + ')');
    g.addColorStop(0.3, 'rgba(246,146,62,' + (0.6 * e) + ')');
    g.addColorStop(0.7, 'rgba(170,70,22,' + (0.22 * e) + ')');
    g.addColorStop(1, 'rgba(120,40,10,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  function emberCentre(s) {
    // The glow travels from the fire to the porch lights; both sides of the cut meet halfway.
    var fire = onCanvas(stores.bed, pt('fire'), 1, [0.5, 0.5]);
    var porch = onCanvas(stores.night, pt('porch'), 1, [0.5, 0.5]);
    var mid = [(fire[0] + porch[0]) / 2, (fire[1] + porch[1]) / 2];
    var here = onCanvas(stores[s.clip], pt(s.fx.at), s.zoom, s.origin);
    var e = s.fxk * s.fxk * (3 - 2 * s.fxk);
    return [lerp(here[0], mid[0], e), lerp(here[1], mid[1], e)];
  }

  function paint(s) {
    var b = s.beat, ok;
    if (s.join > 0 && s.join < 1) {
      var prev = flat[b.index - 1], ps = stores[prev.clip];
      var under = drawClip(prev.clip, ps.n - 1, 1, [0.5, 0.5], 1);
      ok = drawClip(s.clip, s.f, s.zoom, s.origin, under ? s.join : 1);
      ok = ok || under;
    } else {
      ok = drawClip(s.clip, s.f, s.zoom, s.origin, 1);
    }
    if (!ok) return false;
    if (s.fx && s.fxk > 0.002) {
      if (s.fx.fx === 'bloom') bloom(s.fxk, onCanvas(stores[s.clip], s.origin, s.zoom, s.origin));
      else ember(s.fxk, emberCentre(s));
    }
    if (s.dim > 0.003) { ctx.globalAlpha = s.dim; ctx.fillStyle = '#050907'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    return true;
  }

  /* ---------- loading plan: this clip now, the next two before they are needed ---------- */
  var planned = -1, keyed = -1;
  function plan(i) {
    if (i === planned) return;
    planned = i;
    if (keyed !== gen) {
      // First and last frame of every clip, before anything else: a jump straight to any
      // scene (End key, skip link, dragged scrollbar) then lands on that scene, not a stale one.
      keyed = gen;
      flat.forEach(function (b) {
        var st = stores[b.clip];
        enqueue(st, 0, true);
        enqueue(st, st.n - 1, true);
      });
    }
    ensure(flat[i].clip, 2, true);
    if (flat[i + 1]) ensure(flat[i + 1].clip, 2, true);
    if (flat[i + 2]) ensure(flat[i + 2].clip, 2, false);
    if (flat[i - 1]) ensure(flat[i - 1].clip, 2, false);
    // A sparse pass over everything else, so a jump (End key, dragged scrollbar) never lands on nothing.
    flat.forEach(function (b) { ensure(b.clip, 1, false); });
  }

  /* ---------- render loop ---------- */
  var lastKey = '', ready = false, maxScroll = 1;
  var mix = 0, lastF = 0, lastBeat = -1, lastT = 0;

  function render() {
    var y = window.pageYOffset || 0;
    var s = sample(y);
    cur = s;
    plan(s.beat.index);
    var now = performance.now();
    var fps = s.beat.index === lastBeat ? Math.abs(s.f - lastF) * 1000 / Math.max(1, now - lastT) : 12;
    lastF = s.f; lastBeat = s.beat.index; lastT = now;
    var want = clamp01((fps - 1) / 6);          // frames of film per second of real time
    mix += (want - mix) * 0.3;
    if (want === 0 && mix < 0.03) mix = 0;
    var key = mix.toFixed(2) + '|' + s.beat.index + '|' + s.f.toFixed(2) + '|' + s.zoom.toFixed(4) + '|' + s.fxk.toFixed(3) + '|' +
              s.dim.toFixed(3) + '|' + s.join.toFixed(3) + '|' + W + 'x' + H;
    if (dirty || key !== lastKey) {
      var t0 = performance.now();
      if (paint(s)) {
        lastKey = key; dirty = false;
        if (!ready) { ready = true; root.classList.add('film-ready'); }
        // If painting cannot keep up, give up resolution before giving up smoothness.
        var dt = performance.now() - t0;
        slow = dt > 12 ? slow + 1 : Math.max(0, slow - 1);
        if (slow > 45 && quality > 0.5) { quality -= 0.25; slow = 0; resize(); }
      }
    }
    if (bar) bar.style.transform = 'scaleX(' + clamp01(y / maxScroll).toFixed(4) + ')';
  }

  /* ---------- scroll ---------- */
  // The film always opens on the first drone frame (scroll restoration is switched off in the head).
  if (location.hash !== '#book') window.scrollTo(0, 0);

  var lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
  gsap.ticker.lagSmoothing(0);

  /* ---------- copy: every reveal is scrubbed by scroll ---------- */
  scenes.forEach(function (s) {
    var tl = gsap.timeline({ defaults: { ease: 'none' } });
    var nodes = s.el.querySelectorAll('[data-in], [data-out]');
    Array.prototype.forEach.call(nodes, function (node) {
      var fade = (parseFloat(node.getAttribute('data-fade')) || 0.22) / s.u;
      var tin = node.getAttribute('data-in'), tout = node.getAttribute('data-out');
      var isCaption = node.classList.contains('caption');
      var movers = isCaption ? node.children : node;
      if (tin !== null) {
        tin = parseFloat(tin);
        tl.fromTo(node, { opacity: 0 }, { opacity: 1, duration: fade, ease: 'power1.out' }, tin);
        tl.fromTo(movers, { y: 26 }, { y: 0, duration: fade * 1.25, ease: 'power2.out', stagger: isCaption ? fade * 0.3 : 0 }, tin);
      }
      if (tout !== null) {
        tout = parseFloat(tout);
        tl.to(node, { opacity: 0, duration: fade, ease: 'power1.in' }, tout - fade);
        tl.to(movers, { y: -16, duration: fade, ease: 'power1.in' }, tout - fade);
      }
    });
    if (s.cfg.id === 'arrival') {
      var hint = s.el.querySelector('.hint');
      if (hint) tl.to(hint, { opacity: 0, duration: 0.05 }, 0.01);
    }
    tl.set({}, {}, 1); // pad the timeline so 0..1 is the whole scene
    s.st = ScrollTrigger.create({
      trigger: s.el,
      start: 'top top',
      end: function () { return '+=' + Math.round(s.u * unitPx()); },
      scrub: true,
      animation: tl,
      invalidateOnRefresh: true
    });
  });

  function measure() {
    scenes.forEach(function (s) { s.start = s.st.start; s.end = s.st.start + Math.round(s.u * unitPx()); });
    maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    dirty = true;
  }
  ScrollTrigger.addEventListener('refresh', measure);

  /* ---------- variant (desktop frames / portrait crops) ---------- */
  function setVariant() {
    var v = portrait.matches ? 'm' : 'd';
    if (v === variant && Object.keys(stores).length) return;
    variant = v; gen++; hi = []; lo = []; planned = -1;
    buildStores(); resize(); dirty = true;
  }
  if (portrait.addEventListener) portrait.addEventListener('change', setVariant);
  else if (portrait.addListener) portrait.addListener(setVariant);

  if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
  else window.addEventListener('resize', resize);

  /* ---------- keyboard and anchors ---------- */
  function toEnd(focusEl) {
    lenis.scrollTo(document.documentElement.scrollHeight, {
      duration: 1.2,
      onComplete: function () { if (focusEl) focusEl.focus({ preventScroll: true }); }
    });
  }
  var cta = document.getElementById('cta');
  Array.prototype.forEach.call(document.querySelectorAll('a[href="#book"]'), function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); toEnd(cta); });
  });
  // Tabbing to the button brings its scene with it.
  if (cta) cta.addEventListener('focus', function () {
    if (window.pageYOffset < maxScroll - 4) lenis.scrollTo(document.documentElement.scrollHeight, { immediate: true });
  });

  /* ---------- go ---------- */
  buildStores();
  resize();
  ScrollTrigger.refresh();
  measure();
  gsap.ticker.add(render);
  if (location.hash === '#book') window.addEventListener('load', function () { toEnd(null); });

  window.__film = { lenis: lenis, scenes: scenes, stores: function () { return stores; }, sample: sample };
})();
