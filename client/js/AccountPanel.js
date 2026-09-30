import { escapeHtml } from './UIManager.js';

// Profile → account card. Guest (local only) ↔ online account:
//   guest:  "Go online" (creates the account with the driver name and moves progress to the
//           cloud, clamped) · "Use a transfer code" (continue an account from another phone)
//   online: sync status · "Transfer to another phone" (one-time code) · delete the account
// Everything here is menu-time networking; nothing touches a race.
export class AccountPanel {
  constructor(game) {
    this.game = game;
    this.mode = 'view'; // view | code-entry | code-shown
    this.message = '';
    this.code = '';
    this.el = document.getElementById('identity-card');
    this.el.addEventListener('click', e => this.onClick(e));
    this.el.addEventListener('submit', e => this.onSubmit(e));
  }

  render() {
    const g = this.game;
    const players = g.players;
    const online = g.api.online;
    const msg = this.message ? `<p class="id-msg" role="alert">${escapeHtml(this.message)}</p>` : '';
    const off = online ? '' : 'disabled';
    if (!players.registered) {
      if (this.mode === 'code-entry') {
        this.el.innerHTML = `<div class="id-main"><span class="hud-label">Continue on this phone</span>
            <p>Enter the transfer code from your other phone. The account's progress replaces this phone's.</p></div>
          <form data-code-form novalidate><input type="text" name="code" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX" aria-label="Transfer code" ${off}>
            <button class="btn-small ghost" type="submit" ${off}>Continue</button><button class="btn-small link" type="button" data-acct="cancel">Cancel</button></form>${msg}`;
        return;
      }
      this.el.innerHTML = `<div class="id-main"><span class="hud-label">Guest profile · saved on this device</span>
          <p>${online ? 'Go online to back up your progress, race on the leaderboards and play on another phone later. Only your driver name is shared.'
    : 'Offline — you can go online when you are connected. Your progress is always saved on this device.'}</p></div>
        <div class="id-actions"><button class="btn-small ghost" data-acct="create" ${off}>Go online</button>
          <button class="btn-small link" data-acct="code" ${off}>Use a transfer code</button></div>${msg}`;
      return;
    }
    const sync = g.sync;
    const status = !online ? 'Offline — changes will sync when you reconnect'
      : sync.pending ? `${sync.pending} change${sync.pending > 1 ? 's' : ''} waiting to sync`
        : 'All progress saved to the cloud';
    const code = this.mode === 'code-shown' && this.code
      ? `<div class="transfer-code"><span class="hud-label">Transfer code · works once</span><b>${escapeHtml(this.code)}</b>
          <small>On your other phone: Profile → Use a transfer code. Keep it private.</small></div>` : '';
    this.el.innerHTML = `<div class="id-main"><span class="hud-label">Online account</span>
        <b class="id-name">${escapeHtml(players.name)}</b><p>${escapeHtml(status)}</p></div>
      <div class="id-actions">
        <button class="btn-small ghost" data-acct="transfer" ${off}>Transfer to another phone</button>
        <button class="btn-small" data-acct="delete" ${off}>Delete online account</button>
      </div>${code}${msg}`;
  }

  async onClick(e) {
    const act = e.target.closest('[data-acct]');
    if (!act) return;
    const g = this.game;
    g.audio.ui('click');
    this.message = '';
    const a = act.dataset.acct;
    if (a === 'cancel') this.mode = 'view';
    else if (a === 'code') this.mode = 'code-entry';
    else if (a === 'create') await this.goOnline();
    else if (a === 'transfer') {
      const r = await g.players.transferCode();
      if (r.ok) {
        this.code = r.code;
        this.mode = 'code-shown';
      } else {
        this.message = r.message;
      }
    } else if (a === 'delete') {
      if (!window.confirm('Delete your online account? Leaderboard entries and cloud progress are removed. Progress on this device is kept.')) return;
      const r = await g.players.remove();
      if (r.ok) {
        g.sync.clear();
        g.ui.toast('Online account deleted', 'You are playing as a guest', 'mission');
      } else {
        this.message = r.message;
      }
    }
    this.render();
  }

  async goOnline() {
    const g = this.game;
    const profile = g.save.profile;
    const r = await g.players.create(profile ? profile.name : '');
    if (!r.ok) {
      this.message = r.message;
      return;
    }
    g.shell.emit('profile', { action: 'created' });
    await g.sync.flush(); // imports this phone's progress (clamped) and adopts the cloud copy
    g.ui.toast('Online', `Racing as ${g.players.name}`, 'unlock');
  }

  async onSubmit(e) {
    const form = e.target.closest('[data-code-form]');
    if (!form) return;
    e.preventDefault();
    const g = this.game;
    if (!window.confirm('Continue that account on this phone? Its cloud progress replaces the progress on this phone.')) return;
    const r = await g.players.recover(form.elements.code.value);
    if (!r.ok) {
      this.message = r.message;
      this.render();
      return;
    }
    g.sync.clear();
    g.sync.adopt(r.progress, r.revision, 'recover');
    g.store.setProfile(g.players.name, g.save.profile ? g.save.profile.avatar : undefined);
    this.mode = 'view';
    g.ui.toast('Welcome back', `Racing as ${g.players.name}`, 'unlock');
    g.menus.renderers.profile();
  }
}
