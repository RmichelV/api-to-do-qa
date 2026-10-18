// Cookie helpers (design §5.2). Parsed by hand to keep mysql2 as the only
// new dependency (D2).
const SESSION_COOKIE = 'qa_session';

export function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

export function buildSessionCookie(token, maxAgeSeconds, { secure }) {
  const flags = `Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax`;
  return `${SESSION_COOKIE}=${token}; ${flags}${secure ? '; Secure' : ''}`;
}

export function buildClearCookie({ secure }) {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
