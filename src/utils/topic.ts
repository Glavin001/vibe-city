/**
 * Simple pub/sub topic implementation for event management
 */
export class Topic<T extends any[]> {
  private listeners: Set<(...args: T) => void> = new Set();

  /**
   * Add a listener to this topic
   * @param listener The listener function to add
   * @returns A function to remove the listener
   */
  add(listener: (...args: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.remove(listener);
  }

  /**
   * Remove a listener from this topic
   * @param listener The listener function to remove
   */
  remove(listener: (...args: T) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   * @param args The arguments to pass to each listener
   */
  emit(...args: T): void {
    for (const listener of this.listeners) {
      listener(...args);
    }
  }

  /**
   * Remove all listeners
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get the number of listeners
   */
  get size(): number {
    return this.listeners.size;
  }
}

