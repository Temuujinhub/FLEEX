// Decides when to surface the lightweight mobile summary ("/m") instead of the
// full operator console ("/app").
//
// Order of precedence:
//   1. An explicit, sticky user choice (the "Бүрэн самбар" / "Хөнгөн харагдац"
//      toggles persist here) — the user always wins.
//   2. Otherwise a device heuristic: real phones, data-saver, or very slow
//      connections get the light page; desktops get the console.
//
// Used at login (where to land) and as a guard on the /app index route.

const KEY = 'fleex.view';
export type ViewPref = 'full' | 'lite';

export function getViewPref(): ViewPref | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'full' || v === 'lite' ? v : null;
  } catch {
    return null;
  }
}

export function setViewPref(v: ViewPref) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* private mode / storage disabled — fall back to heuristic */
  }
}

export function clearViewPref() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// Heuristic for "this is most likely a phone or a constrained client". We
// require a coarse pointer (or a mobile UA) so a desktop with a narrow window
// is NOT misclassified — resizing a browser shouldn't kick you to the phone UI.
export function isLikelyMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const mm = window.matchMedia?.bind(window);
  const narrow = mm ? mm('(max-width: 768px)').matches : window.innerWidth <= 768;
  const coarse = mm ? mm('(pointer: coarse)').matches : false;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|BlackBerry/i.test(ua);

  // Data-saver or 2g-class link → prefer the cheap page (no map, fewer calls).
  const conn = (typeof navigator !== 'undefined' && (navigator as any).connection) || null;
  const saveData = !!conn?.saveData;
  const slow = typeof conn?.effectiveType === 'string' && /2g/i.test(conn.effectiveType);

  return (narrow && coarse) || uaMobile || saveData || slow;
}

// True when the lightweight view should be shown: an explicit 'lite' choice, or
// no choice yet on a mobile-class device. An explicit 'full' choice always wins.
export function preferLite(): boolean {
  const pref = getViewPref();
  if (pref) return pref === 'lite';
  return isLikelyMobile();
}

// Where a just-authenticated user should land.
export function homeRoute(): string {
  return preferLite() ? '/m' : '/app';
}
