// Runs on every page: theme (dark by default, remembered per browser) and the phone menu.
import './site.css';

const root = document.documentElement;
const SUN = document.querySelector('[data-theme-toggle]')?.innerHTML ?? '';
const MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

function paintToggle() {
  const btn = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (!btn) return;
  const light = root.dataset.theme === 'light';
  btn.innerHTML = light ? MOON : SUN;
  btn.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
}

document.querySelector('[data-theme-toggle]')?.addEventListener('click', () => {
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light';
  try {
    localStorage.setItem('hirivo-theme', root.dataset.theme);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  paintToggle();
});
paintToggle();

const nav = document.querySelector<HTMLElement>('[data-nav]');
const menu = document.querySelector<HTMLButtonElement>('[data-menu]');
menu?.addEventListener('click', () => {
  const open = nav?.dataset.open !== 'true';
  if (nav) nav.dataset.open = String(open);
  menu.setAttribute('aria-expanded', String(open));
});
nav?.querySelectorAll('.nav-links a').forEach((a) => a.addEventListener('click', () => nav && (nav.dataset.open = 'false')));
