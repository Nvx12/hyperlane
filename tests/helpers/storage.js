// Minimal in-memory localStorage for running client modules under Node.
export class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.throwOnAccess = false;
  }

  check() {
    if (this.throwOnAccess) throw new DOMException('blocked', 'SecurityError');
  }

  getItem(k) {
    this.check();
    return this.map.has(k) ? this.map.get(k) : null;
  }

  setItem(k, v) {
    this.check();
    this.map.set(k, String(v));
  }

  removeItem(k) {
    this.check();
    this.map.delete(k);
  }

  clear() {
    this.map.clear();
  }
}

export function installStorage() {
  const storage = new MemoryStorage();
  globalThis.localStorage = storage;
  return storage;
}
