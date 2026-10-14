import { RegistryError, type AccessLevel, type CommandContext } from './commands';
import type { Reply } from './interaction';

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]{0,7}$/;
const PAYLOAD_PATTERN = /^[A-Za-z0-9_.:-]{0,80}$/;
/** Discord `custom_id` length limit. */
export const CUSTOM_ID_MAX_LENGTH = 100;
const MAX_VERSION = 99;

export interface ComponentContext extends CommandContext {
  /** Variable part of the `custom_id`, validated by the codec. */
  readonly payload: string;
}

export type ComponentHandler = (context: ComponentContext) => Promise<Reply>;

/** A feature's component family (buttons, modals): namespace, version and required access level. */
export interface ComponentFamily {
  readonly namespace: string;
  /** Treat a `custom_id` from another version as expired: bump the version when the format changes. */
  readonly version: number;
  readonly level: AccessLevel;
  /** Guild feature that must be enabled. */
  readonly feature?: string;
  readonly availableWhenSuspended?: boolean;
  readonly onComponent?: ComponentHandler;
  readonly onModal?: ComponentHandler;
}

export interface DecodedCustomId {
  readonly namespace: string;
  readonly version: number;
  readonly payload: string;
}

/** No sensitive state in the identifier: only what is needed to find the clicked item. */
export function encodeCustomId(namespace: string, version: number, payload: string): string {
  if (!NAMESPACE_PATTERN.test(namespace)) throw new RegistryError(`Invalid component namespace "${namespace}"`);
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) {
    throw new RegistryError(`Invalid component version ${version}`);
  }
  if (!PAYLOAD_PATTERN.test(payload)) throw new RegistryError(`Invalid component payload "${payload}"`);
  const encoded = `${namespace}:${version}:${payload}`;
  if (encoded.length > CUSTOM_ID_MAX_LENGTH) throw new RegistryError(`Custom id over ${CUSTOM_ID_MAX_LENGTH} characters`);
  return encoded;
}

export function decodeCustomId(raw: string | null): DecodedCustomId | null {
  if (raw === null || raw.length > CUSTOM_ID_MAX_LENGTH) return null;
  const first = raw.indexOf(':');
  const second = raw.indexOf(':', first + 1);
  if (first < 1 || second < 0) return null;
  const namespace = raw.slice(0, first);
  const version = Number(raw.slice(first + 1, second));
  const payload = raw.slice(second + 1);
  if (!NAMESPACE_PATTERN.test(namespace) || !Number.isInteger(version) || version < 1 || !PAYLOAD_PATTERN.test(payload)) {
    return null;
  }
  return { namespace, version, payload };
}

export type ComponentResolution =
  | { readonly kind: 'found'; readonly family: ComponentFamily; readonly handler: ComponentHandler; readonly payload: string }
  | { readonly kind: 'stale'; readonly reason: 'malformed' | 'unknown_namespace' | 'version_mismatch' | 'no_handler' };

/** Validate families at startup: namespace conflicts must never reach production. */
export class ComponentRegistry {
  readonly #byNamespace = new Map<string, ComponentFamily>();

  constructor(families: readonly ComponentFamily[]) {
    for (const family of families) {
      if (!NAMESPACE_PATTERN.test(family.namespace)) throw new RegistryError(`Invalid component namespace "${family.namespace}"`);
      if (!Number.isInteger(family.version) || family.version < 1 || family.version > MAX_VERSION) {
        throw new RegistryError(`Invalid component version for "${family.namespace}"`);
      }
      if (this.#byNamespace.has(family.namespace)) throw new RegistryError(`Duplicate component namespace "${family.namespace}"`);
      if (family.onComponent === undefined && family.onModal === undefined) {
        throw new RegistryError(`Component family "${family.namespace}" has no handler`);
      }
      this.#byNamespace.set(family.namespace, family);
    }
  }

  resolve(customId: string | null, kind: 'component' | 'modal'): ComponentResolution {
    const decoded = decodeCustomId(customId);
    if (decoded === null) return { kind: 'stale', reason: 'malformed' };
    const family = this.#byNamespace.get(decoded.namespace);
    if (family === undefined) return { kind: 'stale', reason: 'unknown_namespace' };
    if (family.version !== decoded.version) return { kind: 'stale', reason: 'version_mismatch' };
    const handler = kind === 'component' ? family.onComponent : family.onModal;
    if (handler === undefined) return { kind: 'stale', reason: 'no_handler' };
    return { kind: 'found', family, handler, payload: decoded.payload };
  }
}
