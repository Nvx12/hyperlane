import { GAME_VERSION } from '../version.js';

// Ranked race sessions. When an online player starts a race, a session is requested in the
// background — never blocking the countdown. The server stamps its start time, which later
// bounds how long the run can claim to have lasted. The finished run itself travels through
// the sync queue (SyncManager) with the session id attached, so it is retried like any other
// operation if the network drops at the end of the run.
export class RaceService {
  constructor(api, players) {
    this.api = api;
    this.players = players;
    this.session = null; // Promise<string | null>
  }

  begin(carId, envId) {
    this.session = null;
    if (!this.players.registered || navigator.onLine === false) return;
    this.session = this.api
      .request('POST', '/races', { token: this.players.token, body: { carId, envId, clientVersion: GAME_VERSION }, timeout: 5000 })
      .then(r => (r.ok ? r.data.sessionId : null));
  }

  // Hands the pending session (or null) to the run being settled; one run per session.
  takeSession() {
    const s = this.session;
    this.session = null;
    return s;
  }
}
