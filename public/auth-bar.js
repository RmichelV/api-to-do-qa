// Top bar of every protected page (design §7.4, plan T7): the main
// navigation, the signed-in user's menu, "Change password" and "Logout".
// Loads GET /api/auth/me and redirects to /login.html ONLY when the server
// answers 401 with error === "unauthenticated" — never on any other 401 or
// status (T7 note).
//
// Navigation groups that belong to one role ship `hidden` with a
// `data-roles` list and are revealed here. Hiding is only UX: the server
// still answers 403 on every role-gated page and route.
const userName = document.getElementById('auth-user-name');
const userRole = document.getElementById('auth-user-role');
const logoutButton = document.getElementById('auth-logout');
// Ships hidden in the markup: only an admin gets it revealed (S13, T9b).
const usersLink = document.getElementById('auth-users');
const nav = document.getElementById('app-nav');
const navToggle = document.getElementById('nav-toggle');
const menus = Array.from(document.querySelectorAll('.topbar details.nav-menu'));

const ROLE_LABELS = { admin: 'Admin', qa_engineer: 'QA Engineer', qa_shadow: 'QA Shadow' };

function redirectToLogin() {
  window.location.href = '/login.html';
}

function revealForRole(role) {
  for (const element of document.querySelectorAll('[data-roles]')) {
    const roles = element.dataset.roles.split(/\s+/);
    element.hidden = !roles.includes(role);
  }
  if (usersLink && role === 'admin') {
    usersLink.hidden = false;
  }
}

async function loadUser() {
  try {
    const response = await fetch('/api/auth/me');
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      if (response.status === 401 && body?.error === 'unauthenticated') {
        redirectToLogin();
      }
      return;
    }
    const { user } = await response.json();
    userName.textContent = user.fullName || user.email;
    userName.title = user.email;
    if (userRole) userRole.textContent = `${ROLE_LABELS[user.role] ?? user.role} · ${user.email}`;
    revealForRole(user.role);
  } catch {
    // Network hiccup: leave the bar as-is; do NOT redirect.
  }
}

// The current page: its link gets aria-current and its group is marked,
// so the user always sees where they are.
function markCurrentPage() {
  const here = window.location.pathname === '/index.html' ? '/' : window.location.pathname;
  for (const link of document.querySelectorAll('.app-nav a.nav-menu__item')) {
    const target = new URL(link.href, window.location.origin);
    if (target.pathname === here && !target.hash) {
      link.setAttribute('aria-current', 'page');
      link.closest('details.nav-menu')?.classList.add('nav-menu--current');
    }
  }
}

// Dropdowns: one open at a time, closed by a click outside, by Escape or
// after choosing an item.
function closeMenus(except = null) {
  for (const menu of menus) {
    if (menu !== except) menu.open = false;
  }
}

for (const menu of menus) {
  menu.addEventListener('toggle', () => {
    if (menu.open) closeMenus(menu);
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('.topbar details.nav-menu')) closeMenus();
  if (event.target.closest('.nav-menu__panel a')) closeMenus();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const open = menus.find((menu) => menu.open);
  closeMenus();
  open?.querySelector('summary')?.focus();
  setNavOpen(false);
});

// Narrow screens: the groups fold behind the ☰ button.
function setNavOpen(open) {
  if (!nav || !navToggle) return;
  nav.classList.toggle('app-nav--open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
}

navToggle?.addEventListener('click', () => {
  setNavOpen(!nav.classList.contains('app-nav--open'));
});

logoutButton.addEventListener('click', async () => {
  try {
    // Idempotent server-side (§7.1); clears the session cookie either way.
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    redirectToLogin();
  }
});

markCurrentPage();
loadUser();
