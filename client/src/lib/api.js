let accessToken = null;
let csrfToken = null;
let refreshInFlight = null;
let onSessionExpired = () => {};

export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn; };

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function ensureCsrf(force = false) {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'CSRF', 'Could not start a secure session');
  csrfToken = (await res.json()).csrfToken;
  return csrfToken;
}

async function send(path, { method = 'GET', body, auth = false } = {}, retriedCsrf = false) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (method !== 'GET') headers['X-CSRF-Token'] = await ensureCsrf();

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
  }

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;

  const err = data.error || {};
  if (res.status === 403 && err.code === 'CSRF' && !retriedCsrf) {
    await ensureCsrf(true);
    return send(path, { method, body, auth }, true);
  }
  throw new ApiError(res.status, err.code || 'ERROR', err.message || 'Something went wrong', err.details);
}

async function request(path, opts = {}) {
  try {
    return await send(path, opts);
  } catch (err) {
    if (opts.auth && err.status === 401) {
      try {
        await refresh();
        return await send(path, opts);
      } catch {
        accessToken = null;
        onSessionExpired();
      }
    }
    throw err;
  }
}

export function refresh() {
  refreshInFlight ??= send('/auth/refresh', { method: 'POST' })
    .then((data) => { accessToken = data.accessToken; return data.user; })
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

const startSession = (data) => { accessToken = data.accessToken; return data.user; };

export const api = {
  signup: (body) => send('/auth/signup', { method: 'POST', body }).then(startSession),
  login: (body) => send('/auth/login', { method: 'POST', body }).then(startSession),
  async logout() {
    try { await send('/auth/logout', { method: 'POST' }); } finally { accessToken = null; csrfToken = null; }
  },
  async logoutAll() {
    try { await request('/auth/logout-all', { method: 'POST', auth: true }); } finally { accessToken = null; csrfToken = null; }
  },
  me: () => request('/auth/me', { auth: true }).then((d) => d.user),
  meetings: {
    create: (body) => request('/meetings', { method: 'POST', body, auth: true }).then((d) => d.meeting),
    list: () => request('/meetings', { auth: true }).then((d) => d.meetings),
    enter: (roomId) => request(`/meetings/${roomId}/enter`, { method: 'POST', auth: true }),
    regenerate: (roomId, body = {}) => request(`/meetings/${roomId}/regenerate-invite`, { method: 'POST', body, auth: true }).then((d) => d.meeting),
    end: (roomId) => request(`/meetings/${roomId}/end`, { method: 'POST', auth: true }),
    lookup: (invite) => send('/meetings/lookup', { method: 'POST', body: { invite }, auth: true }),
    join: (body) => send('/meetings/join', { method: 'POST', body, auth: true }),
  },
};
