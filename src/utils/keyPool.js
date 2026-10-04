import { logger } from './logger.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Rotating pool of API keys where each key can be acquired at most once per
// cooldown window. acquire() hands out the longest-idle available key, or —
// when every key is cooling down — waits for the soonest one to free up.
//
// Share ONE pool per credential set across the whole process: concurrent
// pipeline runs must see the same cooldowns or the per-key limit is broken.
export class KeyPool {
  #keys;
  #nextAvailableAt;
  #cooldownMs;
  #label;

  constructor(keys, { cooldownMs = 5 * 60_000, label = 'key pool' } = {}) {
    this.#keys = [...new Set((keys ?? []).map((k) => String(k ?? '').trim()).filter(Boolean))];
    if (!this.#keys.length) throw new Error(`${label}: no keys configured`);
    this.#nextAvailableAt = new Array(this.#keys.length).fill(0);
    this.#cooldownMs = Math.max(0, Number(cooldownMs) || 0);
    this.#label = label;
  }

  get size() {
    return this.#keys.length;
  }

  // Resolves with { key, index }. The cooldown starts at acquisition — a failed
  // call still spends the slot, since a 429'd request counts against quota too.
  async acquire() {
    for (;;) {
      const now = Date.now();
      // Pick the available key that has been idle the longest. This block has
      // no await, so concurrent acquirers can never be handed the same slot.
      let pick = -1;
      for (let i = 0; i < this.#keys.length; i++) {
        const at = this.#nextAvailableAt[i];
        if (at <= now && (pick === -1 || at < this.#nextAvailableAt[pick])) pick = i;
      }
      if (pick !== -1) {
        this.#nextAvailableAt[pick] = now + this.#cooldownMs;
        return { key: this.#keys[pick], index: pick };
      }
      const waitMs = Math.max(Math.min(...this.#nextAvailableAt) - now, 50);
      logger.info(`${this.#label}: all ${this.size} key(s) cooling down, waiting ${Math.ceil(waitMs / 1000)}s`);
      // No unref(): the pending timer must keep one-shot runs alive mid-wait.
      await sleep(waitMs + 25);
    }
  }
}
