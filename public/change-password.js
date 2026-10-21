// Change-password screen (design §7.4, §7.1, §5.1): client-side checks are
// for usability only — the server is the authority for security. On success
// (204) the page returns to "/". If the session is gone the server answers
// 401 with error "unauthenticated" and only then we send the user to the
// login screen; any other 401 (wrong current password) just shows its message.
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

const form = document.getElementById('cp-form');
const errorBox = document.getElementById('cp-error');
const successBox = document.getElementById('cp-success');
const submitButton = document.getElementById('cp-submit');

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearFeedback() {
  errorBox.textContent = '';
  errorBox.hidden = true;
  successBox.hidden = true;
}

function clientValidationError() {
  const current = document.getElementById('cp-current').value;
  const next = document.getElementById('cp-new').value;
  const confirm = document.getElementById('cp-confirm').value;
  if (!current || !next || !confirm) return 'Fill in every field.';
  if (next.length < MIN_LENGTH || next.length > MAX_LENGTH) {
    return `The new password must be ${MIN_LENGTH} to ${MAX_LENGTH} characters long.`;
  }
  if (next === current) return 'The new password must be different from the current one.';
  if (next !== confirm) return 'The new password and the confirmation do not match.';
  return null;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFeedback();

  const localError = clientValidationError();
  if (localError) {
    showError(localError);
    return;
  }

  submitButton.disabled = true;
  try {
    const response = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: document.getElementById('cp-current').value,
        newPassword: document.getElementById('cp-new').value,
      }),
    });
    if (response.ok) {
      successBox.hidden = false;
      window.location.href = '/';
      return;
    }
    const body = await response.json().catch(() => null);
    if (response.status === 401 && body?.error === 'unauthenticated') {
      window.location.href = '/login.html';
      return;
    }
    // 401 invalid_credentials · 400 validation_error (policy) · 429 too_many_attempts
    showError(body?.message ?? 'Could not change the password. Try again.');
  } catch {
    showError('Could not reach the server. Try again.');
  } finally {
    submitButton.disabled = false;
  }
});
