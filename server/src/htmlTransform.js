// Fills the runtime placeholders in index.html. Used by the server (on the fly) and by the
// production build, so both produce identical pages.
const escapeAttr = s => String(s).replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);

export function transformHtml(html, { publicUrl = '', apiUrl = '', appEnv = 'development' }) {
  return html
    .replaceAll('__PUBLIC_URL__', escapeAttr(publicUrl))
    .replaceAll('__API_URL__', escapeAttr(apiUrl))
    .replaceAll('__APP_ENV__', escapeAttr(appEnv));
}
