// Login page (design §7.1, §7.4): POST /api/auth/login and surface the
// server's error codes (401 invalid_credentials, 429 too_many_attempts,
// 400 validation_error). Success goes to "/". This page is public and is
// the login screen itself, so it never bounces back to itself.
const form = document.getElementById('login-form');
const errorBox = document.getElementById('login-error');
const submitButton = document.getElementById('login-submit');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  submitButton.disabled = true;
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('login-email').value.trim(),
        // Password is never trimmed: leading/trailing spaces are significant.
        password: document.getElementById('login-password').value,
      }),
    });
    if (response.ok) {
      window.location.href = '/';
      return;
    }
    const body = await response.json().catch(() => null);
    showError(body?.message ?? 'Sign-in failed. Try again.');
  } catch {
    showError('Could not reach the server. Try again.');
  } finally {
    submitButton.disabled = false;
  }
});
