/* The shared header: opens the menu on a phone, opens the "Homes" list, and marks the current page.
   The header markup is the same on every page, so the current page is worked out here from the address. */
(function () {
  'use strict';
  const header = document.querySelector('.mw-header');
  if (!header) return;
  const menu = header.querySelector('.mw-menu-btn');
  const subs = Array.from(header.querySelectorAll('.mw-nav button[aria-expanded]'));
  const here = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1') || '/';

  header.querySelectorAll('.mw-nav a').forEach((a) => {
    const url = new URL(a.href, location.href);
    if (url.hash) return; // a link to a section of another page is never "the current page"
    const path = url.pathname.replace(/(.)\/$/, '$1') || '/';
    const match = path === here || (path === '/notes' && here.indexOf('/notes/') === 0);
    if (!match) return;
    a.setAttribute('aria-current', 'page');
    const group = a.closest('.sub');
    if (group) group.parentElement.classList.add('is-current');
  });

  const closeSubs = (except) => subs.forEach((b) => { if (b !== except) b.setAttribute('aria-expanded', 'false'); });
  subs.forEach((b) => b.addEventListener('click', () => {
    const open = b.getAttribute('aria-expanded') === 'true';
    closeSubs(b);
    b.setAttribute('aria-expanded', open ? 'false' : 'true');
  }));
  if (menu) menu.addEventListener('click', () => {
    const open = header.classList.toggle('is-open');
    menu.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  document.addEventListener('click', (e) => { if (!header.contains(e.target)) closeSubs(null); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeSubs(null);
    if (menu && header.classList.contains('is-open')) { header.classList.remove('is-open'); menu.setAttribute('aria-expanded', 'false'); menu.focus(); }
  });
})();
