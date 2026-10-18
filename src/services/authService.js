// Login/logout flow (design §5.4, §7.1). Services never read `req` (§4.5):
// controllers pass ip/userAgent explicitly.
import { randomUUID } from 'node:crypto';
import * as userRepository from '../repositories/userRepository.js';
import * as sessionRepository from '../repositories/sessionRepository.js';
import * as loginAttemptRepository from '../repositories/loginAttemptRepository.js';
import { verify, verifyDummy } from './passwordService.js';
import { isExpired } from './sessionPolicy.js';
import { AppError } from '../utils/errors.js';

const FAILED_EMAIL_LIMIT = 5;
const FAILED_IP_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
const SESSION_PURGE_AFTER_DAYS = 7;

export function toUserShape(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    mustChangePassword: user.must_change_password === 1,
  };
}

export function createAuthService({ pool, sessionDays = 7 }) {
  async function purgeOpportunistically(now) {
    try {
      await loginAttemptRepository.purgeOlderThan(pool, {
        cutoff: new Date(now.getTime() - ATTEMPT_PURGE_AFTER_MS),
      });
      await sessionRepository.purgeExpired(pool, {
        now,
        olderThanDays: SESSION_PURGE_AFTER_DAYS,
      });
    } catch (error) {
      // Purge is opportunistic (§5.2): its failure must never block a login.
      console.error('[auth] opportunistic purge failed:', error.message);
    }
  }

  return {
    async login({ email, password }, { ip = '', userAgent = null, currentToken = null } = {}) {
      const now = new Date();
      if (typeof email !== 'string' || email.trim() === '' || typeof password !== 'string' || password === '') {
        throw new AppError(400, 'validation_error', 'Email and password are required.');
      }
      const normalizedEmail = userRepository.normalizeEmail(email);

      await purgeOpportunistically(now);

      const since = new Date(now.getTime() - RATE_WINDOW_MS);
      const failedEmail = await loginAttemptRepository.countFailed(pool, { email: normalizedEmail, since });
      const failedIp = await loginAttemptRepository.countFailedByIp(pool, { ip, since });
      if (failedEmail >= FAILED_EMAIL_LIMIT || failedIp >= FAILED_IP_LIMIT) {
        throw new AppError(429, 'too_many_attempts', 'Too many attempts. Try again later.');
      }

      const user = await userRepository.findByEmail(pool, normalizedEmail);
      const passwordOk =
        user && user.is_active === 1
          ? await verify(password, user.password_hash)
          : await verifyDummy(password).then(() => false);

      if (!passwordOk) {
        await loginAttemptRepository.record(pool, { email: normalizedEmail, ip, succeeded: false, now });
        throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
      }

      await loginAttemptRepository.record(pool, { email: normalizedEmail, ip, succeeded: true, now });

      // Re-login with a live session cookie: revoke that session before
      // issuing the new one, so the browser holds a single active session.
      if (currentToken) {
        const currentHash = sessionRepository.hashToken(currentToken);
        const carried =
          (await sessionRepository.findByTokenHash(pool, currentHash)) ??
          (await sessionRepository.findByPreviousTokenHash(pool, currentHash));
        if (carried && !isExpired(carried, now)) {
          await sessionRepository.revoke(pool, { id: carried.id, now });
        }
      }

      const token = sessionRepository.generateSessionToken();
      const expiresAt = new Date(now.getTime() + sessionDays * 24 * 60 * 60 * 1000);
      await sessionRepository.create(pool, {
        id: randomUUID(),
        userId: user.id,
        tokenHash: sessionRepository.hashToken(token),
        expiresAt,
        now,
        userAgent: userAgent == null ? null : String(userAgent).slice(0, 255),
        ip: ip || null,
      });
      await pool.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);

      const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
      return { token, user: toUserShape(user), maxAgeSeconds };
    },

    async logout(token) {
      if (!token) return;
      const tokenHash = sessionRepository.hashToken(token);
      const session =
        (await sessionRepository.findByTokenHash(pool, tokenHash)) ??
        (await sessionRepository.findByPreviousTokenHash(pool, tokenHash));
      if (session) await sessionRepository.revoke(pool, { id: session.id });
    },
  };
}
