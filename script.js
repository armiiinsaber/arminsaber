/* ============================================================
   Spectrum engine.
   Vertical scroll drives one number, t (0 logic → 1 feeling).
   t is piecewise-linear through the projects' plotted values,
   so the ribbon thumb lands exactly on a tick when its entry
   is in view. t feeds --t on :root; CSS derives --accent.
   ============================================================ */
(() => {
  "use strict";

  const docEl = document.documentElement;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- project sections ---------- */

  const sections = [...document.querySelectorAll(".entry[data-t]")].map((el) => ({
    el,
    t: parseFloat(el.dataset.t),
    anchor: 0, // scrollY at which this section is "reached"
  }));

  /* ---------- ribbon ---------- */

  const track = document.getElementById("ribbon-track");
  const thumb = document.getElementById("ribbon-thumb");
  const ticks = sections.map((s) => {
    const b = document.createElement("button");
    b.className = "ribbon-tick";
    b.type = "button";
    b.style.left = `${s.t * 100}%`;
    b.dataset.name = s.el.dataset.name;
    b.setAttribute("aria-label", `Jump to ${s.el.dataset.name}`);
    b.addEventListener("click", () => jumpTo(s.el));
    track.insertBefore(b, thumb);
    return b;
  });

  function jumpTo(el) {
    el.scrollIntoView({
      behavior: reduceMotion.matches ? "auto" : "smooth",
      block: "start",
    });
    if (el.id) history.replaceState(null, "", `#${el.id}`);
  }

  /* ---------- geometry ---------- */

  let maxScroll = 1;

  function measure() {
    trackW = track.clientWidth;   // read once here, never in the frame loop
    const vh = window.innerHeight;
    maxScroll = Math.max(1, docEl.scrollHeight - vh);
    for (const s of sections) {
      // "reached" when the section top sits 35% down the viewport
      const top = s.el.getBoundingClientRect().top + window.scrollY;
      s.anchor = clamp(top - vh * 0.35, 0, maxScroll);
    }
  }

  /* scroll position → spectrum t, piecewise through the anchors */
  function targetT(y) {
    if (!sections.length) return clamp(y / maxScroll, 0, 1);
    const first = sections[0];
    const last = sections[sections.length - 1];
    if (y <= first.anchor) {
      return first.anchor > 0 ? (y / first.anchor) * first.t : 0;
    }
    if (y >= last.anchor) {
      const span = maxScroll - last.anchor;
      return span > 0
        ? last.t + ((y - last.anchor) / span) * (1 - last.t)
        : last.t;
    }
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i];
      const b = sections[i + 1];
      if (y >= a.anchor && y <= b.anchor) {
        const span = b.anchor - a.anchor;
        const f = span > 0 ? (y - a.anchor) / span : 1;
        return a.t + f * (b.t - a.t);
      }
    }
    return last.t;
  }

  /* ---------- render loop (runs only while settling) ---------- */

  let current = 0;
  let rendered = -1;
  let rafId = 0;

  // seven colour stops at the entries' own positions; the accent walks
  // them piecewise so it is exactly the entry's colour when it is in view
  const STOPS = sections.map((s) => s.t);
  // Every custom property written on the root invalidates the style of
  // everything that inherits it, which is the whole page, and profiling a
  // scroll showed that recalc plus a forced layout costing more than the
  // painting did. So the root is written only when a value moves a step
  // the eye could see: the accent in 24 steps between neighbouring hues,
  // t at two decimals. The thumb is a transform, which costs nothing.
  // While scrolling, the accent is written on the ribbon alone (which
  // redeclares --accent for itself), a recalc of twenty elements. The
  // root, which every element inherits from, is written once when the
  // scroll settles. Profiled: each root write recalculated 425 elements,
  // and there were 260 of them in one scroll. --t is written with it, at
  // rest only; nothing in the stylesheet reads it, but it is the page's
  // stated position for anything that wants it.
  let trackW = 0, lastAcc = "", rootAcc = "";
  const ribbon = document.querySelector(".ribbon") || docEl;
  function accentOf(t) {
    let i = 0;
    while (i < STOPS.length - 2 && t > STOPS[i + 1]) i++;
    const a = STOPS[i], b = STOPS[i + 1];
    const f = Math.round(clamp((t - a) / (b - a), 0, 1) * 16) / 16;
    return { i, f, key: `${i}:${f}` };
  }
  function writeAccent(el, acc) {
    el.style.setProperty("--acc-a", `var(--c${acc.i + 1})`);
    el.style.setProperty("--acc-b", `var(--c${acc.i + 2})`);
    el.style.setProperty("--acc-f", acc.f.toFixed(4));
  }
  function applyAccent(t, settled) {
    const acc = accentOf(t);
    if (acc.key !== lastAcc) { lastAcc = acc.key; writeAccent(ribbon, acc); }
    if (settled && acc.key !== rootAcc) { rootAcc = acc.key; writeAccent(docEl, acc); docEl.style.setProperty("--t", t.toFixed(4)); }
  }

  function apply(t, settled) {
    applyAccent(t, settled);
    thumb.style.transform = `translateX(${(t * trackW).toFixed(1)}px)`;
    for (let i = 0; i < sections.length; i++) {
      ticks[i].classList.toggle("is-lit", t >= sections[i].t - 0.005);
    }
  }

  // the scroll position is taken in the scroll event, where it is free;
  // reading it inside the frame would force layout on whatever the last
  // frame left dirty
  let sy = window.scrollY;
  function frame() {
    const target = targetT(sy);
    current = reduceMotion.matches
      ? target
      : current + (target - current) * 0.16;
    if (Math.abs(target - current) < 0.0004) current = target;
    if (current !== rendered) {
      apply(current, current === target);
      rendered = current;
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = 0; // settled — stop until the next scroll
    }
  }

  function wake() {
    sy = window.scrollY;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  addEventListener("scroll", wake, { passive: true });
  addEventListener("resize", () => { measure(); wake(); });

  measure();
  sy = window.scrollY;
  current = targetT(sy); // no lerp-in on load / deep link
  apply(current, true);

  // re-measure once fonts have settled layout
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measure(); wake(); });
  }
  addEventListener("load", () => { measure(); wake(); });

  window.__spectrum = { sections, measure, wake, jumpTo };
})();

