// Small HTTP helpers shared by the app and the API. Errors always have the same shape:
// { error: { code, message } } — never stack traces or internal details.

export function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

export function sendError(res, status, code, message, extra = {}) {
  sendJson(res, status, { error: { code, message, ...extra } });
}

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Reads a JSON body with a hard size cap. Rejects wrong content types and malformed JSON.
export function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] || '';
    if (!/^application\/json\b/i.test(type) && !/^text\/plain\b/i.test(type)) {
      // text/plain is what navigator.sendBeacon uses for analytics batches.
      reject(new HttpError(415, 'unsupported_media_type', 'Expected application/json.'));
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (declared > maxBytes) {
      reject(new HttpError(413, 'payload_too_large', 'Request body too large.'));
      req.resume();
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        // Keep draining (discarding) so the 413 response can still be delivered; the
        // server's requestTimeout bounds how long a client can keep streaming.
        if (!tooLarge) {
          tooLarge = true;
          chunks.length = 0;
          reject(new HttpError(413, 'payload_too_large', 'Request body too large.'));
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > maxBytes) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, 'invalid_json', 'Malformed JSON body.'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'bad_request', 'Could not read request body.')));
  });
}

// Client IP for rate limiting. X-Forwarded-For is only honoured behind a trusted proxy,
// otherwise anyone could spoof it to dodge limits.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
