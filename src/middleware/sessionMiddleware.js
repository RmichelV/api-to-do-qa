// Session resolution (design §5.2): rotation every 24 h of use with a 60 s
// grace for the previous token, last_seen touched at most every 5 min.
// Never blocks: it only attaches req.user / req.session when the qa_session
// cookie carries a live session; the 401s belong to the protected routes.
import { parseCookies, buildSessionCookie } from '../utils/cookies.js';
import * as sessionRepository from '../repositories/sessionRepository.js';
import * as userRepository from '../repositories/userRepository.js';
import { toUserShape } from '../services/authService.js';
import {
  isExpired,
  needsRotation,
  isPreviousTokenValid,
  shouldTouchLastSeen,
  sessionMaxAgeSeconds,
} from '../services/sessionPolicy.js';

export function sessionMiddleware({ pool, secure = false }) {
  return async function resolveSession(req, res, next) {
    try {
      const token = parseCookies(req.headers.cookie).qa_session;
      if (!token) return next();

      const tokenHash = sessionRepository.hashToken(token);
      const now = new Date();
      let session = await sessionRepository.findByTokenHash(pool, tokenHash);
      let usingPrevious = false;
      if (!session) {
        session = await sessionRepository.findByPreviousTokenHash(pool, tokenHash);
        usingPrevious = Boolean(session);
      }
      if (!session || isExpired(session, now)) return next();

      const user = await userRepository.findById(pool, session.user_id);
      if (!user || user.is_active !== 1) return next();

      if (usingPrevious) {
        if (!isPreviousTokenValid(session, now)) return next();
        req.user = toUserShape(user);
        req.session = session;
        return next();
      }

      if (needsRotation(session, now)) {
        const newToken = sessionRepository.generateSessionToken();
        const rotated = await sessionRepository.rotate(pool, {
          id: session.id,
          newTokenHash: sessionRepository.hashToken(newToken),
          expectedTokenHash: tokenHash,
          now,
        });
        if (rotated) {
          res.set('Set-Cookie', buildSessionCookie(newToken, sessionMaxAgeSeconds(session, now), { secure }));
        }
        // CAS lost → a concurrent request already rotated; the session is
        // still valid, we just keep the cookie as-is (grace covers it).
      } else if (shouldTouchLastSeen(session, now)) {
        await sessionRepository.touchLastSeen(pool, { id: session.id, now });
      }

      req.user = toUserShape(user);
      req.session = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}
