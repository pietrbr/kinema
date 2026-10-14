"use strict";
(() => {
  const SAMPLES = 150;
  const EPSILON = 0.01;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const params = new URLSearchParams(location.search);
  const SPEED = Number(params.get("speed") ?? 1);
  const FREEZE = params.has("freeze") ? Number(params.get("freeze")) : null;
  const DURATION = { morph: 700, staged: 1300, zoom: 1000, enter: 550 };
  const TRANSITION_DURATION = { fade: 450, push: 550 };
  const DIRECTION = { forward: 1, backward: -1 };
  const nativeWindow = window.webkit?.messageHandlers?.kinetic;
  const MODE = { normal: "normal", pen: "pen", laser: "laser" };
  const PEN_WIDTH = 0.004;
  const LASER_RADIUS = 0.007;
  const LASER_TRAIL_MS = 250;

  const pages = [...document.querySelectorAll(".page")];
  const overlay = document.getElementById("overlay");
  const marks = document.getElementById("marks");
  const ink = marks.appendChild(document.createElementNS(SVG_NS, "g"));
  const trail = marks.appendChild(document.createElementNS(SVG_NS, "path"));
  const dot = marks.appendChild(document.createElementNS(SVG_NS, "circle"));
  let current = 0;
  let steps = [];
  let raf = 0;

  for (const img of document.querySelectorAll("image[data-kn-src]")) {
    img.setAttribute("href", window.KN_IMAGES[img.dataset.knSrc]);
  }

  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const smooth = (a, b, t) => ease(clamp((t - a) / (b - a)));
  const lerp = (a, b, t) => a + (b - a) * t;

  function toRoot(el) {
    return DOMMatrix.fromMatrix(
      el.ownerSVGElement.getScreenCTM().inverse().multiply(el.getScreenCTM()),
    );
  }

  function rootRect(el) {
    const b = el.getBBox();
    const m = toRoot(el);
    const pts = [
      [b.x, b.y],
      [b.x + b.width, b.y],
      [b.x, b.y + b.height],
      [b.x + b.width, b.y + b.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y, m };
  }

  function sameRect(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h) < EPSILON;
  }

  function rectMap(from, to) {
    const ratio = (a, b) => (a > EPSILON ? b / a : 1);
    return new DOMMatrix()
      .translate(to.x, to.y)
      .scale(ratio(from.w, to.w), ratio(from.h, to.h))
      .translate(-from.x, -from.y);
  }

  function lerpRect(a, b, t) {
    return {
      x: lerp(a.x, b.x, t),
      y: lerp(a.y, b.y, t),
      w: lerp(a.w, b.w, t),
      h: lerp(a.h, b.h, t),
    };
  }

  const probe = document.body.appendChild(
    document.createElementNS(SVG_NS, "svg"),
  );
  probe.setAttribute(
    "style",
    "position:absolute;width:0;height:0;visibility:hidden",
  );
  const probePath = probe.appendChild(document.createElementNS(SVG_NS, "path"));
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

  // Outlines (subpaths) of a path: { closed, segs }, each segment a standalone absolute path string.
  function outlines(d) {
    const tokens =
      d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? [];
    const found = [];
    let segs = [];
    let closed = false;
    let cur = [0, 0];
    let start = [0, 0];
    let ctrl = null;
    let cmd = "";
    let i = 0;
    const num = () => Number(tokens[i++]);
    const push = (type, args, end) => {
      segs.push(`M${cur[0]} ${cur[1]}${type}${args.join(" ")}`);
      cur = end;
    };
    const reflect = (kind) =>
      ctrl?.kind === kind
        ? [2 * cur[0] - ctrl.pt[0], 2 * cur[1] - ctrl.pt[1]]
        : cur;
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) {
        cmd = tokens[i++];
      }
      const up = cmd.toUpperCase();
      if (!ARITY[up] && up !== "Z") {
        i++;
        continue;
      }
      const rel = cmd !== up;
      const ox = rel ? cur[0] : 0;
      const oy = rel ? cur[1] : 0;
      const args = Array.from({ length: ARITY[up] }, num);
      const pt = (k) => [args[k] + ox, args[k + 1] + oy];
      if (up === "M") {
        found.push({ closed, segs });
        segs = [];
        closed = false;
        cur = start = pt(0);
        cmd = rel ? "l" : "L";
        ctrl = null;
      } else if (up === "L" || up === "H" || up === "V") {
        const x = up === "V" ? cur[0] : args[0] + ox;
        const y =
          up === "H" ? cur[1] : up === "V" ? args[0] + oy : args[1] + oy;
        push("L", [x, y], [x, y]);
        ctrl = null;
      } else if (up === "C" || up === "S") {
        const k = up === "C" ? 2 : 0;
        const c1 = up === "C" ? pt(0) : reflect("C");
        const c2 = pt(k);
        const end = pt(k + 2);
        push("C", [...c1, ...c2, ...end], end);
        ctrl = { kind: "C", pt: c2 };
      } else if (up === "Q" || up === "T") {
        const c = up === "Q" ? pt(0) : reflect("Q");
        const end = up === "Q" ? pt(2) : pt(0);
        push("Q", [...c, ...end], end);
        ctrl = { kind: "Q", pt: c };
      } else if (up === "A") {
        const end = pt(5);
        push("A", [...args.slice(0, 5), ...end], end);
        ctrl = null;
      } else if (up === "Z") {
        if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-6) {
          push("L", start, start);
        }
        closed = true;
        ctrl = null;
        cmd = "";
      }
    }
    found.push({ closed, segs });
    const measure = (s) => {
      probePath.setAttribute("d", s);
      return { d: s, len: probePath.getTotalLength(), from: 0, to: 1 };
    };
    return found
      .map((o) => ({
        closed: o.closed,
        segs: o.segs.map(measure).filter((s) => s.len > 1e-6),
      }))
      .filter((o) => o.segs.length > 0);
  }

  function equalize(segs, count) {
    const out = [...segs];
    while (out.length < count) {
      let k = 0;
      out.forEach((s, j) => {
        if (s.len * (s.to - s.from) > out[k].len * (out[k].to - out[k].from)) {
          k = j;
        }
      });
      const s = out[k];
      const mid = (s.from + s.to) / 2;
      out.splice(k, 1, { ...s, to: mid }, { ...s, from: mid });
    }
    return out;
  }

  function samplePoints(segs, m, per, closed) {
    const pts = [];
    const add = (s, t) => {
      const q = probePath.getPointAtLength(s.len * t);
      const p = new DOMPoint(q.x, q.y).matrixTransform(m);
      pts.push([p.x, p.y]);
    };
    for (const s of segs) {
      probePath.setAttribute("d", s.d);
      for (let j = 0; j < per; j++) {
        add(s, lerp(s.from, s.to, j / per));
      }
    }
    if (!closed) {
      add(segs.at(-1), segs.at(-1).to);
    }
    return pts;
  }

  // Corresponding point lists for two outlines; segment boundaries (corners) land on each other.
  function matchOutline(oa, ob, ma, mb) {
    const n = Math.max(oa.segs.length, ob.segs.length);
    const per = Math.ceil(SAMPLES / n);
    const closed = oa.closed && ob.closed;
    const from = samplePoints(equalize(oa.segs, n), ma, per, closed);
    const to = samplePoints(equalize(ob.segs, n), mb, per, closed);
    const total = from.length;
    const reversed = closed
      ? to.map((_, i) => to[(total - i) % total])
      : [...to].reverse();
    const step = closed ? per : total;
    let best = { cost: Infinity, pts: to, k: 0 };
    for (const pts of [to, reversed]) {
      for (let k = 0; k < total; k += step) {
        let cost = 0;
        for (let i = 0; i < total; i++) {
          const q = pts[(i + k) % total];
          cost += (from[i][0] - q[0]) ** 2 + (from[i][1] - q[1]) ** 2;
        }
        if (cost < best.cost) {
          best = { cost, pts, k };
        }
      }
    }
    return {
      from,
      to: best.pts.map((_, i) => best.pts[(i + best.k) % total]),
      closed,
      cost: best.cost / total,
    };
  }

  function correspond(pa, pb, ma, mb) {
    const oa = outlines(pa.getAttribute("d"));
    const ob = outlines(pb.getAttribute("d"));
    const count = Math.min(oa.length, ob.length);
    if (count === 0) {
      return null;
    }
    const subs = oa
      .slice(0, count)
      .map((o, k) => matchOutline(o, ob[k], ma, mb));
    return { subs, cost: Math.max(...subs.map((sub) => sub.cost)) };
  }

  function paint(el) {
    const style = getComputedStyle(el);
    const color = (v) => {
      const m = v.match(/^rgba?\(([^)]*)\)$/);
      const rgba = m
        ? m[1]
            .split(/[\s,/]+/)
            .filter(Boolean)
            .map(Number)
        : null;
      return { raw: v, rgba: rgba && [...rgba.slice(0, 3), rgba[3] ?? 1] };
    };
    return {
      fill: color(style.fill),
      stroke: color(style.stroke),
      width: parseFloat(style.strokeWidth) || 0,
      rule: style.fillRule,
    };
  }

  function samePaint(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function named(page, kind) {
    const map = new Map();
    for (const g of page.querySelectorAll(`[data-kn-${kind}]`)) {
      map.set(g.getAttribute(`data-kn-${kind}`), g);
    }
    return map;
  }

  function pairs(a, b, kind) {
    const from = named(a, kind);
    const to = named(b, kind);
    return [...from.keys()]
      .filter((k) => to.has(k))
      .map((k) => [from.get(k), to.get(k)]);
  }

  function frameOf(page) {
    const marker = page.querySelector("[data-kn-frame]");
    return {
      frame: marker?.dataset.knFrame,
      transition: marker?.dataset.knTransition || "",
    };
  }

  function sameFrame(a, b) {
    return frameOf(a).frame === frameOf(b).frame;
  }

  function show(page, z) {
    page.style.display = "block";
    page.style.zIndex = String(z);
  }

  function reset(page) {
    page.style.display =
      page.style.zIndex =
      page.style.opacity =
      page.style.transform =
        "";
  }

  function setCurrent(i) {
    for (const p of pages) {
      reset(p);
      p.classList.remove("current");
    }
    current = i;
    pages[i].classList.add("current");
    document.body.dataset.page = String(i + 1);
  }

  function run(list) {
    finish();
    steps = list;
    if (FREEZE !== null && steps.length > 0) {
      steps[0].render(FREEZE);
      return;
    }
    next();
  }

  function next() {
    const step = steps[0];
    if (!step) {
      return;
    }
    const start = performance.now();
    const tick = (now) => {
      const t = clamp((now - start) / (step.duration * SPEED));
      step.render(t);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }
      steps.shift();
      step.cleanup();
      next();
    };
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    cancelAnimationFrame(raf);
    for (const step of steps) {
      step.render(1);
      step.cleanup();
    }
    steps = [];
  }

  function morphStep(a, b) {
    const morphs = pairs(a, b, "morph");
    const moves = pairs(a, b, "move");
    show(b, 2);
    b.style.opacity = "0";
    const tracks = [];
    const hidden = new Set();
    for (const [ga, gb] of morphs) {
      const from = [...ga.querySelectorAll("path")];
      const to = [...gb.querySelectorAll("path")];
      for (let k = 0; k < Math.min(from.length, to.length); k++) {
        const pa = paint(from[k]);
        const pb = paint(to[k]);
        const ma = toRoot(from[k]);
        const mb = toRoot(to[k]);
        const unchanged =
          from[k].getAttribute("d") === to[k].getAttribute("d") &&
          String(ma) === String(mb);
        if (unchanged && samePaint(pa, pb)) {
          continue;
        }
        const c = correspond(from[k], to[k], ma, mb);
        if (!c || (c.cost < EPSILON && samePaint(pa, pb))) {
          continue;
        }
        tracks.push({ subs: c.subs, from: pa, to: pb });
        hidden.add(from[k]).add(to[k]);
      }
    }
    const clones = [];
    for (const [ga, gb] of moves) {
      const ra = rootRect(ga);
      const rb = rootRect(gb);
      if (sameRect(ra, rb)) {
        continue;
      }
      clones.push({ ra, rb, srcA: ga, srcB: gb });
      hidden.add(ga).add(gb);
    }
    if (tracks.length === 0 && clones.length === 0) {
      reset(b);
      return null;
    }
    overlay.setAttribute(
      "viewBox",
      b.querySelector("svg").getAttribute("viewBox"),
    );
    show(a, 1);
    for (const t of tracks) {
      t.el = overlay.appendChild(document.createElementNS(SVG_NS, "path"));
    }
    const ghost = (src) => {
      const style = getComputedStyle(src);
      const wrap = overlay.appendChild(document.createElementNS(SVG_NS, "g"));
      wrap.setAttribute("fill", style.fill);
      wrap.setAttribute("stroke", style.stroke);
      wrap.appendChild(src.cloneNode(true));
      return wrap;
    };
    for (const c of clones) {
      c.ga = ghost(c.srcA);
      c.gb = ghost(c.srcB);
    }
    for (const g of hidden) {
      g.style.visibility = "hidden";
    }
    const staged = !sameFrame(a, b);
    const phases = staged
      ? { out: [0, 0.25], morph: [0.2, 0.8], in: [0.75, 1] }
      : { out: null, morph: [0, 1], in: [0.35, 1] };
    const pictures = [...hidden]
      .filter((g) => a.contains(g))
      .map((g) => g.closest("[data-kn-picture]"))
      .filter(Boolean);
    const faded = staged ? [...new Set(pictures)] : [];
    const mix = (x, y, e) => {
      if (!x.rgba || !y.rgba) {
        return e < 0.5 ? x.raw : y.raw;
      }
      const [r, g, b, alpha] = x.rgba.map((v, i) => lerp(v, y.rgba[i], e));
      return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
    };
    return {
      duration: staged ? DURATION.staged : DURATION.morph,
      render(t) {
        const e = smooth(...phases.morph, t);
        for (const g of faded) {
          g.style.opacity = String(1 - smooth(...phases.out, t));
        }
        for (const { el, subs, from, to } of tracks) {
          let d = "";
          for (const sub of subs) {
            for (let i = 0; i < sub.from.length; i++) {
              const [x0, y0] = sub.from[i];
              const [x1, y1] = sub.to[i];
              d += `${i ? "L" : "M"}${lerp(x0, x1, e)} ${lerp(y0, y1, e)}`;
            }
            d += sub.closed ? "Z" : "";
          }
          el.setAttribute("d", d);
          el.setAttribute("fill-rule", to.rule);
          el.setAttribute("fill", mix(from.fill, to.fill, e));
          el.setAttribute("stroke", mix(from.stroke, to.stroke, e));
          el.setAttribute(
            "stroke-width",
            String(lerp(from.width, to.width, e)),
          );
        }
        for (const c of clones) {
          const r = lerpRect(c.ra, c.rb, e);
          c.ga.setAttribute(
            "transform",
            String(rectMap(c.ra, r).multiply(c.ra.m)),
          );
          c.gb.setAttribute(
            "transform",
            String(rectMap(c.rb, r).multiply(c.rb.m)),
          );
          c.ga.setAttribute("opacity", String(1 - e));
          c.gb.setAttribute("opacity", String(e));
        }
        b.style.opacity = String(smooth(...phases.in, t));
      },
      cleanup() {
        overlay.replaceChildren();
        for (const g of faded) {
          g.style.opacity = "";
        }
        for (const g of hidden) {
          g.style.visibility = "";
        }
        setCurrent(pages.indexOf(b));
      },
    };
  }

  function zoomStep(a, b) {
    const [pair] = pairs(a, b, "zoom");
    if (!pair) {
      return null;
    }
    show(b, 2);
    const rects = pair.map(rootRect);
    if (
      Math.abs(rects[0].w - rects[1].w) < EPSILON &&
      Math.abs(rects[0].h - rects[1].h) < EPSILON
    ) {
      reset(b);
      return null;
    }
    if (rects.some((r) => r.w < EPSILON || r.h < EPSILON)) {
      reset(b);
      return null;
    }
    const forward = rects[0].w * rects[0].h < rects[1].w * rects[1].h;
    const [overview, detail] = forward ? [a, b] : [b, a];
    const [ro, rd] = forward ? rects : [rects[1], rects[0]];
    const target = forward ? pair[0] : pair[1];
    show(overview, 1);
    show(detail, 2);
    const picture = target.closest("[data-kn-picture]");
    if (!picture) {
      reset(b);
      return null;
    }
    const base = toRoot(picture);
    const scale = Math.min(rd.w / ro.w, rd.h / ro.h);
    const co = [ro.x + ro.w / 2, ro.y + ro.h / 2];
    const cd = [rd.x + rd.w / 2, rd.y + rd.h / 2];
    return {
      duration: DURATION.zoom,
      render(t) {
        const q = ease(forward ? t : 1 - t);
        const z = new DOMMatrix()
          .translate(lerp(co[0], cd[0], q), lerp(co[1], cd[1], q))
          .scale(scale ** q)
          .translate(-co[0], -co[1]);
        picture.setAttribute(
          "transform",
          String(base.inverse().multiply(z).multiply(base)),
        );
        detail.style.opacity = String(smooth(0.6, 1, q));
      },
      cleanup() {
        picture.removeAttribute("transform");
        setCurrent(pages.indexOf(b));
      },
    };
  }

  function frameStep(a, b, direction) {
    const kind = frameOf(direction === DIRECTION.forward ? b : a).transition;
    if (sameFrame(a, b) || !Object.hasOwn(TRANSITION_DURATION, kind)) {
      return null;
    }
    show(a, 1);
    show(b, 2);
    return {
      duration: TRANSITION_DURATION[kind],
      render(t) {
        const e = ease(t);
        if (kind === "push") {
          a.style.transform = `translateX(${-100 * direction * e}%)`;
          b.style.transform = `translateX(${100 * direction * (1 - e)}%)`;
          return;
        }
        b.style.opacity = String(e);
      },
      cleanup() {
        setCurrent(pages.indexOf(b));
      },
    };
  }

  function enterStep(a, b) {
    const before = new Set([
      ...named(a, "fade").keys(),
      ...named(a, "drawon").keys(),
    ]);
    const fresh = (kind) =>
      [...named(b, kind)].filter(([k]) => !before.has(k)).map(([, g]) => g);
    const fades = fresh("fade");
    const draws = fresh("drawon");
    if (fades.length === 0 && draws.length === 0) {
      return null;
    }
    const lines = [];
    const rest = [];
    for (const g of draws) {
      for (const el of g.querySelectorAll("path, use, image")) {
        const p = paint(el);
        if (el.tagName === "path" && !p.fill && p.stroke) {
          const len = el.getTotalLength();
          el.style.strokeDasharray = String(len);
          lines.push({ el, len });
        } else {
          rest.push(el);
        }
      }
    }
    const step = {
      duration: DURATION.enter,
      render(t) {
        const e = ease(t);
        for (const g of fades) {
          g.style.opacity = String(e);
        }
        for (const { el, len } of lines) {
          el.style.strokeDashoffset = String(len * (1 - e));
        }
        for (const el of rest) {
          el.style.opacity = String(smooth(0.6, 1, t));
        }
      },
      cleanup() {
        for (const el of [...fades, ...rest, ...lines.map((l) => l.el)]) {
          el.style.opacity =
            el.style.strokeDasharray =
            el.style.strokeDashoffset =
              "";
        }
      },
    };
    step.render(0);
    return step;
  }

  function go(delta) {
    finish();
    const i = current + delta;
    if (i < 0 || i >= pages.length) {
      return;
    }
    clearMarks();
    const a = pages[current];
    const b = pages[i];
    const direction = delta > 0 ? DIRECTION.forward : DIRECTION.backward;
    const main =
      zoomStep(a, b) ?? morphStep(a, b) ?? frameStep(a, b, direction);
    if (!main) {
      setCurrent(i);
    }
    const enter = direction === DIRECTION.forward ? enterStep(a, b) : null;
    run([main, enter].filter(Boolean));
  }

  let mode = MODE.normal;
  let stroke = null;
  let strokePath = "";
  let skipClick = false;
  let laserPoints = [];

  function setupMarks() {
    const slide = pages[0].querySelector("svg");
    const { width } = slide.viewBox.baseVal;
    marks.setAttribute("viewBox", slide.getAttribute("viewBox"));
    ink.setAttribute("stroke-width", String(PEN_WIDTH * width));
    trail.setAttribute("stroke-width", String(LASER_RADIUS * width));
    dot.setAttribute("r", String(LASER_RADIUS * width));
    dot.setAttribute("visibility", "hidden");
  }

  function slidePoint(ev) {
    return new DOMPoint(ev.clientX, ev.clientY).matrixTransform(
      marks.getScreenCTM().inverse(),
    );
  }

  function clearMarks() {
    ink.replaceChildren();
    stroke = null;
  }

  function setMode(next) {
    mode = next;
    document.body.dataset.mode = next;
    stroke = null;
    if (next !== MODE.laser) {
      dot.setAttribute("visibility", "hidden");
      laserPoints = [];
      trail.removeAttribute("d");
    }
  }

  function toggleMode(next) {
    setMode(mode === next ? MODE.normal : next);
  }

  function drawTrail() {
    const now = performance.now();
    laserPoints = laserPoints.filter((q) => now - q.t < LASER_TRAIL_MS);
    if (laserPoints.length < 2) {
      trail.removeAttribute("d");
    } else {
      trail.setAttribute(
        "d",
        laserPoints.map((q, k) => `${k ? "L" : "M"}${q.x} ${q.y}`).join(""),
      );
    }
    if (laserPoints.length > 0) {
      requestAnimationFrame(drawTrail);
    }
  }

  function moveLaser(ev) {
    const q = slidePoint(ev);
    dot.setAttribute("cx", String(q.x));
    dot.setAttribute("cy", String(q.y));
    dot.setAttribute("visibility", "visible");
    if (laserPoints.length === 0) {
      requestAnimationFrame(drawTrail);
    }
    laserPoints.push({ x: q.x, y: q.y, t: performance.now() });
  }

  document.addEventListener("pointerdown", (ev) => {
    skipClick = false;
    if (nativeWindow && ev.metaKey) {
      skipClick = true;
      nativeWindow.postMessage("drag");
      return;
    }
    if (mode !== MODE.pen || ev.button !== 0 || help.classList.contains("open")) {
      return;
    }
    skipClick = true;
    const q = slidePoint(ev);
    strokePath = `M${q.x} ${q.y}`;
    stroke = ink.appendChild(document.createElementNS(SVG_NS, "path"));
    stroke.setAttribute("d", strokePath);
  });
  document.addEventListener("pointermove", (ev) => {
    if (mode === MODE.laser) {
      moveLaser(ev);
      return;
    }
    if (!stroke) {
      return;
    }
    const q = slidePoint(ev);
    strokePath += `L${q.x} ${q.y}`;
    stroke.setAttribute("d", strokePath);
  });
  for (const type of ["pointerup", "pointercancel"]) {
    document.addEventListener(type, () => {
      stroke = null;
    });
  }
  document.documentElement.addEventListener("pointerleave", () => {
    dot.setAttribute("visibility", "hidden");
  });

  function toggleFullscreen() {
    if (!document.fullscreenEnabled) {
      return;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen();
      return;
    }
    document.documentElement.requestFullscreen();
  }

  const help = document.getElementById("help");

  function toggleHelp() {
    help.classList.toggle("open");
  }

  function closeHelp() {
    help.classList.remove("open");
  }

  document.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) {
      return;
    }
    if (ev.repeat && ["?", "p", "l", "f"].includes(ev.key)) {
      return;
    }
    if (ev.key === "?") {
      toggleHelp();
    } else if (ev.key === "Escape" && help.classList.contains("open")) {
      closeHelp();
    } else if (ev.key === "Escape") {
      setMode(MODE.normal);
    } else if (ev.key === "p") {
      toggleMode(MODE.pen);
    } else if (ev.key === "l") {
      toggleMode(MODE.laser);
    } else if (ev.key === "c") {
      clearMarks();
    } else if (ev.key === "f") {
      toggleFullscreen();
    } else if (["ArrowRight", "PageDown", " "].includes(ev.key)) {
      go(1);
    } else if (["ArrowLeft", "PageUp"].includes(ev.key)) {
      go(-1);
    }
  });
  document.addEventListener("click", () => {
    if (help.classList.contains("open")) {
      closeHelp();
      return;
    }
    if (skipClick) {
      return;
    }
    go(1);
  });

  document.body.dataset.fullscreen = String(Boolean(document.fullscreenEnabled));
  document.body.dataset.native = String(Boolean(nativeWindow));
  setupMarks();
  setMode(nativeWindow ? MODE.laser : MODE.normal);
  const start = Number.parseInt(params.get("page") ?? "1", 10);
  setCurrent(
    Math.max(
      0,
      Math.min(pages.length - 1, (Number.isNaN(start) ? 1 : start) - 1),
    ),
  );
  window.kinetic = {
    go,
    get page() {
      return current + 1;
    },
    get busy() {
      return steps.length > 0;
    },
    get mode() {
      return mode;
    },
    get marks() {
      return ink.childElementCount;
    },
  };
})();
