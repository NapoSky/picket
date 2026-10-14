/** Sensitive value: never leaked by `toString`, `JSON.stringify` or `util.inspect`. */
export class Secret<T extends string = string> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  reveal(): T {
    return this.#value;
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[REDACTED]';
  }
}
