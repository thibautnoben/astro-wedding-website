import { inView } from 'motion';
import { animate } from 'motion/mini';

/**
 * Declarative animations driven by data attributes:
 *
 *   data-animate="fade" | "fade-up" | "fade-blur" | "scale"   – the effect
 *   data-animate-on="load"                           – play on page load (default: when scrolled into view)
 *   data-delay="0.2"                                 – delay in seconds
 *
 * Elements are only hidden up-front when <html> has the `motion-ok` class,
 * which the inline script in Layout.astro sets (unless reduced motion is
 * preferred). Without JS, content is simply visible.
 */

type Effect = 'fade' | 'fade-up' | 'fade-blur' | 'scale';

function play(el: HTMLElement) {
	const effect = (el.dataset.animate || 'fade-up') as Effect;
	const delay = Number(el.dataset.delay) || 0;

	switch (effect) {
		case 'fade':
			return animate(el, { opacity: [0, 1] }, { duration: 0.8, delay, ease: 'easeOut' });
		case 'fade-blur':
			return animate(
				el,
				{ opacity: [0, 1], filter: ['blur(12px)', 'blur(0px)'] },
				{ duration: 1, delay, ease: 'easeOut' },
			);
		case 'scale':
			return animate(
				el,
				{ opacity: [0, 1], scale: ['0.92', '1'] },
				{ duration: 0.6, delay, ease: [0.34, 1.56, 0.64, 1] },
			);
		default:
			return animate(
				el,
				{ opacity: [0, 1], translate: ['0 20px', '0 0'], filter: ['blur(6px)', 'blur(0px)'] },
				{ duration: 0.6, delay, ease: [0.4, 0, 0.2, 1] },
			);
	}
}

function init() {
	const root = document.documentElement;
	if (!root.classList.contains('motion-ok')) return;

	for (const el of document.querySelectorAll<HTMLElement>('[data-animate]')) {
		if (el.dataset.animateOn === 'load') {
			play(el);
		} else {
			inView(el, () => void play(el), { margin: '0px 0px -10% 0px' });
		}
	}

	root.dataset.motionReady = 'true';
}

init();
