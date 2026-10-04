export class TaskQueue {
  #active = 0;
  #pending = [];
  #maxConcurrency;
  #maxQueued;
  #onError;

  constructor({ maxConcurrency = 1, maxQueued = 10, onError = () => {} } = {}) {
    this.#maxConcurrency = Math.max(1, Number(maxConcurrency) || 1);
    this.#maxQueued = Math.max(0, Number(maxQueued) || 0);
    this.#onError = onError;
  }

  get active() {
    return this.#active;
  }

  get queued() {
    return this.#pending.length;
  }

  get canAccept() {
    return this.#active < this.#maxConcurrency || this.#pending.length < this.#maxQueued;
  }

  tryEnqueue(task) {
    if (typeof task !== 'function') throw new TypeError('TaskQueue requires a task function');
    if (!this.canAccept) {
      return false;
    }
    this.#pending.push(task);
    this.#drain();
    return true;
  }

  #drain() {
    while (this.#active < this.#maxConcurrency && this.#pending.length) {
      const task = this.#pending.shift();
      this.#active += 1;
      Promise.resolve()
        .then(task)
        .catch(this.#onError)
        .finally(() => {
          this.#active -= 1;
          this.#drain();
        });
    }
  }
}
