import assert from 'node:assert/strict';
import { hashPassword } from '../../src/http/passwords.js';

export const testPassword = 'testing-password-only';
const passwordHash = await hashPassword(testPassword);
export function userClient(client = {}, projectIds = ['recProject1', 'recProject2', 'recProject']) {
  const account = { id: 'recUser', fields: { username: 'tester', full_name: 'Test User', email: 'test@example.com',
    password_hash: passwordHash, status: 'Active', Projects: projectIds } };
  return { findUserByUsername: async name => name === 'tester' ? account : null,
    getUser: async () => account, ...client };
}
export async function login(base) {
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dashboard-Request': '1' },
    body: JSON.stringify({ username: 'tester', password: testPassword }),
  });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], 'X-Dashboard-Request': '1' };
}
