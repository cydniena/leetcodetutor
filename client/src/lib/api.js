// Single place that talks to the API.
//
// credentials: 'include' is what carries the session cookie. The cookie is
// HttpOnly, so nothing here (or anywhere in JS) can read the token -- the
// browser just attaches it.

export class ApiError extends Error {
  constructor(status, code, fields) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = fields || null;
  }

  /** A message worth putting in front of a person. */
  get display() {
    return {
      login_required: 'Please log in.',
      invalid_credentials: 'That email and password do not match.',
      email_taken: 'An account with that email already exists.',
      admin_only: 'That area is for admins only.',
      not_found: 'Not found.',
      validation_failed: 'Please check the highlighted fields.',
      too_many_attempts: 'Too many attempts. Please wait a moment and try again.',
    }[this.code] || 'Something went wrong. Please try again.';
  }
}

export async function apiFetch(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, payload.error || 'unknown_error', payload.fields);
  return payload;
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body }),
  del: (path) => apiFetch(path, { method: 'DELETE' }),
};
