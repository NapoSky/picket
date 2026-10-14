import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '@picket/kernel';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 10;

/** Short asset identifiers (10 characters, 36^10 possibilities), carried in button `custom_id` values. */
export class RandomAssetIds implements IdGenerator {
  next(): string {
    let id = '';
    for (const byte of randomBytes(LENGTH)) id += ALPHABET[byte % ALPHABET.length];
    return id;
  }
}