/* ============================================================
   Hero plot.
   Hover/focus a dot → its name and category appear in the
   readout line (fixed height, no layout shift). Click → jump.
   ============================================================ */
(() => {
  "use strict";

  const readout = document.querySelector(".plot-readout");
  const dots = [...document.querySelectorAll(".plot-dot")];
  if (!readout || !dots.length) return;

  const idleText = readout.textContent;

  function show(dot) {
    const target = document.getElementById(dot.dataset.target);
    if (!target) return;
    dots.forEach((d) => d.classList.toggle("is-active", d === dot));
    readout.classList.add("is-active");
    readout.replaceChildren();
    const n = document.createElement("span");
    n.className = "ro-n";
    n.textContent = dot.dataset.n;
    const name = document.createElement("span");
    name.textContent = target.dataset.name;
    const cat = document.createElement("span");
    cat.className = "ro-cat";
    cat.textContent = target.dataset.cat;
    readout.append(n, name, cat);
  }

  function idle() {
    dots.forEach((d) => d.classList.remove("is-active"));
    readout.classList.remove("is-active");
    readout.textContent = idleText;
  }

  for (const dot of dots) {
    dot.addEventListener("pointerenter", () => show(dot));
    dot.addEventListener("focus", () => show(dot));
    dot.addEventListener("pointerleave", idle);
    dot.addEventListener("blur", idle);
    dot.addEventListener("click", () => {
      const target = document.getElementById(dot.dataset.target);
      if (target) window.__spectrum.jumpTo(target);
    });
  }
})();

/* ============================================================
   Entries: one open at a time (suspended while "Expand all" is
   active), whole header tappable, deep-linkable by id.
   Collapsed summaries stay searchable: the inner carries
   hidden="until-found", and beforematch expands the entry before
   the browser scrolls to the match. Heights change on toggle, so
   the spectrum engine re-measures after the transition.
   ============================================================ */
