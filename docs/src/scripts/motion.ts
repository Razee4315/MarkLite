import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Site motion: smooth scroll (Lenis) + scroll-reveal / parallax (GSAP).
 * Everything degrades gracefully: with reduced-motion we reveal instantly and
 * skip the smooth-scroll hijack entirely.
 */
export function initMotion(): void {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const reveals = gsap.utils.toArray<HTMLElement>("[data-reveal]");

  if (reduce) {
    reveals.forEach((el) => el.classList.add("is-revealed"));
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ---- Lenis smooth scroll, driven by GSAP's ticker ---- */
  const lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
  });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time: number) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  /* In-page anchor links route through Lenis for a smooth glide */
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -72, duration: 1.1 });
    });
  });

  /* ---- Sticky nav: solidify after scrolling past the hero top ---- */
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  if (nav) {
    ScrollTrigger.create({
      start: "top -8",
      onUpdate: (self) => nav.classList.toggle("is-stuck", self.scroll() > 8),
      onToggle: (self) => nav.classList.toggle("is-stuck", self.isActive || window.scrollY > 8),
    });
    const sync = () => nav.classList.toggle("is-stuck", window.scrollY > 8);
    lenis.on("scroll", sync);
    sync();
  }

  /* ---- Scroll-reveal, batched & staggered by group ---- */
  ScrollTrigger.batch("[data-reveal]", {
    start: "top 88%",
    onEnter: (batch) =>
      gsap.to(batch, {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: "expo.out",
        stagger: 0.08,
        overwrite: "auto",
      }),
  });

  /* ---- Parallax accents ---- */
  gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
    const depth = parseFloat(el.dataset.parallax || "10");
    gsap.to(el, {
      yPercent: -depth,
      ease: "none",
      scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true },
    });
  });

  /* ---- Hero "assemble": source lines type in, preview blocks fade after ---- */
  const srcLines = gsap.utils.toArray<HTMLElement>("[data-type-line]");
  const prevBlocks = gsap.utils.toArray<HTMLElement>("[data-prev-block]");
  if (srcLines.length || prevBlocks.length) {
    const tl = gsap.timeline({ delay: 0.25 });
    if (srcLines.length) {
      gsap.set(srcLines, { opacity: 0, x: -8 });
      tl.to(srcLines, { opacity: 1, x: 0, duration: 0.4, stagger: 0.09, ease: "power2.out" });
    }
    if (prevBlocks.length) {
      gsap.set(prevBlocks, { opacity: 0, y: 12 });
      tl.to(prevBlocks, { opacity: 1, y: 0, duration: 0.6, stagger: 0.12, ease: "expo.out" }, "-=0.6");
    }
  }

  /* ---- Cursor-reactive glow in the hero ---- */
  const spot = document.querySelector<HTMLElement>("[data-hero-spot]");
  const hero = document.querySelector<HTMLElement>("#top");
  if (spot && hero && window.matchMedia("(pointer: fine)").matches) {
    const xTo = gsap.quickTo(spot, "x", { duration: 0.7, ease: "power3.out" });
    const yTo = gsap.quickTo(spot, "y", { duration: 0.7, ease: "power3.out" });
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      xTo(e.clientX - r.left);
      yTo(e.clientY - r.top);
      spot.style.opacity = "1";
    });
    hero.addEventListener("pointerleave", () => (spot.style.opacity = "0"));
  }

  /* Recalculate once fonts settle to avoid trigger drift */
  if (document.fonts?.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
}
