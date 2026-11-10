import { z } from 'zod';

// Both apps forbid eval via CSP. Without this, zod probes `new Function` for its JIT, which
// Firefox reports as a CSP violation even though zod catches the error.
z.config({ jitless: true });

export { z };