(() => {
  "use strict";

  // only entries that actually carry a summary are managed
  const entries = [...document.querySelectorAll(".entry")]
    .filter((e) => e.querySelector(".entry-sum-inner"));
  const allBtn = document.querySelector(".expand-all");
  let expandAll = false;
  const hideTimers = new WeakMap();

  function remeasure() {
    window.__spectrum.measure();
    window.__spectrum.wake();
  }

  function setOpen(entry, open, instant = false) {
    const inner = entry.querySelector(".entry-sum-inner");
    const btn = entry.querySelector(".entry-toggle");
    clearTimeout(hideTimers.get(entry));
    if (instant) {
      entry.classList.add("no-anim");
      requestAnimationFrame(() => entry.classList.remove("no-anim"));
    }
    if (open) {
      inner.removeAttribute("hidden");
      entry.classList.add("is-open");
    } else {
      entry.classList.remove("is-open");
      // layer 3 never survives its summary closing
      entry.querySelector(".entry-more")?.__close?.(true);
      // restore searchable-hidden once the collapse has finished
      hideTimers.set(entry, setTimeout(() => {
        if (!entry.classList.contains("is-open")) {
          inner.setAttribute("hidden", "until-found");
        }
      }, instant ? 0 : 500));
    }
    if (btn) btn.setAttribute("aria-expanded", String(open));
  }

  function toggle(entry) {
    const opening = !entry.classList.contains("is-open");
    if (expandAll) {
      setOpen(entry, opening); // no one-at-a-time while all-expanded
    } else {
      for (const e of entries) setOpen(e, e === entry && opening);
    }
    if (opening && entry.id) history.replaceState(null, "", `#${entry.id}`);
    setTimeout(remeasure, 520);
  }

  function setExpandAll(on) {
    expandAll = on;
    for (const e of entries) setOpen(e, on);
    if (allBtn) {
      allBtn.setAttribute("aria-pressed", String(on));
      allBtn.querySelector(".xa-label").textContent = on ? "Collapse all" : "Expand all";
    }
    setTimeout(remeasure, 520);
  }

  if (allBtn) allBtn.addEventListener("click", () => setExpandAll(!expandAll));

  for (const entry of entries) {
    const head = entry.querySelector(".entry-head");
    const btn = entry.querySelector(".entry-toggle");
    const inner = entry.querySelector(".entry-sum-inner");
    if (btn) btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(entry);
    });
    if (head) head.addEventListener("click", (e) => {
      if (e.target.closest("a")) return; // live links stay links
      toggle(entry);
    });
    // browser find (Cmd+F) landed inside the collapsed brief:
    // open this entry instantly so the scroll-to-match has a layout
    inner.addEventListener("beforematch", () => {
      if (expandAll) {
        setOpen(entry, true, true);
      } else {
        for (const e of entries) setOpen(e, e === entry, true);
      }
      remeasure();
      setTimeout(remeasure, 100);
    });
  }

  // deep link: /#easymonee opens and lands on that entry
  function openFromHash() {
    const id = location.hash.slice(1);
    if (!id) return;
    const entry = document.getElementById(id);
    if (entry && entries.includes(entry)) {
      for (const e of entries) setOpen(e, e === entry, true);
      setTimeout(() => {
        remeasure();
        entry.scrollIntoView({ behavior: "auto", block: "start" });
      }, 60);
    }
  }
  openFromHash();
  addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    const entry = document.getElementById(id);
    if (entry && entries.includes(entry) && !entry.classList.contains("is-open")) {
      if (expandAll) setOpen(entry, true);
      else for (const e of entries) setOpen(e, e === entry);
      setTimeout(remeasure, 520);
    }
  });
})();

/* ============================================================
   Layer 3: the full brief, behind its own control.
   Deliberately independent of layer 2 — "Expand all" and deep
   links open summaries and never this. Same reveal mechanism as
   layer 2, so the fields stay findable while shut:
   hidden="until-found" on the panel, beforematch opens it before
   the browser scrolls to the match. Entries with no brief have
   no control in the markup at all, so there is no empty state.
   ============================================================ */
