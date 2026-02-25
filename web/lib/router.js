// Path-based router using pushState: /model/org/Name, /hw/gpu_key, /provider/name

let routes = [];
let currentCleanup = null;

export function register(pattern, handler) {
  routes.push({ pattern, handler });
}

export function navigate(path) {
  if (window.location.pathname !== path) {
    history.pushState({}, '', path);
  }
  dispatch();
}

function dispatch() {
  const path = window.location.pathname || '/';

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  // Hero visible only on landing page; top-bar search on all detail pages
  const isLanding = (path === '/');
  const hero = document.querySelector('.hero');
  if (hero) hero.style.display = isLanding ? '' : 'none';
  const topSearch = document.getElementById('top-search');
  if (topSearch) topSearch.style.display = isLanding ? 'none' : '';

  const container = document.getElementById('content');
  container.innerHTML = '';

  for (const route of routes) {
    const match = path.match(route.pattern);
    if (match) {
      const cleanup = route.handler(container, match);
      if (typeof cleanup === 'function') {
        currentCleanup = cleanup;
      }
      window.scrollTo({ top: 0 });
      return;
    }
  }

  // Default: trending
  for (const route of routes) {
    if (route.pattern.toString().includes('\\/')) continue;
    const match = '/'.match(route.pattern);
    if (match) {
      const cleanup = route.handler(container, match);
      if (typeof cleanup === 'function') currentCleanup = cleanup;
      return;
    }
  }
}

export function start() {
  window.addEventListener('popstate', dispatch);

  // Intercept local <a> clicks for SPA navigation
  document.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    // Skip external links, mailto, new-tab links
    if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) return;
    if (a.target === '_blank') return;
    // Skip non-path hrefs
    if (!href.startsWith('/')) return;
    e.preventDefault();
    navigate(href);
  });

  dispatch();
}
