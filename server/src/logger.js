// Tiny structured logger: JSON lines in production (easy to ship to any log service),
// readable lines in development. Never pass secrets, tokens or raw request bodies here.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger({ level = 'info', json = false } = {}) {
  const min = LEVELS[level] ?? LEVELS.info;
  const write = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return;
    const time = new Date().toISOString();
    if (json) {
      process.stdout.write(`${JSON.stringify({ time, level: lvl, msg, ...fields })}\n`);
    } else {
      const extra = fields && Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : '';
      const stream = LEVELS[lvl] >= LEVELS.warn ? process.stderr : process.stdout;
      stream.write(`${time} ${lvl.toUpperCase().padEnd(5)} ${msg}${extra}\n`);
    }
  };
  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
