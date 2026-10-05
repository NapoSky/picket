import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '@picket/kernel';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 10;

/** Identifiants courts d'assets (10 caractères, 36^10 possibilités) : portés par les `custom_id` des boutons. */
export class RandomAssetIds implements IdGenerator {
  next(): string {
    let id = '';
    for (const byte of randomBytes(LENGTH)) id += ALPHABET[byte % ALPHABET.length];
    return id;
  }
}
