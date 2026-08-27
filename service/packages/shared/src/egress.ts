export const ALL_DATA_CLASSES = Object.freeze([
  'public',
  'project-code',
  'design-text',
  'design-image',
  'secret',
] as const);

export type DataClass = (typeof ALL_DATA_CLASSES)[number];
export type EgressMode = 'local-trusted' | 'external-model' | 'unknown-fail-closed';
export type EgressSource = 'mcp' | 'cli-control' | 'follower';

export interface ClassifiedPayload<T> {
  value: T;
  classes: readonly DataClass[];
  bytes: number;
  tokens: number;
}

export interface ResultEgressPolicy<I = unknown, O = unknown> {
  possibleInputClasses(args: Readonly<I>): readonly DataClass[];
  possibleResultClasses: readonly DataClass[];
  classifyInput(args: Readonly<I>): ClassifiedPayload<Readonly<I>>;
  classifyResult(result: Readonly<O>): ClassifiedPayload<Readonly<O>>;
  redactResult(result: Readonly<O>, allowed: readonly DataClass[]): O;
}

export type ResultEgressPolicyRegistry = Readonly<
  Record<
    string,
    ResultEgressPolicy<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>
  >
>;

export interface EgressConsent {
  consentId: string;
  allowedClasses: readonly DataClass[];
  expiresAt: number;
}

export interface EgressConfiguration {
  version: 1;
  mode: EgressMode;
  consent: EgressConsent | null;
}

export interface ConsentContext {
  mode: EgressMode;
  consentId: string | null;
  allowedClasses: readonly DataClass[];
}

export interface EgressConfigStore {
  load(): Promise<EgressConfiguration>;
  save(configuration: EgressConfiguration): Promise<void>;
}

export type EgressPolicyErrorCode =
  | 'EGRESS_CLASS_NOT_ALLOWED'
  | 'EGRESS_CONFIG_COMMIT_UNKNOWN'
  | 'EGRESS_CONFIG_INVALID'
  | 'EGRESS_CONFIG_WRITE_FAILED'
  | 'EGRESS_CONSENT_EXPIRED'
  | 'EGRESS_CONSENT_REQUIRED'
  | 'EGRESS_MODE_UNKNOWN'
  | 'EGRESS_RESULT_INVALID';

export class EgressPolicyError extends Error {
  readonly code: EgressPolicyErrorCode;
  readonly deniedClass?: DataClass;
  readonly committed?: boolean;

  constructor(
    code: EgressPolicyErrorCode,
    message: string,
    options: { cause?: unknown; deniedClass?: DataClass; committed?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EgressPolicyError';
    this.code = code;
    if (options.deniedClass !== undefined) this.deniedClass = options.deniedClass;
    if (options.committed !== undefined) this.committed = options.committed;
  }
}

export const DEFAULT_EGRESS_CONFIGURATION: EgressConfiguration = Object.freeze({
  version: 1,
  mode: 'unknown-fail-closed',
  consent: null,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify([...expected].toSorted());

const classesFromUnknown = (value: unknown): readonly DataClass[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const classes = value.filter((item): item is DataClass =>
    ALL_DATA_CLASSES.includes(item as DataClass),
  );
  if (classes.length !== value.length || new Set(classes).size !== classes.length) return undefined;
  return Object.freeze(ALL_DATA_CLASSES.filter(dataClass => classes.includes(dataClass)));
};

const invalidConfiguration = (): never => {
  throw new EgressPolicyError(
    'EGRESS_CONFIG_INVALID',
    'egress configuration does not match its closed schema',
  );
};

/** Parse the exact persisted schema; unknown keys and connector-like modes fail closed. */
export const parseEgressConfiguration = (value: unknown): EgressConfiguration => {
  if (!isPlainObject(value) || !exactKeys(value, ['version', 'mode', 'consent'])) {
    return invalidConfiguration();
  }
  if (
    value.version !== 1 ||
    !['local-trusted', 'external-model', 'unknown-fail-closed'].includes(String(value.mode))
  ) {
    return invalidConfiguration();
  }
  const mode = value.mode as EgressMode;
  if (mode === 'unknown-fail-closed' || mode === 'local-trusted') {
    if (value.consent !== null) return invalidConfiguration();
    return Object.freeze({ version: 1, mode, consent: null });
  }
  if (!isPlainObject(value.consent)) return invalidConfiguration();
  if (!exactKeys(value.consent, ['consentId', 'allowedClasses', 'expiresAt'])) {
    return invalidConfiguration();
  }
  const classes = classesFromUnknown(value.consent.allowedClasses);
  if (
    typeof value.consent.consentId !== 'string' ||
    value.consent.consentId.trim() === '' ||
    classes === undefined ||
    !Number.isSafeInteger(value.consent.expiresAt) ||
    (value.consent.expiresAt as number) <= 0
  ) {
    return invalidConfiguration();
  }
  return Object.freeze({
    version: 1,
    mode,
    consent: Object.freeze({
      consentId: value.consent.consentId,
      allowedClasses: classes,
      expiresAt: value.consent.expiresAt as number,
    }),
  });
};
