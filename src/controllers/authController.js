// Thin HTTP adapter for the auth endpoints (design §7.1): parse the
// request, delegate to the service, serialize the response. No business
// logic here (§4.5).
import { parseCookies, buildSessionCookie, buildClearCookie } from '../utils/cookies.js';
import { AppError } from '../utils/errors.js';

const SESSION_COOKIE = 'qa_session';

export function createAuthController({ service, secure = false }) {
  return {
    async login(req, res) {
      const { token, user, maxAgeSeconds } = await service.login(
        { email: req.body?.email, password: req.body?.password },
        {
          ip: req.ip ?? '',
          userAgent: req.get('user-agent'),
          currentToken: parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null,
        }
      );
      res.set('Set-Cookie', buildSessionCookie(token, maxAgeSeconds, { secure }));
      res.status(200).json({ user });
    },

    async logout(req, res) {
      await service.logout(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
      res.set('Set-Cookie', buildClearCookie({ secure }));
      res.status(204).end();
    },

    async me(req, res) {
      if (!req.user) throw new AppError(401, 'unauthenticated', 'Authentication required.');
      res.status(200).json({ user: req.user });
    },

    async changePassword(req, res) {
      if (!req.user || !req.session) {
        throw new AppError(401, 'unauthenticated', 'Authentication required.');
      }
      const { token, maxAgeSeconds } = await service.changePassword({
        userId: req.user.id,
        currentPassword: req.body?.currentPassword,
        newPassword: req.body?.newPassword,
        sessionId: req.session.id,
        currentToken: parseCookies(req.headers.cookie)[SESSION_COOKIE] ?? null,
        ip: req.ip ?? '',
      });
      if (token) res.set('Set-Cookie', buildSessionCookie(token, maxAgeSeconds, { secure }));
      res.status(204).end();
    },
  };
}
