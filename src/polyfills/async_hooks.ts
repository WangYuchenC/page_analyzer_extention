// Polyfill for node:async_hooks in browser environment
// Based on @langchain/core MockAsyncLocalStorage

export class AsyncLocalStorage<T> {
  private store: Map<number, T> = new Map();
  private id = 0;

  run<R>(store: T, callback: () => R): R {
    const currentId = ++this.id;
    this.store.set(currentId, store);
    try {
      return callback();
    } finally {
      this.store.delete(currentId);
    }
  }

  getStore(): T | undefined {
    return this.store.get(this.id);
  }
}

export function createHook() {
  return {
    enable: () => {},
    disable: () => {},
  };
}

export const executionAsyncId = () => 1;
export const triggerAsyncId = () => 0;
