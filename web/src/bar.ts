// The progress bar above the dropzone. It shows one step at a time (the step
// text and its percentage); within a step it never goes backwards.

export interface Bar {
  /** Shows the bar on `step`. A new step starts from `percent` without animating; the same step only moves forward. */
  show(step: string, percent?: number): void;
  /** Moves forward to `percent` on the current step (ignored if lower, or if the bar is hidden). */
  set(percent: number): void;
  /** Fills to 100%, then fades out after about 400 ms. */
  done(): void;
  /** Hides at once (error, Stop). */
  hide(): void;
  readonly visible: boolean;
}

const FADE_AFTER = 400;
const FADE_FOR = 200;
const ENTER_FOR = 150;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function progressBar(root: HTMLElement): Bar {
  const stepEl = root.querySelector<HTMLElement>('#progress-step')!;
  const pctEl = root.querySelector<HTMLElement>('#progress-pct')!;
  const track = root.querySelector<HTMLElement>('[role="progressbar"]')!;
  const fill = root.querySelector<HTMLElement>('#progress-fill')!;
  let step = '';
  let value = 0;
  let timers: number[] = [];
  let fadeOut: Animation | null = null;

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
    if (fadeOut) { fadeOut.onfinish = null; fadeOut.cancel(); fadeOut = null; }
  };

  const paint = (jump: boolean) => {
    if (jump) {
      // A new step: no transition back to its start.
      fill.classList.add('jump');
      fill.style.transform = `scaleX(${value / 100})`;
      void fill.offsetWidth;
      fill.classList.remove('jump');
    } else {
      fill.style.transform = `scaleX(${value / 100})`;
    }
    pctEl.textContent = `${value}%`;
    track.setAttribute('aria-valuenow', String(value));
    // The name (aria-labelledby) is the step; the value text is the percentage.
    track.setAttribute('aria-valuetext', `${value}%`);
  };

  const bar: Bar = {
    show(next, percent = 0) {
      clearTimers();
      const wasHidden = root.hidden;
      root.hidden = false;
      // Ease the bar in, so the dropzone below glides down instead of jumping
      // under the pointer. It starts from no height and no margins: exactly
      // the space a hidden bar takes.
      if (wasHidden && !reducedMotion() && typeof root.animate === 'function') {
        const cs = getComputedStyle(root);
        root.animate([
          { height: '0px', marginTop: '0px', marginBottom: '0px', opacity: 0, overflow: 'hidden' },
          { height: `${root.offsetHeight}px`, marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, overflow: 'hidden' },
        ], { duration: ENTER_FOR, easing: 'ease-out' });
      }
      if (next !== step || wasHidden) {
        step = next;
        stepEl.textContent = next;
        value = Math.round(percent);
        paint(true);
      } else if (percent > value) {
        value = Math.round(percent);
        paint(false);
      }
    },
    set(percent) {
      if (root.hidden || percent <= value) return;
      value = Math.min(100, Math.round(percent));
      paint(false);
    },
    done() {
      if (root.hidden) return;
      clearTimers();
      if (value < 100) { value = 100; paint(false); }
      timers.push(window.setTimeout(() => {
        // Fade, and close up the space it took, so the page below glides up instead of jumping.
        if (reducedMotion() || typeof root.animate !== 'function') { bar.hide(); return; }
        const cs = getComputedStyle(root);
        fadeOut = root.animate([
          { opacity: 1, height: `${root.offsetHeight}px`, marginTop: cs.marginTop, marginBottom: cs.marginBottom, overflow: 'hidden' },
          { opacity: 0, height: '0px', marginTop: '0px', marginBottom: '0px', overflow: 'hidden' },
        ], { duration: FADE_FOR, easing: 'ease-out' });
        fadeOut.onfinish = () => bar.hide();
      }, FADE_AFTER));
    },
    hide() {
      clearTimers();
      root.hidden = true;
    },
    get visible() { return !root.hidden; },
  };
  return bar;
}
