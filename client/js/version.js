// Single source of truth for versions. The build checks GAME_VERSION against package.json,
// the service worker cache name is derived from it, and the API rejects incompatible clients.
export const GAME_NAME = 'Night Vector';
export const GAME_VERSION = '1.0.0';
export const API_VERSION = 1; // bump when request/response shapes change incompatibly
export const SAVE_VERSION = 1; // bump together with a migration in SaveManager