(() => {
  "use strict";

  for (const more of document.querySelectorAll(".entry-more")) {
    const btn = more.querySelector(".more-toggle");
    const inner = more.querySelector(".more-panel-inner");
    const label = more.querySelector(".more-label");
    if (!btn || !inner) continue;
    let hideTimer = 0;

    function set(open, instant = false) {
      clearTimeout(hideTimer);
      if (instant) {
        more.classList.add("no-anim");
        requestAnimationFrame(() => more.classList.remove("no-anim"));
      }
      if (open) {
        inner.removeAttribute("hidden");
        more.classList.add("is-open");
      } else {
        more.classList.remove("is-open");
        hideTimer = setTimeout(() => {
          if (!more.classList.contains("is-open")) {
            inner.setAttribute("hidden", "until-found");
          }
        }, instant ? 0 : 500);
      }
      btn.setAttribute("aria-expanded", String(open));
      if (label) label.textContent = open ? "Hide brief" : "Full brief";
      setTimeout(() => {
        window.__spectrum.measure();
        window.__spectrum.wake();
      }, instant ? 0 : 520);
    }

    // the entries controller calls this when a summary closes
    more.__close = (instant) => {
      if (more.classList.contains("is-open")) set(false, instant);
    };

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      set(!more.classList.contains("is-open"));
    });

    // browser find (Cmd+F) landed in a shut brief: open it instantly so
    // the scroll-to-match has a layout to scroll to
    inner.addEventListener("beforematch", () => set(true, true));
  }
})();

/* ============================================================
   The artwork seam. Each canvas is painted the entry's token
   colour up front, which is close but not exact: the photograph's
   ground is baked and will drift a few percent off. Once the
   image decodes, one pixel is sampled from inside its own ground
   and the slot is painted that value, so the two colours are the
   same colour and there is no edge to see.

   A hue that is properly wrong is a different problem and this
   does not pretend to fix it: the seam goes, but the artwork
   stops agreeing with the dot, the axis and the accent, which is
   what carries meaning. That one needs a regrade, not CSS.
   ============================================================ */
(() => {
  "use strict";
  const sample = (img) => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      // a few pixels in from the top left, inside the ground rather than
      // on the edge, where resampling has softened it
      const i = Math.max(2, Math.round(img.naturalWidth * 0.02));
      ctx.drawImage(img, i, i, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    } catch {
      return null;                   // tainted or not decodable: keep the token
    }
  };
  // the room pictures are fetched once their room is a little way up the
  // screen, not when its top edge grazes the fold: the browser's own lazy
  // margin is over a screen ahead and pulled three of them into the
  // first view. They fade in as they land.
  // each figure declares its picture's ground, measured at build time, so
  // the room has its colour before any picture arrives; "none" means the
  // picture has no ground and becomes the room itself
  for (const fig of document.querySelectorAll(".entry-art[data-ground]")) {
    const entry = fig.closest(".entry"), g = fig.dataset.ground;
    if (g === "none") entry.classList.add("entry--photo"); else {
      entry.style.setProperty("--art-bg", g);
      // a light ground needs a denser scrim under the copy
      const n = parseInt(g.slice(1), 16), lum = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
      if (lum > 140) entry.classList.add("entry--light");
    }
    const im = fig.querySelector("img"); const [fx, fy] = (fig.dataset.focus || "50 50").split(/\s+/);
    if (im) im.style.objectPosition = `${fx}% ${fy}%`;   // the crop window keeps the focal point in view
  }
  const gate = "IntersectionObserver" in window ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const im = e.target; if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; } gate.unobserve(im); } }, { rootMargin: "0px 0px -15% 0px" }) : null;
  for (const im of document.querySelectorAll(".entry-art img[data-src]")) { if (gate) gate.observe(im); else { im.src = im.dataset.src; } }
  for (const img of document.querySelectorAll(".entry-art img")) {
    const done = () => {
      const c = sample(img);
      if (c) img.closest(".entry").dataset.sampled = c;   // recorded for reports; the room's ground comes from data-ground, set at build time
      img.classList.add("is-loaded");
    };
    if (img.complete && img.naturalWidth) done();
    else img.addEventListener("load", done, { once: true });
  }
})();

/* ============================================================
   The travelling lip.

   The blue lip painted on the portrait is the object. At the top
   of the page it sits exactly over the place it was painted (the
   painting has had it removed). Scroll, and it lifts off and
   travels down with you, easing onto whatever is worth looking at,
   and comes to rest on the leopard's mouth at the bottom.

   Same engine as the spectrum: scroll wakes a rAF loop, the loop
   eases toward a target and stops on arrival. Nothing reads layout
   in a scroll handler; only transform and opacity are written.
   Waypoints are measured on load, resize, after a layer toggle and
   whenever the page changes height (fonts landing, images arriving),
   against the box the image's pixels actually occupy, so a figure
   that crops its image with object-fit still gives the true mouth.

   Reduced motion: it does not travel. It sits on the portrait's
   mouth, in the page, where it was painted, and a second copy sits
   on the leopard's mouth so the ending still reads. Nothing moves
   and nothing is missing.
   ============================================================ */
