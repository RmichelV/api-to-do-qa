[...document.querySelectorAll('.ddc-wrapper a[href*="#"]')]
  .map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href') }))// Top bar of index.html (design §7.4, plan T7): shows the signed-in user's
// name and offers "Change password" and "Logout". Loads GET /api/auth/me and
// redirects to /login.html ONLY when the server answers 401 with
// error === "unauthenticated" — never on any other 401 or status (T7 note).
const userName = document.getElementById('auth-user-name');
const logoutButton = document.getElementById('auth-logout');
// Ships hidden in index.html: only an admin gets it revealed (S13, T9b).
const usersLink = document.getElementById('auth-users');
const uploadCsvLink = document.getElementById('auth-upload-csv');

function redirectToLogin() {
  window.location.href = '/login.html';
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
    if (user.role === 'admin') {
      if (usersLink) usersLink.hidden = false;
      if (uploadCsvLink) uploadCsvLink.hidden = false;
    }
  } catch {
    // Network hiccup: leave the bar as-is; do NOT redirect.
  }
}

logoutButton.addEventListener('click', async () => {
  try {
    // Idempotent server-side (§7.1); clears the session cookie either way.
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    redirectToLogin();
  }
});

loadUser();
