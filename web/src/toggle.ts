// Smooth open and close for a <details> card, with the Web Animations API so
// it works the same in Firefox, Safari and Chromium. The content's height and
// opacity animate over about 200 ms; a click mid-way reverses from where the
// card is, with no jump. Reduced motion opens and closes at once.

const DURATION = 200;
const EASING = 'ease-out';

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Makes `details` open and close smoothly. `body` builds the content the
 * first time it is needed (it is kept afterwards); it may return null.
 * The `is-open` class follows where the card is heading, so the chevron
 * turns in step with the animation.
 */
export function smoothDetails(details: HTMLDetailsElement, body: () => HTMLElement | null): void {
  const summary = details.querySelector('summary')!;
  let content: HTMLElement | null = null;
  let height: Animation | null = null;
  let fade: Animation | null = null;
  let heading: 'open' | 'closed' = details.open ? 'open' : 'closed';

  const ensureContent = () => {
    if (!content) {
      content = body();
      if (content) details.append(content);
    }
    return content;
  };

  // Opened another way (find-in-page, a script, reduced motion): build the content too.
  details.addEventListener('toggle', () => {
    if (details.open) ensureContent();
    if (!height) {
      heading = details.open ? 'open' : 'closed';
      details.classList.toggle('is-open', details.open);
    }
  });

  const settle = () => {
    height = null;
    fade = null;
    details.style.height = '';
    details.style.overflow = '';
    if (content) content.style.opacity = '';
  };

  summary.addEventListener('click', e => {
    if (reducedMotion() || typeof details.animate !== 'function') {
      // The browser toggles it at once; the content is built now, not on the
      // later toggle event, so the first frame shows the card fully open.
      if (!details.open) ensureContent();
      details.classList.toggle('is-open', !details.open);
      return;
    }
    e.preventDefault();
    const opening = heading === 'closed';
    heading = opening ? 'open' : 'closed';
    details.classList.toggle('is-open', opening);

    // Where the card is now, mid-animation or at rest.
    const from = details.getBoundingClientRect().height;
    // A closed card's content is hidden: it starts from 0, not its computed 1.
    const fromOpacity = details.open && content ? Number(getComputedStyle(content).opacity) : 0;
    height?.cancel();
    fade?.cancel();
    details.style.overflow = 'hidden';

    if (opening) {
      ensureContent();
      details.style.height = `${from}px`; // hold it while the content appears
      details.open = true;
    }
    const borders = details.offsetHeight - details.clientHeight;
    const to = opening
      ? summary.offsetHeight + (content?.offsetHeight ?? 0) + borders
      : summary.offsetHeight + borders;

    const anim = details.animate({ height: [`${from}px`, `${to}px`] }, { duration: DURATION, easing: EASING });
    height = anim;
    if (content) {
      fade = content.animate(
        { opacity: [String(fromOpacity), opening ? '1' : '0'] },
        { duration: DURATION, easing: EASING });
    }
    anim.onfinish = () => {
      if (height !== anim) return;
      if (!opening) details.open = false;
      settle();
    };
  });
}
