// Emergency password reset from the CLI (design §5.5, S14).
//
// For whoever has shell access to the server when the only admin forgot
// their password. The temporary password is asked on the console and never
// accepted as an argument, so it never lands in shell history or the
// process list. Same prompt pattern as create-admin: no trim() on hidden
// answers, line queue for piped/tested input.
//
// The CLI never creates users nor changes roles: it only replaces the
// password of an existing account, leaves must_change_password = 1 (§5.5)
// and revokes every live session of that user (§5.2).
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { hash, validatePolicy } from '../src/services/passwordService.js';
import { findByEmail, setTemporaryPassword } from '../src/repositories/userRepository.js';
import { revokeAllForUser } from '../src/repositories/sessionRepository.js';

// One readline interface for the whole session, with a line queue:
// rl.question drops every line that arrives in the same chunk after the
// first one, which breaks piped/tested input. Lines are queued instead and
// each prompt pops the next one.
function createPromptSession() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  const defaultWriteToOutput = rl._writeToOutput.bind(rl);
  const bufferedLines = [];
  const waiters = [];
  let closed = false;

  rl.on('line', (line) => {
    // No trim here: hidden answers (passwords) must be stored exactly as
    // typed; visible answers are trimmed by question() below.
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else bufferedLines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length > 0) waiters.shift()(null);
  });

  return {
    question(question, { hidden = false } = {}) {
      return new Promise((resolve, reject) => {
        // Passwords (hidden) are taken verbatim, including surrounding
        // spaces; visible answers (email) are trimmed.
        const finish = (answer) => (hidden ? answer : answer.trim());
        rl._writeToOutput = hidden
          ? (stringToWrite) => {
              if (stringToWrite.includes(question)) rl.output.write(question);
            }
          : defaultWriteToOutput;
        rl.output.write(question);
        // Piped input can deliver every answer and EOF before the first
        // prompt runs (the DB check is async), so buffered lines are served
        // even after stdin closed.
        if (bufferedLines.length > 0) {
          resolve(finish(bufferedLines.shift()));
          return;
        }
        if (closed) {
          reject(new Error('stdin closed before the answer was provided'));
          return;
        }
        waiters.push((answer) => {
          rl._writeToOutput = defaultWriteToOutput;
          if (answer === null) reject(new Error('stdin closed before the answer was provided'));
          else resolve(finish(answer));
        });
      });
    },
    close() {
      rl.close();
    },
  };
}

async function main() {
  const config = loadConfig();
  const pool = createPool(config);
  const prompts = createPromptSession();
  try {
    const email = await prompts.question('Email of the user to reset: ');
    if (!email.includes('@')) {
      console.error('[reset-password] invalid email.');
      process.exitCode = 1;
      return;
    }

    // Existence is checked before asking for the password: on an emergency
    // there is no point typing a temporary password for a missing account.
    const user = await findByEmail(pool, email);
    if (!user) {
      console.error('[reset-password] no user with that email.');
      process.exitCode = 1;
      return;
    }

    const password = await prompts.question('Temporary password (hidden): ', { hidden: true });
    const confirm = await prompts.question('Repeat password (hidden): ', { hidden: true });
    if (password !== confirm) {
      console.error('[reset-password] passwords do not match.');
      process.exitCode = 1;
      return;
    }
    const policy = validatePolicy(password);
    if (!policy.valid) {
      console.error(`[reset-password] password rejected: ${policy.errors.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hash(password);
    // Admin-set temporary password: force the change on next login (§5.5).
    const updated = await setTemporaryPassword(pool, { id: user.id, passwordHash });
    // Password reset invalidates every live session of the user (§5.2).
    const revoked = await revokeAllForUser(pool, { userId: user.id });
    console.log(
      `[reset-password] password reset: ${updated.email}; ${revoked} session(s) revoked; ` +
        'the user must change the password at next login.'
    );
  } finally {
    prompts.close();
    await pool.end();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`[reset-password] ${error.message}`);
    process.exitCode = 1;
  });
}
