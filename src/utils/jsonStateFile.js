import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

export function isProcessOwnerAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  if (owner.host !== os.hostname()) throw new Error('JSON state requires all server processes on the same host');
  try { process.kill(owner.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export function recoverStateLocks({ files, serversStopped = false }) {
  if (!serversStopped) throw new Error('Stop all server processes before state-lock recovery');
  const targets = [...new Set(files.map(file => path.resolve(file)))];
  // Check every target before removing any lock. Never reclaim a live owner.
  for (const file of targets) {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const run of data.runs || []) {
        if (['QUEUED', 'RUNNING'].includes(run.status) && isProcessOwnerAlive(run.owner)) {
          throw new Error('A run owner is still alive; stop all servers before recovery');
        }
      }
    }
    const lock = `${file}.lock`;
    if (fs.existsSync(lock)) {
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (!owner.token || !owner.pid || !owner.host) throw new Error('Unowned state lock requires manual inspection');
      if (isProcessOwnerAlive(owner)) throw new Error('State lock owner is still alive');
    }
  }
  const recovered = [];
  for (const file of targets) {
    const lock = `${file}.lock`;
    if (!fs.existsSync(lock)) continue;
    const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
    if (isProcessOwnerAlive(owner)) throw new Error('State lock owner became live; recovery aborted');
    fs.unlinkSync(lock);
    recovered.push(lock);
  }
  return recovered;
}

// Synchronous, bounded transactions preserve the existing store API. Never
// perform asynchronous work, provider calls or generation inside a transaction.
export class JsonStateFile {
  #file;
  #working = null;
  #memory;
  constructor(filePath, initial) {
    this.#file = filePath ? path.resolve(filePath) : null;
    this.#memory = structuredClone(initial);
  }
  transaction(work) {
    if (this.#working) return work(this.#working);
    if (!this.#file) {
      this.#working = structuredClone(this.#memory);
      try {
        const result = work(this.#working);
        if (result?.then) throw new Error('State transactions must be synchronous');
        this.#memory = this.#working;
        return result;
      } finally { this.#working = null; }
    }
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    const lock = `${this.#file}.lock`, token = randomUUID(), deadline = Date.now() + 10_000;
    // Link a fully written owner file into place atomically. A crash between
    // exclusive creation and writing must not leave an ownerless lock.
    const ownerFile = `${this.#file}.${token}.owner`;
    fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, host: os.hostname(), token }), { flag: 'wx' });
    try {
      while (true) {
        try {
          fs.linkSync(ownerFile, lock);
          break;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          try {
            const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
            if (!isProcessOwnerAlive(owner)) {
              // Do not race two reclaimers against a new live owner. Recovery
              // can remove this exact lock once all server processes are stopped.
              throw new Error(`State lock belongs to exited process ${owner.pid}; recover it with servers stopped`);
            }
          } catch (readError) {
            if (readError.code === 'ENOENT') continue;
            // Exclusive creation may precede owner writing. Fail closed rather
            // than steal an unowned lock; a corrupt lock needs operator recovery.
            if (!(readError instanceof SyntaxError)) throw readError;
          }
          if (Date.now() >= deadline) throw new Error('Timed out waiting for state transaction lock');
          Atomics.wait(waitBuffer, 0, 0, 10);
        }
      }
    } finally { fs.unlinkSync(ownerFile); }
    let temp;
    try {
      this.#working = fs.existsSync(this.#file)
        ? JSON.parse(fs.readFileSync(this.#file, 'utf8')) : structuredClone(this.#memory);
      const before = JSON.stringify(this.#working);
      const result = work(this.#working);
      if (result?.then) throw new Error('State transactions must be synchronous');
      if (JSON.stringify(this.#working) !== before) {
        temp = `${this.#file}.${token}.tmp`;
        const fd = fs.openSync(temp, 'wx');
        try { fs.writeFileSync(fd, JSON.stringify(this.#working, null, 2)); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(temp, this.#file);
        temp = null;
      }
      return result;
    } finally {
      this.#working = null;
      if (temp && fs.existsSync(temp)) fs.unlinkSync(temp);
      if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock);
    }
  }
}
