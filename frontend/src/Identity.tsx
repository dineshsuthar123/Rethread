import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
export const Mark = ({ className = "" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 256 256" aria-hidden="true">
    <path
      className="mark-main"
      d="M44 220V36h99c42 0 69 25 69 62 0 38-27 63-69 63h-29l-23-23h52c29 0 45-14 45-40 0-24-16-39-45-39H68v161z"
    />
    <path className="mark-return" d="m90 103 139 117h-36L73 119z" />
    <path className="mark-main" d="m54 161 45-39 18 15-63 55z" />
  </svg>
);
export const Brand = () => (
  <Link className="brand" to="/" aria-label="Rethread home">
    <Mark />
    <span>
      rethread<span className="brand-dot">.</span>
    </span>
  </Link>
);
export function Sculpture({ motion }: { motion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !motion || !matchMedia("(pointer:fine)").matches) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = node.getBoundingClientRect();
        node.style.setProperty(
          "--rx",
          `${(-(e.clientY - r.top - r.height / 2) / r.height) * 8}deg`,
        );
        node.style.setProperty(
          "--ry",
          `${((e.clientX - r.left - r.width / 2) / r.width) * 8}deg`,
        );
      });
    };
    const reset = () => {
      node.style.setProperty("--rx", "-5deg");
      node.style.setProperty("--ry", "-12deg");
    };
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerleave", reset);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", reset);
    };
  }, [motion]);
  return (
    <div
      className="sculpture-area"
      ref={ref}
      role="img"
      aria-label="Return Stitch: three planes connect a failure to a repair and a lasting guard"
    >
      <div className="architectural-grid" />
      <span className="sculpture-coordinate mono">
        FIG. 01 / THE RETURN STITCH
      </span>
      <div className="sculpture">
        <div className="plane plane-back">
          <span>03 / GUARD</span>
        </div>
        <div className="plane plane-mid">
          <span>02 / REPAIR</span>
        </div>
        <div className="plane plane-front">
          <Mark className="sculpture-mark" />
          <span>01 / FAILURE</span>
        </div>
      </div>
      <svg
        className="sculpture-thread"
        viewBox="0 0 550 380"
        aria-hidden="true"
      >
        <path d="M0 330C150 330 120 280 205 280S370 290 545 205" />
      </svg>
      <div className="sculpture-note">
        <i />
        <span>
          One event. One notification.<small>A behavior worth keeping.</small>
        </span>
      </div>
      <span className="coordinate-end mono">X 044 · Y 220</span>
    </div>
  );
}
export function Intro({ enabled }: { enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(() => {
    try {
      const nav = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming;
      return (
        enabled &&
        !sessionStorage.getItem("rethread:intro") &&
        (!nav || nav.type === "navigate")
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!show) return;
    sessionStorage.setItem("rethread:intro", "1");
    let disposed = false;
    let stop: (() => void) | undefined;
    const failSafe = setTimeout(() => setShow(false), 2600);
    void import("gsap").then(({ gsap }) => {
      if (disposed || !ref.current) return;
      const context = gsap.context(() => {
        const tl = gsap.timeline({ onComplete: () => setShow(false) });
        tl.fromTo(
          ".intro-line",
          { strokeDashoffset: 1300 },
          { strokeDashoffset: 0, duration: 0.35 },
        );
        tl.to(".intro-fragment", { opacity: 1, duration: 0.15 }, 0.35);
        tl.to(".intro-planes", { opacity: 1, y: 0, duration: 0.55 }, 0.9);
        tl.to(".intro-logo", { opacity: 1, scale: 1, duration: 0.55 }, 1.1);
        tl.to(".intro-fragment", { opacity: 0, duration: 0.15 }, 1.5);
        tl.to(ref.current, { opacity: 0, duration: 0.7 }, 1.65);
      }, ref);
      stop = () => context.revert();
    });
    return () => {
      disposed = true;
      clearTimeout(failSafe);
      stop?.();
    };
  }, [show]);
  if (!show) return null;
  return (
    <div className="intro" ref={ref} aria-label="The broken thread returns">
      <div className="intro-brand">
        <Mark />
        rethread
      </div>
      <svg viewBox="0 0 1000 400" className="intro-line" aria-hidden="true">
        <path d="M0 200H360L430 150 490 240 580 190H1000" />
      </svg>
      <div className="intro-fragment mono">
        AssertionError: expected 1, got 2
        <small>delivery.py:18 · duplicate event</small>
      </div>
      <div className="intro-planes mono">
        <span>Failure</span>
        <span>Repair</span>
        <span>Guard</span>
      </div>
      <Mark className="intro-logo" />
      <button className="intro-skip" onClick={() => setShow(false)}>
        Skip introduction ↗
      </button>
    </div>
  );
}
