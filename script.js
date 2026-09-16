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

  // seven colour stops at the entries' own positions; the accent walks
  // them piecewise so it is exactly the entry's colour when it is in view
  const STOPS = sections.map((s) => s.t);
  function applyAccent(t) {
    let i = 0;
    while (i < STOPS.length - 2 && t > STOPS[i + 1]) i++;
    const a = STOPS[i], b = STOPS[i + 1];
    const f = clamp((t - a) / (b - a), 0, 1);
    docEl.style.setProperty("--acc-a", `var(--c${i + 1})`);
    docEl.style.setProperty("--acc-b", `var(--c${i + 2})`);
    docEl.style.setProperty("--acc-f", f.toFixed(4));
  }

  function apply(t) {
    docEl.style.setProperty("--t", t.toFixed(4));
    applyAccent(t);
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
