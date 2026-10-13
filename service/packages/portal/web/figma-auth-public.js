export const figmaRemote = 'https://mcp.figma.com/mcp';
export const figmaDesktop = 'http://127.0.0.1:3845/mcp';
const codes = new Set(
  [
    'REGISTRATION_REQUIRED',
    'OWN_CLIENT_REQUIRED',
    'SECRET_REQUIRED',
    'METADATA_REJECTED',
    'CALLBACK_REJECTED',
    'OWNER_MISMATCH',
    'BUSY',
    'CANCELLED',
    'DEADLINE_EXCEEDED',
    'SUPERSEDED',
    'CALLBACK_REQUIRED',
    'CONSENT_DENIED',
    'DESTINATION_REJECTED',
    'RESPONSE_REJECTED',
    'TOKEN_REJECTED',
    'EXCHANGE_FAILED',
    'REFRESH_FAILED',
    'TOKEN_REQUIRED',
    'HANDOFF_FAILED',
    'INPUT_INVALID',
    'CONFIGURATION_INVALID',
    'BINDING_MISMATCH',
    'CONTRACT_REQUIRED',
    'CONTRACT_INVALID',
    'CONTRACT_CHANGED',
    'ENV_UNAVAILABLE',
    'ENDPOINT_REQUIRED',
    'MODE_REQUIRED',
    'PORT_UNAVAILABLE',
    'HANDOFF_UNAVAILABLE',
    'CLOSED',
    'PERSISTENCE_FAILED',
  ].map(code => `FIGMA_MCP_OAUTH_${code}`),
);
const stages = new Set([
  'blocked',
  'preparing',
  'waiting-for-callback',
  'exchanging',
  'authorized',
  'refreshing',
  'cancelled',
  'logged-out',
  'expired',
  'login-required',
  'external-token-configured',
]);
const uuid = value =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const generation = value => Number.isSafeInteger(value) && value >= 0;
const fields = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every(name => Object.hasOwn(value, name));
export const envName = value =>
  typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(value);
export const contractReference = value =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u.test(value);
export const contractDigest = value =>
  typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const nullable = (check, value) => value === null || check(value);
