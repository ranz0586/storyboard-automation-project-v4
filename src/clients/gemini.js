import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { extractJson } from '../utils/json.js';
import { KeyPool } from '../utils/keyPool.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A 503 means the selected model is temporarily overloaded. Give it a brief
// chance to recover before moving to the configured fallback. Do not retry
// quota or request errors here; those follow the existing fallback/key path.
export async function generateWithServerRetry(model, prompt, { wait = sleep, random = Math.random } = {}) {
  for (let retry = 0; ; retry++) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      const unavailable = err?.status === 503 || /\b503\b|SERVICE_UNAVAILABLE|Service Unavailable/i.test(err?.message || '');
      if (!unavailable || retry >= 2) throw err;
      await wait((1_000 * 2 ** retry) + Math.floor(random() * 500));
    }
  }
}

// One process-wide pool so every GeminiClient (and concurrent pipeline run)
// shares the same per-key cooldowns.
let sharedPool = null;
function pool() {
  if (!sharedPool) {
    sharedPool = new KeyPool(config.gemini.apiKeys, {
      cooldownMs: config.gemini.keyCooldownMs,
      label: 'Gemini keys',
    });
    logger.info(
      `Gemini key pool: ${sharedPool.size} key(s), ${Math.round(config.gemini.keyCooldownMs / 1000)}s cooldown per key`
    );
  }
  return sharedPool;
}

// Replicates the workflow's Gemini nodes: one primary model with an
// automatic fallback model (n8n "needsFallback: true" + second lmChat node).
// Each generate() call checks out one API key from the pool; with N keys the
// pipeline can make N calls per cooldown window before it has to wait.
export class GeminiClient {
  constructor({ apiKeys = config.gemini.apiKeys, primary = config.gemini.modelPrimary,
    fallback = config.gemini.modelFallback, keyPool, modelFactory, retryOptions } = {}) {
    if (!apiKeys.length) {
      throw new Error('No Gemini API keys set (GEMINI_API_KEYS or GEMINI_API_KEY)');
    }
    this.primary = primary;
    this.fallback = fallback;
    this.keyPool = keyPool || (apiKeys === config.gemini.apiKeys ? null : new KeyPool(apiKeys, {
      cooldownMs: config.gemini.keyCooldownMs, label: 'Gemini keys',
    }));
    this.modelFactory = modelFactory;
    this.retryOptions = retryOptions;
  }

  #model(apiKey, name, systemInstruction, json) {
    return new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: name,
      systemInstruction,
      generationConfig: {
        temperature: 0.4,
        // Force JSON when the agent expects a structured response.
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    });
  }

  // Run a single-shot agent turn. Tries primary model, falls back on error.
  // Primary + fallback share the acquired key: they count as one use. If BOTH
  // models 429 on a key (its daily quota is likely spent), rotate to the next
  // key from the pool instead of failing the call — up to one full lap.
  async generate({ system, prompt, json = false }) {
    const keys = this.keyPool || pool();
    const maxKeyAttempts = Math.max(1, keys.size);
    let lastErr;
    for (let attempt = 0; attempt < maxKeyAttempts; attempt++) {
      const { key, index } = await keys.acquire();
      for (const [label, name] of [
        ['primary', this.primary],
        ['fallback', this.fallback],
      ]) {
        try {
          const model = this.modelFactory
            ? this.modelFactory({ apiKey: key, name, system, json }) : this.#model(key, name, system, json);
          const res = await generateWithServerRetry(model, prompt, this.retryOptions);
          const text = res.response.text();
          return json ? extractJson(text) : text;
        } catch (err) {
          lastErr = err;
          logger.warn(`Gemini ${label} model "${name}" failed (key #${index + 1})`, err?.message);
        }
      }
      const rateLimited = lastErr?.status === 429 || /429|quota|Too Many Requests/i.test(lastErr?.message || '');
      if (!rateLimited) break; // non-quota error: another key won't help
      if (attempt < maxKeyAttempts - 1) {
        logger.warn(`Gemini key #${index + 1} appears out of quota — rotating to next key`);
      }
    }
    throw lastErr;
  }
}

export const gemini = () => new GeminiClient();
