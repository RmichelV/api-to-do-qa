// Bootstrap / emergency admin creation from the CLI (design §3, S1).
//
// The password is asked on the console and never accepted as an argument, so
// it never lands in shell history or the process list. The first admin is
// created here; further users go through the admin API (T9).
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { hash, validatePolicy } from '../src/services/passwordService.js';
import {
  countActiveAdmins,
  create,
  findByEmail,
} from '../src/repositories/userRepository.js';

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
        // spaces; visible answers (email, name) are trimmed.
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
    const activeAdmins = await countActiveAdmins(pool);
    if (activeAdmins > 0) {
      console.error(
        '[create-admin] an active admin already exists; create further users through the admin API.'
      );
      process.exitCode = 1;
      return;
    }

    const email = await prompts.question('Email: ');
    const fullName = await prompts.question('Full name: ');
    if (!email.includes('@') || !email.trim()) {
      console.error('[create-admin] invalid email.');
      process.exitCode = 1;
      return;
    }
    if (!fullName) {
      console.error('[create-admin] full name is required.');
      process.exitCode = 1;
      return;
    }

    const password = await prompts.question('Password (hidden): ', { hidden: true });
    const confirm = await prompts.question('Repeat password (hidden): ', { hidden: true });
    if (password !== confirm) {
      console.error('[create-admin] passwords do not match.');
      process.exitCode = 1;
      return;
    }
    const policy = validatePolicy(password);
    if (!policy.valid) {
      console.error(`[create-admin] password rejected: ${policy.errors.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    if (await findByEmail(pool, email)) {
      console.error('[create-admin] that email already exists.');
      process.exitCode = 1;
      return;
    }

    // The CLI admin sets their own password interactively, so no forced
    // change is needed (forced change applies to admin-set passwords, §5.5).
    const passwordHash = await hash(password);
    const user = await create(pool, {
      id: randomUUID(),
      email,
      fullName,
      role: 'admin',
      passwordHash,
      mustChangePassword: false,
      createdBy: null,
    });
    console.log(`[create-admin] admin created: ${user.email} (${user.id})`);
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
    console.error(`[create-admin] ${error.message}`);
    process.exitCode = 1;
  });
}
