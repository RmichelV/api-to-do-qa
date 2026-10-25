// Admin users management (design §7.2; specs S1 and S5). Services never read
// `req` (§4.5): the controller passes the acting admin id explicitly.
//
// Two guards protect the role table (§7.2):
//   1. "at least one active admin must remain" → 409 last_admin, enforced in a
//      transaction that locks every active admin row;
//   2. "an admin cannot deactivate or demote themselves" → 409 self_change.
// The invariant is checked first, so the only admin demoting themselves gets
// the accurate `last_admin` answer.
// A third rule reuses `self_change` for a self password reset (§7.2 reset):
// it would revoke the acting admin's own session, so the admin screen points
// them to "Change password" instead (plan T9b).
import { randomUUID } from 'node:crypto';
import * as userRepository from '../repositories/userRepository.js';
import * as sessionRepository from '../repositories/sessionRepository.js';
import { hash, validatePolicy } from './passwordService.js';
import { AppError } from '../utils/errors.js';

export const USER_ROLES = Object.freeze(['admin', 'qa_engineer']);
const MAX_EMAIL_LENGTH = 254;
const MAX_FULL_NAME_LENGTH = 120;

// Explicit allow-list of public fields: password_hash (and every other
// column) never leaves the server (§7.2: "never includes password_hash").
export function toAdminUserShape(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    isActive: user.is_active === 1,
    mustChangePassword: user.must_change_password === 1,
    lastLoginAt: user.last_login_at,
    createdAt: user.created_at,
  };
}

function assertNoUnknownFields(body, allowed) {
  const unknown = Object.keys(body ?? {}).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new AppError(400, 'validation_error', `Unknown fields: ${unknown.join(', ')}.`);
  }
}

function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'validation_error', `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AppError(400, 'validation_error', `${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

function assertRole(role) {
  if (!USER_ROLES.includes(role)) {
    throw new AppError(400, 'validation_error', `role must be one of: ${USER_ROLES.join(', ')}.`);
  }
  return role;
}

// Passwords are never trimmed (§5.1), so the value is used verbatim.
function assertTemporaryPassword(temporaryPassword) {
  if (typeof temporaryPassword !== 'string' || temporaryPassword === '') {
    throw new AppError(400, 'validation_error', 'temporaryPassword is required.');
  }
  const policy = validatePolicy(temporaryPassword);
  if (!policy.valid) {
    throw new AppError(
      400,
      'validation_error',
      `temporaryPassword rejected: ${policy.errors.join(', ')}.`
    );
  }
  return temporaryPassword;
}

export function createAdminUserService({ pool }) {
  async function requireUser(id) {
    const user = await userRepository.findById(pool, id);
    if (!user) throw new AppError(404, 'user_not_found', 'User not found.');
    return user;
  }

  return {
    async list() {
      const users = await userRepository.listAll(pool);
      return users.map(toAdminUserShape);
    },

    // POST /api/admin/users (§7.2): the account starts active with a
    // temporary password, so must_change_password = 1 (§5.5).
    async createUser({ body, actorId }) {
      assertNoUnknownFields(body, ['email', 'fullName', 'role', 'temporaryPassword']);
      const email = requireNonEmptyString(body?.email, 'email', MAX_EMAIL_LENGTH);
      if (!email.includes('@')) {
        throw new AppError(400, 'validation_error', 'email must be a valid address.');
      }
      const fullName = requireNonEmptyString(body?.fullName, 'fullName', MAX_FULL_NAME_LENGTH);
      const role = assertRole(body?.role);
      const temporaryPassword = assertTemporaryPassword(body?.temporaryPassword);

      if (await userRepository.findByEmail(pool, email)) {
        throw new AppError(409, 'email_exists', 'That email already belongs to a user.');
      }

      const passwordHash = await hash(temporaryPassword);
      try {
        const user = await userRepository.create(pool, {
          id: randomUUID(),
          email,
          fullName,
          role,
          passwordHash,
          mustChangePassword: true,
          isActive: true,
          createdBy: actorId ?? null,
        });
        return toAdminUserShape(user);
      } catch (error) {
        // Unique key race with a concurrent create (users are never deleted).
        if (error?.code === 'ER_DUP_ENTRY') {
          throw new AppError(409, 'email_exists', 'That email already belongs to a user.');
        }
        throw error;
      }
    },

    // PATCH /api/admin/users/:id (§7.2). Deactivation also revokes every
    // session of the target user (§5.2).
    async updateUser({ id, body, actorId }) {
      assertNoUnknownFields(body, ['fullName', 'role', 'isActive']);
      if (typeof id !== 'string' || id.trim() === '') {
        throw new AppError(400, 'validation_error', 'User id is required.');
      }
      const hasFullName = body?.fullName !== undefined;
      const hasRole = body?.role !== undefined;
      const hasIsActive = body?.isActive !== undefined;
      if (!hasFullName && !hasRole && !hasIsActive) {
        throw new AppError(
          400,
          'validation_error',
          'At least one of fullName, role or isActive is required.'
        );
      }

      const patch = {};
      if (hasFullName) {
        patch.fullName = requireNonEmptyString(body.fullName, 'fullName', MAX_FULL_NAME_LENGTH);
      }
      if (hasRole) patch.role = assertRole(body.role);
      if (hasIsActive) {
        if (typeof body.isActive !== 'boolean') {
          throw new AppError(400, 'validation_error', 'isActive must be a boolean.');
        }
        patch.isActive = body.isActive;
      }

      const target = await requireUser(id);
      const removesActiveAdmin =
        target.role === 'admin' &&
        target.is_active === 1 &&
        ((patch.role !== undefined && patch.role !== 'admin') || patch.isActive === false);

      let updated;
      if (!removesActiveAdmin) {
        updated = await userRepository.updateUser(pool, { id, ...patch });
      } else {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          // Locking read: a concurrent demotion cannot slip between the
          // count and the update.
          const activeAdminIds = await userRepository.listActiveAdminIdsForUpdate(connection);
          const otherAdmins = activeAdminIds.filter((adminId) => adminId !== id);
          if (otherAdmins.length === 0) {
            throw new AppError(409, 'last_admin', 'At least one active admin must remain.');
          }
          if (id === actorId) {
            throw new AppError(
              409,
              'self_change',
              'Admins cannot demote or deactivate their own account.'
            );
          }
          updated = await userRepository.updateUser(connection, { id, ...patch });
          await connection.commit();
        } catch (error) {
          try {
            await connection.rollback();
          } catch {
            // The connection may already be unusable; nothing else to clean up.
          }
          throw error;
        } finally {
          connection.release();
        }
      }

      if (patch.isActive === false) {
        await sessionRepository.revokeAllForUser(pool, { userId: id });
      }
      return toAdminUserShape(updated);
    },

    // POST /api/admin/users/:id/reset-password (§7.2): a temporary password,
    // forced change (§5.5) and every session of the user revoked (§5.2).
    // Resetting your OWN account would revoke the acting admin's session, so
    // the screen sends them to "Change password" instead (plan T9b).
    async resetPassword({ id, body, actorId }) {
      assertNoUnknownFields(body, ['temporaryPassword']);
      const temporaryPassword = assertTemporaryPassword(body?.temporaryPassword);
      await requireUser(id);
      if (id === actorId) {
        throw new AppError(
          409,
          'self_change',
          'Admins cannot reset their own account here. Use "Change password".'
        );
      }
      await userRepository.setTemporaryPassword(pool, {
        id,
        passwordHash: await hash(temporaryPassword),
      });
      await sessionRepository.revokeAllForUser(pool, { userId: id });
    },
  };
}
