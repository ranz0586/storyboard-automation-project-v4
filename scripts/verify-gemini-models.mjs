import fs from 'node:fs';
import { config } from '../src/config.js';

// Metadata only: no generateContent, Airtable writes or Telegram messages.
// Never log request headers, credential values or raw provider responses.
const result = { checkedAt: new Date().toISOString(), configured: {
  primary: config.gemini.modelPrimary, fallback: config.gemini.modelFallback,
}, available: [], missing: [], status: 'FAILED' };
try {
  const key = config.gemini.apiKeys[0];
  if (!key) throw new Error('No Gemini key configured');
  let pageToken;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${query}`, {
      headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) { result.httpStatus = response.status; throw new Error('Model metadata request failed'); }
    const data = await response.json();
    result.available.push(...(data.models || []).filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => model.name.replace(/^models\//, '')));
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  if (pageToken) throw new Error('Model metadata pagination did not complete');
  result.missing = Object.values(result.configured).filter(name => !result.available.includes(name));
  result.status = result.missing.length ? 'MODELS_MISSING' : 'AVAILABLE';
} catch {
  // A sanitized status is enough to diagnose access/network failure.
  result.status = 'FAILED';
}
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/hardening-models.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, available: result.available.filter(name => /flash/.test(name)) }, null, 2));
if (result.status !== 'AVAILABLE') process.exitCode = 1;
