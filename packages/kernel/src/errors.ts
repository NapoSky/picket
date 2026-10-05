export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class InvalidIdError extends DomainError {
  readonly code = 'invalid_id';
}
