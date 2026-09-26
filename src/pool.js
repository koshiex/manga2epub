/** Fixed-size pool of module workers. Each worker takes one job at a time. */
export class WorkerPool {
  #workers = [];
  #idle = [];
  #queue = [];
  #busy = new Map();
  #nextId = 1;
  #closed = false;

  constructor(url, size) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(url, { type: 'module' });
      worker.onmessage = ({ data }) => this.#finish(worker, data.error ? new Error(data.error) : null, data);
      worker.onerror = (event) => {
        event.preventDefault();
        this.#finish(worker, new Error(event.message || 'Ошибка воркера'), null);
      };
      this.#workers.push(worker);
      this.#idle.push(worker);
    }
  }

  get size() {
    return this.#workers.length;
  }

  run(payload) {
    if (this.#closed) return Promise.reject(new DOMException('Пул остановлен', 'AbortError'));
    return new Promise((resolve, reject) => {
      this.#queue.push({ id: this.#nextId++, payload, resolve, reject });
      this.#pump();
    });
  }

  terminate() {
    this.#closed = true;
    this.#workers.forEach((worker) => worker.terminate());
    const error = new DOMException('Отменено', 'AbortError');
    [...this.#busy.values(), ...this.#queue].forEach((job) => job.reject(error));
    this.#busy.clear();
    this.#queue = [];
    this.#idle = [];
  }

  #pump() {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.pop();
      const job = this.#queue.shift();
      this.#busy.set(worker, job);
      worker.postMessage({ id: job.id, ...job.payload });
    }
  }

  #finish(worker, error, data) {
    const job = this.#busy.get(worker);
    if (!job) return;
    this.#busy.delete(worker);
    this.#idle.push(worker);
    if (error) job.reject(error);
    else job.resolve(data);
    this.#pump();
  }
}
