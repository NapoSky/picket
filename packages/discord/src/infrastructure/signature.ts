import { createPublicKey, verify } from 'node:crypto';

// Préfixe DER (SPKI) d'une clé publique Ed25519 brute de 32 octets.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/i;
const SIGNATURE_HEX = /^[0-9a-f]{128}$/i;
const TIMESTAMP = /^\d{1,12}$/;

export function createSignatureVerifier(publicKeyHex: string) {
  if (!PUBLIC_KEY_HEX.test(publicKeyHex)) throw new Error('Invalid Discord public key');
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]),
    format: 'der',
    type: 'spki',
  });

  return (signatureHex: string, timestamp: string, body: Buffer): boolean => {
    if (!SIGNATURE_HEX.test(signatureHex)) return false;
    try {
      return verify(null, Buffer.concat([Buffer.from(timestamp), body]), key, Buffer.from(signatureHex, 'hex'));
    } catch {
      return false;
    }
  };
}

/** Rejette les horodatages hors tolérance pour limiter le rejeu d'une requête signée capturée. */
export function isTimestampFresh(timestamp: string, nowMs: number, toleranceSeconds: number): boolean {
  if (!TIMESTAMP.test(timestamp)) return false;
  return Math.abs(nowMs / 1000 - Number(timestamp)) <= toleranceSeconds;
}
