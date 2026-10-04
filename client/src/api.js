export async function request(path, { signal, ...options } = {}) {
  const response = await fetch(path, {
    ...options,
    signal,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Dashboard-Request': '1', ...options.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const write = (path, body, method = 'POST') => request(path, {
  method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
