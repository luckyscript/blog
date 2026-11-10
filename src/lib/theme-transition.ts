type ThemeReveal = {
  finished: Promise<void>;
  skip: () => void;
};

// Keep the same vertices in every frame so the edge moves like a spreading wash.
function inkEdge(x: number, y: number, radius: number, ripple: number) {
  const points = Array.from({ length: 80 }, (_, index) => {
    const angle = (index / 80) * Math.PI * 2;
    const wave = Math.sin(angle * 3 + 0.6) * 0.52
      + Math.sin(angle * 7 - 0.8) * 0.3
      + Math.sin(angle * 11 + 1.2) * 0.18;
    const distance = radius * (1 + wave * ripple);
    return `${(x + Math.cos(angle) * distance).toFixed(2)}px ${(y + Math.sin(angle) * distance).toFixed(2)}px`;
  });
  return `polygon(${points.join(",")})`;
}

export function revealTheme(
  button: HTMLButtonElement,
  label: string,
  update: () => void,
): ThemeReveal {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (!document.startViewTransition || reducedMotion.matches || document.hidden) {
    update();
    return { finished: Promise.resolve(), skip: () => {} };
  }

  const root = document.documentElement;
  const rect = button.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  ) + 40;
  const duration = 920;
  const caption = document.createElement("div");
  caption.className = "theme-reveal-caption";
  caption.textContent = label;
  caption.setAttribute("aria-hidden", "true");

  let applied = false;
  const commit = () => {
    if (applied) return;
    applied = true;
    update();
  };

  // Suppress ordinary color transitions before capturing the new palette.
  root.dataset.themeTransition = "ink";
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => {
      commit();
      document.body.append(caption);
    });
  } catch {
    delete root.dataset.themeTransition;
    commit();
    return { finished: Promise.resolve(), skip: () => {} };
  }

  const animations: Animation[] = [];
  const skip = () => {
    transition.skipTransition();
    animations.forEach((animation) => animation.cancel());
  };
  const onMotionChange = () => {
    if (reducedMotion.matches) skip();
  };
  reducedMotion.addEventListener("change", onMotionChange);

  const finished = (async () => {
    try {
      await transition.ready;
      animations.push(root.animate(
        [
          { clipPath: inkEdge(x, y, 2, 0.16), offset: 0 },
          { clipPath: inkEdge(x, y, radius * 0.1, 0.12), offset: 0.18 },
          { clipPath: inkEdge(x, y, radius * 0.44, 0.07), offset: 0.5 },
          { clipPath: inkEdge(x, y, radius * 0.83, 0.035), offset: 0.8 },
          { clipPath: inkEdge(x, y, radius * 1.06, 0.015), offset: 1 },
        ],
        {
          duration,
          easing: "cubic-bezier(0.65, 0, 0.2, 1)",
          fill: "both",
          pseudoElement: "::view-transition-new(root)",
        },
      ));
      animations.push(root.animate(
        [
          { opacity: 0, transform: "translateY(22px)", offset: 0 },
          { opacity: 0, transform: "translateY(22px)", offset: 0.2 },
          { opacity: 0.15, transform: "translateY(0)", offset: 0.55 },
          { opacity: 0, transform: "translateY(-12px)", offset: 1 },
        ],
        { duration, fill: "both", pseudoElement: "::view-transition-new(theme-caption)" },
      ));
      animations.push(root.animate(
        [
          { opacity: 0, transform: "rotate(-42deg) scale(0.45)", offset: 0 },
          { opacity: 1, transform: "rotate(9deg) scale(1.18)", offset: 0.48 },
          { opacity: 1, transform: "rotate(-3deg) scale(0.96)", offset: 0.75 },
          { opacity: 1, transform: "rotate(0) scale(1)", offset: 1 },
        ],
        {
          duration: 640,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
          fill: "both",
          pseudoElement: "::view-transition-new(theme-control)",
        },
      ));
      await Promise.all(animations.map((animation) => animation.finished));
    } catch {
      // A hidden tab, a second click, or missing pseudo-element support may skip
      // the effect. The requested palette must still be applied exactly once.
      skip();
      await transition.updateCallbackDone.catch(() => {});
      commit();
    } finally {
      await transition.finished.catch(() => {});
      animations.forEach((animation) => animation.cancel());
      reducedMotion.removeEventListener("change", onMotionChange);
      caption.remove();
      delete root.dataset.themeTransition;
    }
  })();

  return { finished, skip };
}