export function safeAuthStatus(value) {
  try {
    if (
      !fields(value, [
        'schemaVersion',
        'providerInstanceId',
        'configurationGeneration',
        'authGeneration',
        'configuration',
        'stage',
        'code',
        'expiresAt',
        'flowId',
        'handoffAvailable',
        'eligibilitySource',
        'serverAuthorizationObserved',
        'sessionOnly',
      ])
    )
      return null;
    const c = value.configuration;
    if (
      !fields(c, [
        'endpoint',
        'mode',
        'oauthTokenEnv',
        'clientIdEnv',
        'clientSecretEnv',
        'contractReference',
        'contractDigest',
      ]) ||
      ![figmaRemote, figmaDesktop].includes(c.endpoint) ||
      !['external-token', 'own-oauth'].includes(c.mode) ||
      ![c.oauthTokenEnv, c.clientIdEnv, c.clientSecretEnv].every(name => nullable(envName, name)) ||
      !nullable(contractReference, c.contractReference) ||
      !nullable(contractDigest, c.contractDigest) ||
      value.schemaVersion !== 1 ||
      !uuid(value.providerInstanceId) ||
      !generation(value.configurationGeneration) ||
      !generation(value.authGeneration) ||
      !stages.has(value.stage) ||
      !nullable(code => codes.has(code), value.code) ||
      !nullable(generation, value.expiresAt) ||
      !nullable(uuid, value.flowId) ||
      typeof value.handoffAvailable !== 'boolean' ||
      !['none', 'operator-contract'].includes(value.eligibilitySource) ||
      typeof value.serverAuthorizationObserved !== 'boolean' ||
      value.sessionOnly !== true
    )
      return null;
    return { ...value, configuration: { ...c } };
  } catch {
    return null;
  }
}
export function authBinding(status) {
  return {
    providerInstanceId: status.providerInstanceId,
    configurationGeneration: status.configurationGeneration,
    authGeneration: status.authGeneration,
  };
}
export function authProblem(code) {
  const messages = {
    FIGMA_MCP_OAUTH_CONTRACT_REQUIRED:
      '운영자가 승인된 서비스 전용 클라이언트 계약 기록을 먼저 설치해야 합니다.',
    FIGMA_MCP_OAUTH_CONTRACT_INVALID:
      '설치된 클라이언트 계약을 확인하세요. 화면 입력만으로 Figma 등록 자격을 확인할 수 없습니다.',
    FIGMA_MCP_OAUTH_CONTRACT_CHANGED:
      '클라이언트 계약이 변경되었습니다. 상태를 다시 읽고 운영자와 확인하세요.',
    FIGMA_MCP_OAUTH_REGISTRATION_REQUIRED:
      '이 서비스에 허용된 Figma 클라이언트 계약이 필요합니다. 다른 앱의 인증 정보를 사용할 수 없습니다.',
    FIGMA_MCP_OAUTH_OWN_CLIENT_REQUIRED:
      '이 서비스 전용 클라이언트 ID의 환경 변수 이름과 계약이 필요합니다.',
    FIGMA_MCP_OAUTH_SECRET_REQUIRED:
      '이 서비스 전용 클라이언트 비밀의 환경 변수 이름이 필요합니다. 값을 입력하지 마세요.',
    FIGMA_MCP_OAUTH_ENV_UNAVAILABLE:
      '지정한 환경 변수가 데몬 환경에 없습니다. 이름 저장은 환경 값을 설정하지 않습니다.',
    FIGMA_MCP_OAUTH_BINDING_MISMATCH:
      '서비스 또는 인증 세대가 변경되었습니다. 상태를 다시 읽고 동작을 선택하세요.',
    FIGMA_MCP_OAUTH_BUSY:
      '인증 동작이 진행 중입니다. 기존 상태를 확인하거나 해당 동작을 취소하세요.',
    FIGMA_MCP_OAUTH_PORT_UNAVAILABLE:
      '승인된 콜백 포트를 사용할 수 없습니다. 다른 포트를 자동 선택하지 않습니다.',
    FIGMA_MCP_OAUTH_REFRESH_FAILED:
      '갱신 결과를 확정하지 못했습니다. 자동 재시도 없이 새 로그인이 필요한지 확인하세요.',
    FIGMA_MCP_OAUTH_EXCHANGE_FAILED:
      '토큰 교환 결과를 확정하지 못했습니다. 소모된 동의를 다시 전송하지 않습니다.',
    FIGMA_MCP_OAUTH_DEADLINE_EXCEEDED:
      '원래 인증 시간이 끝났습니다. 상태를 확인한 후 새 동작을 명시적으로 선택하세요.',
    SERVICE_UNKNOWN_MUTATION_FENCE:
      '이전 결과가 미확정인 작업이 있습니다. 해당 작업을 먼저 검토하세요. 인증 동작은 기존 작업을 재실행하거나 차단을 해제하지 않습니다.',
    RUN_OUTCOME_UNKNOWN:
      '이전 실행의 결과가 미확정입니다. 원래 기록과 증거를 먼저 검토하세요. 인증 동작은 기존 실행을 재실행하거나 차단을 해제하지 않습니다.',
    SERVICE_JOB_OUTCOME_UNKNOWN:
      '이전 서비스 작업의 결과가 미확정입니다. 원래 작업과 증거를 먼저 검토하세요. 인증 동작은 해당 작업을 재실행하거나 차단을 해제하지 않습니다.',
  };
  return (
    messages[code] ??
    (codes.has(code)
      ? `인증 상태: ${code}`
      : '연결 설정 요청을 완료하지 못했습니다. 서비스 상태를 다시 확인하세요.')
  );
}
export function safeAuthError(error) {
  let code;
  try {
    const received = error?.code;
    if (
      codes.has(received) ||
      [
        'SERVICE_UNKNOWN_MUTATION_FENCE',
        'RUN_OUTCOME_UNKNOWN',
        'SERVICE_JOB_OUTCOME_UNKNOWN',
      ].includes(received)
    )
      code = received;
  } catch {
    /* Closed projection. */
  }
  return Object.assign(new Error(authProblem(code)), { code: code ?? 'FIGMA_AUTH_REQUEST_FAILED' });
}
export const activeAuth = status =>
  status &&
  ['preparing', 'waiting-for-callback', 'exchanging', 'refreshing'].includes(status.stage);
export const stageText = stage =>
  ({
    blocked: '설정 준비 필요',
    preparing: '로그인 준비 중',
    'waiting-for-callback': '별도 탭에서 수동 동의 대기',
    exchanging: '동의 결과 교환 중',
    authorized: '이 서비스 세션 인증됨',
    refreshing: '명시적 갱신 진행 중',
    cancelled: '취소됨',
    'logged-out': '로컬 세션 로그아웃됨',
    expired: '인증 만료됨',
    'login-required': '새 로그인 필요',
    'external-token-configured': '서비스 전용 외부 토큰 참조 구성됨',
  })[stage] ?? '상태 확인 불가';