(() => {
  "use strict";
  const lip = document.querySelector("[data-lip]");
  if (!lip) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let LIP_ASPECT = 0.63;  // height over width; read from the image once it loads
  const LIP_PAD = 90 / 70; // the image is the painted lip plus 10px of baked glow each side

  let targets = [], cur = null, tgt = null, rafId = 0, settled = true;

  const focusOf = (el) => (el.dataset.focus || "50 50").split(/\s+/).map(Number);
  // the box the image's pixels occupy: a figure capped in one dimension
  // crops its image with object-fit: cover, and the percentages belong to
  // the picture, not the crop. Falls back to the width/height attributes
  // before a lazy image has loaded.
  const drawnRect = (img) => {
    const r = img.getBoundingClientRect();
    const nw = img.naturalWidth || Number(img.getAttribute("width"));
    const nh = img.naturalHeight || Number(img.getAttribute("height"));
    if (!nw || !nh || !r.width || !r.height) return r;
    const k = Math.max(r.width / nw, r.height / nh);
    const w = nw * k, h = nh * k;
    // object-position decides which part of the picture the box shows
    const op = (getComputedStyle(img).objectPosition || "50% 50%").split(/\s+/).map((v) => parseFloat(v) / 100);
    const px = isNaN(op[0]) ? 0.5 : op[0], py = isNaN(op[1]) ? 0.5 : op[1];
    return { left: r.left + (r.width - w) * px, top: r.top + (r.height - h) * py, width: w, height: h };
  };
  const measure = () => {
    const out = [];
    // depart: the portrait's mouth. The lip's width there is the painted
    // lip's share of the image, so it is the same size as what it covers
    const hero = document.querySelector(".hero-portrait");
    const heroImg = hero && hero.querySelector("img");
    if (hero && heroImg) {
      const r = drawnRect(heroImg);
      const [fx, fy] = focusOf(hero);
      out.push({ y: r.top + scrollY + r.height * fy / 100, x: r.left + r.width * fx / 100,
                 size: r.width * (Number(hero.dataset.lipWidth) || 6.4) / 100, depart: true });
    }
    for (const fig of document.querySelectorAll(".entry-art")) {
      const im = fig.querySelector("img");
      const r = im ? drawnRect(im) : fig.getBoundingClientRect();
      const [fx, fy] = focusOf(fig);
      // the lip's width is the picture's share, like the portrait; never smaller than a thumb
      out.push({ y: r.top + scrollY + r.height * fy / 100, x: r.left + r.width * fx / 100,
                 size: Math.max(28, r.width * (Number(fig.dataset.lipWidth) || 7) / 100) });
    }
    // rest: the leopard's mouth
    const closer = document.querySelector(".closer-art");
    const closerImg = closer && closer.querySelector("img");
    if (closer && closerImg) {
      const r = drawnRect(closerImg);
      const [fx, fy] = focusOf(closer);
      out.push({ y: r.top + scrollY + r.height * fy / 100, x: r.left + r.width * fx / 100,
                 size: r.width * (Number(closer.dataset.lipWidth) || 7.5) / 100, rest: true });
    }
    targets = out.sort((a, b) => a.y - b.y);
  };

  let sy = scrollY, vh = innerHeight;   // taken in the scroll and resize events, never in the frame
  const pick = () => {
    const mid = sy + vh * 0.45;
    // before anything else is in view the lip stays on the mouth
    if (sy < 8 && targets[0] && targets[0].depart) return targets[0];
    let best = targets[0], d = Infinity;
    for (const t of targets) { const dist = Math.abs(t.y - mid); if (dist < d) { d = dist; best = t; } }
    return best;
  };

  const place = (t) => { const box = t.size * LIP_PAD; return { x: t.x - box / 2, y: t.y - sy - (box * LIP_ASPECT) / 2, s: box / 64 }; };

  const frame = () => {
    const t = tgt; if (!t) { rafId = 0; return; }
    const want = place(t);
    if (!cur) cur = { ...want };
    const k = 0.11;
    cur.x += (want.x - cur.x) * k; cur.y += (want.y - cur.y) * k; cur.s += (want.s - cur.s) * k;
    lip.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0) scale(${cur.s.toFixed(3)})`;
    const near = Math.abs(want.x - cur.x) < 0.3 && Math.abs(want.y - cur.y) < 0.3;
    if (near) { rafId = 0; settled = true; } else { settled = false; rafId = requestAnimationFrame(frame); }
  };

  let restCopy = null;
  const rest = () => {
    const d = targets.find((x) => x.depart) || targets[0]; if (!d) return;
    const put = (el, t) => {
      const box = t.size * LIP_PAD;
      el.classList.add("is-static", "is-on");
      el.style.transform = "none";
      el.style.width = `${box.toFixed(1)}px`;
      el.style.left = `${(t.x - box / 2).toFixed(1)}px`;
      el.style.top = `${(t.y - (box * LIP_ASPECT) / 2).toFixed(1)}px`;
    };
    put(lip, d);
    const r = targets.find((x) => x.rest);
    if (r) {
      if (!restCopy) { restCopy = lip.cloneNode(true); restCopy.removeAttribute("data-lip"); lip.after(restCopy); }
      put(restCopy, r);
    }
  };

  const wake = () => {
    sy = scrollY; vh = innerHeight;
    if (reduce.matches) { rest(); return; }
    tgt = pick();
    // at the top of the page the lip is on the mouth, full stop: a
    // re-measure after fonts or images land must not be seen as travel
    if (sy < 8 && tgt.depart) cur = null;
    if (!rafId) rafId = requestAnimationFrame(frame);
  };

  addEventListener("scroll", wake, { passive: true });
  addEventListener("resize", () => { measure(); wake(); });
  document.addEventListener("click", () => setTimeout(() => { measure(); wake(); }, 560), true);
  reduce.addEventListener("change", () => {
    lip.classList.remove("is-static"); lip.style.cssText = ""; cur = null;
    if (restCopy) { restCopy.remove(); restCopy = null; }
    measure(); wake();
  });
  if ("ResizeObserver" in window) new ResizeObserver(() => { measure(); wake(); }).observe(document.body);

  const img = lip.querySelector("img");
  const start = () => {
    if (img && img.naturalWidth) LIP_ASPECT = img.naturalHeight / img.naturalWidth;
    measure(); cur = null; wake(); requestAnimationFrame(() => lip.classList.add("is-on"));
  };
  if (img && !img.complete) img.addEventListener("load", start, { once: true }); else start();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); wake(); });
  addEventListener("load", () => { measure(); wake(); });
  // the hero image decides where the mouth is, so re-measure when it lands
  for (const im of document.querySelectorAll(".hero-portrait img, .closer-art img")) {
    im.addEventListener("load", () => { measure(); wake(); }, { once: true });
  }
  window.__lip = { measure, wake, targets: () => targets, settled: () => settled };
})();

/* the hero and the closer paint their box the image's own ground, the
   same way the artwork slots do, so the image can float in it */
(() => {
  "use strict";
  const sample = (img) => {
    try {
      const c = document.createElement("canvas"); c.width = c.height = 1;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      const i = Math.max(2, Math.round(img.naturalWidth * 0.02));
      ctx.drawImage(img, i, i, 1, 1, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r} ${g} ${b})`;
    } catch { return null; }
  };
  for (const [sel, prop] of [[".hero-portrait img", "--hero-bg"], [".closer-art img", "--closer-bg"]]) {   // the hero still takes its sample: the portrait is not on the token yet
    const img = document.querySelector(sel); if (!img) continue;
    const done = () => {
      const c = sample(img); if (!c) return;
      document.documentElement.style.setProperty(prop, c);
      // the last room and the closer are one field: until Live sets has a
      // picture of its own, its room takes the leopard's sampled ground
      if (prop === "--closer-bg") document.documentElement.dataset.closerGround = c;   // recorded only; the closer is painted with the token
    };
    if (img.complete && img.naturalWidth) done(); else img.addEventListener("load", done, { once: true });
  }
})();
