// Hash-based router: #/model/org/Name, #/hw/gpu_key, #/provider/name

let routes = [];
let currentCleanup = null;

export function register(pattern, handler) {
  routes.push({ pattern, handler });
}

export function navigate(hash) {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    dispatch();
  }
}

function dispatch() {
  const hash = window.location.hash.slice(1) || '/';

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  // Hero visible on landing and model pages; top-bar search on other detail pages
  const isLanding = (hash === '/');
  const isModel = hash.startsWith('/model/');
  const showHero = isLanding || isModel;
  const hero = document.querySelector('.hero');
  if (hero) hero.style.display = showHero ? '' : 'none';
  // On model pages, hide the title/subtitle/browse-links, keep just the search bar
  const heroTitle = hero?.querySelector('h1');
  const heroSub = hero?.querySelector('#hero-sub');
  const browseLinks = hero?.querySelector('.browse-links');
  if (heroTitle) heroTitle.style.display = isLanding ? '' : 'none';
  if (heroSub) heroSub.style.display = isLanding ? '' : 'none';
  if (browseLinks) browseLinks.style.display = isLanding ? '' : 'none';
  const topSearch = document.getElementById('top-search');
  if (topSearch) topSearch.style.display = showHero ? 'none' : '';

  const container = document.getElementById('content');
  container.innerHTML = '';

  for (const route of routes) {
    const match = hash.match(route.pattern);
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
  window.addEventListener('hashchange', dispatch);
  dispatch();
}
