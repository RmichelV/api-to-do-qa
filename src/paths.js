// Absolute paths derived from this module's own URL, never from the
// working directory (plan T8): the server must serve the same files no
// matter where the process was started from.
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
export const PUBLIC_AUTH_DIR = fileURLToPath(new URL('../public-auth', import.meta.url));
