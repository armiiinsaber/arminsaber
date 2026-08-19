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

  function apply(t) {
    docEl.style.setProperty("--t", t.toFixed(4));
    thumb.style.transform = `translateX(${(t * track.clientWidth).toFixed(1)}px)`;
    for (let i = 0; i < sections.length; i++) {
      ticks[i].classList.toggle("is-lit", t >= sections[i].t - 0.005);
    }
  }

  function frame() {
    const target = targetT(window.scrollY);
    current = reduceMotion.matches
      ? target
      : current + (target - current) * 0.16;
    if (Math.abs(target - current) < 0.0004) current = target;
    if (current !== rendered) {
      apply(current);
      rendered = current;
      rafId = requestAnimationFrame(frame);
    } else {
      rafId = 0; // settled — stop until the next scroll
    }
  }

  function wake() {
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  addEventListener("scroll", wake, { passive: true });
  addEventListener("resize", () => { measure(); wake(); });

  measure();
  current = targetT(window.scrollY); // no lerp-in on load / deep link
  apply(current);

  // re-measure once fonts have settled layout
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measure(); wake(); });
  }
  addEventListener("load", () => { measure(); wake(); });

  window.__spectrum = { sections, measure, wake, jumpTo };
})();

/* ============================================================
   Reveal engine.
   Scroll-linked, not scroll-triggered: every [data-reveal]
   element fades/translates over a narrow band as it enters the
   bottom of the viewport and dissolves as it leaves the top —
   sections never snap against each other.
   data-reveal="in" | "out" | "" (both)
   ============================================================ */
(() => {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeOut = (p) => 1 - Math.pow(1 - p, 3);

  let items = [];

  function collect() {
    items = [...document.querySelectorAll("[data-reveal]")].map((el) => ({
      el,
      mode: el.dataset.reveal || "both",
      top: 0,
      height: 0,
      opacity: -1,
    }));
    measure();
  }

  function measure() {
    // offsetTop chains ignore our own transforms, so this is stable
    for (const it of items) {
      let y = 0;
      let n = it.el;
      while (n) { y += n.offsetTop; n = n.offsetParent; }
      it.top = y;
      it.height = it.el.offsetHeight;
    }
  }

  function render() {
    if (reduceMotion.matches) {
      for (const it of items) {
        it.el.style.opacity = "";
        it.el.style.transform = "";
      }
      return;
    }
    const vh = window.innerHeight;
    const y = window.scrollY;
    for (const it of items) {
      const top = it.top - y;            // viewport-relative
      const bottom = top + it.height;
      // enter: fade in across a band near the bottom edge
      const pIn = it.mode === "out" ? 1
        : easeOut(clamp((vh * 0.94 - top) / (vh * 0.16), 0, 1));
      // exit: dissolve as the element leaves through the top
      const pOut = it.mode === "in" ? 1
        : easeOut(clamp((bottom - vh * 0.03) / (vh * 0.11), 0, 1));
      const o = Math.min(pIn, pOut);
      const rounded = Math.round(o * 100) / 100;
      if (rounded === it.opacity) continue;
      it.opacity = rounded;
      it.el.style.opacity = rounded === 1 ? "" : String(rounded);
      const ty = (1 - pIn) * 16 - (1 - pOut) * 10;
      it.el.style.transform =
        Math.abs(ty) < 0.05 ? "" : `translateY(${ty.toFixed(1)}px)`;
    }
  }

  let rafId = 0;
  function onScroll() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; render(); });
  }

  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => { measure(); render(); });
  addEventListener("load", () => { measure(); render(); });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measure(); render(); });
  }

  collect();
  render();
  document.body.classList.add("is-ready"); // page-load stagger gate

  window.__reveal = { collect, measure, render };
})();
