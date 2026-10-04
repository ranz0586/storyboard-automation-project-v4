export class StoryboardPoller {
  #pending = false;

  constructor({ queue, run, makeClients, onError = () => {} }) {
    this.queue = queue;
    this.run = run;
    this.makeClients = makeClients;
    this.onError = onError;
  }

  tick() {
    if (this.#pending) return false;
    this.#pending = true;
    const accepted = this.queue.tryEnqueue(async () => {
      try {
        await this.run({ clients: this.makeClients() });
      } catch (error) {
        this.onError(error);
      } finally {
        this.#pending = false;
      }
    });
    if (!accepted) this.#pending = false;
    return accepted;
  }
}
