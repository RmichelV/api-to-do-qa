// Login/logout flow (design §5.4, §7.1). Services never read `req` (§4.5):
// controllers pass ip/userAgent explicitly.
import { randomUUID } from 'node:crypto';
import * as userRepository from '../repositories/userRepository.js';
import * as sessionRepository from '../repositories/sessionRepository.js';
import * as loginAttemptRepository from '../repositories/loginAttemptRepository.js';
import { verify, verifyDummy, hash, validatePolicy } from './passwordService.js';
import { isExpired, sessionMaxAgeSeconds } from './sessionPolicy.js';
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

  // §5.4 brute force, shared by login and password change: 5 failed attempts
  // per email or 20 per IP within 15 minutes block before any scrypt work
  // (both flows write to the same login_attempts table, so their failures
  // count against the same caps).
  async function assertWithinRateLimit({ email, ip, now }) {
    const since = new Date(now.getTime() - RATE_WINDOW_MS);
    const failedEmail = await loginAttemptRepository.countFailed(pool, { email, since });
    const failedIp = await loginAttemptRepository.countFailedByIp(pool, { ip, since });
    if (failedEmail >= FAILED_EMAIL_LIMIT || failedIp >= FAILED_IP_LIMIT) {
      throw new AppError(429, 'too_many_attempts', 'Too many attempts. Try again later.');
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

      await assertWithinRateLimit({ email: normalizedEmail, ip, now });

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

    // Self-service password change (design §7.1, §5.1, §5.2, §5.5):
    // verify the current password, apply the policy to the new one, store the
    // new hash, clear must_change_password, revoke every OTHER session and
    // rotate the current one (new cookie; expiry is never extended).
    async changePassword(
      { userId, currentPassword, newPassword, sessionId, currentToken, ip = '' },
      { now = new Date() } = {}
    ) {
      if (
        typeof currentPassword !== 'string' || currentPassword === '' ||
        typeof newPassword !== 'string' || newPassword === ''
      ) {
        throw new AppError(400, 'validation_error', 'Current password and new password are required.');
      }

      const user = await userRepository.findById(pool, userId);
      if (!user || user.is_active !== 1) {
        throw new AppError(401, 'unauthenticated', 'Authentication required.');
      }

      // Same §5.4 limits as login: a blocked client never reaches scrypt.
      await assertWithinRateLimit({ email: user.email, ip, now });

      // Verify the current password before any policy feedback (§5.1).
      if (!(await verify(currentPassword, user.password_hash))) {
        await loginAttemptRepository.record(pool, { email: user.email, ip, succeeded: false, now });
        throw new AppError(401, 'invalid_credentials', 'Invalid current password.');
      }

      const policy = validatePolicy(newPassword, currentPassword);
      if (!policy.valid) {
        throw new AppError(
          400,
          'validation_error',
          `New password does not meet the policy: ${policy.errors.join(', ')}.`
        );
      }

      await userRepository.updatePassword(pool, {
        id: user.id,
        passwordHash: await hash(newPassword),
        now,
      });

      // §5.2: revoke all other sessions, then rotate the current one.
      await sessionRepository.revokeAllForUser(pool, {
        userId: user.id,
        exceptId: sessionId,
        now,
      });

      let token = null;
      let maxAgeSeconds = 0;
      if (sessionId && currentToken) {
        const newToken = sessionRepository.generateSessionToken();
        const rotated = await sessionRepository.rotate(pool, {
          id: sessionId,
          newTokenHash: sessionRepository.hashToken(newToken),
          expectedTokenHash: sessionRepository.hashToken(currentToken),
          now,
        });
        if (rotated) {
          const session = await sessionRepository.findById(pool, sessionId);
          token = newToken;
          maxAgeSeconds = sessionMaxAgeSeconds(session, now);
        }
        // CAS lost (concurrent rotation within the grace window): the
        // password is already changed and the other sessions are revoked;
        // the caller keeps the cookie it has, still covered by the grace.
      }
      return { token, maxAgeSeconds };
    },
  };
}
