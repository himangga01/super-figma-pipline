import { authBinding, authProblem, figmaRemote, safeAuthStatus } from './figma-auth-public.js';

const form = document.getElementById('figma-consent-form');
const continueButton = document.getElementById('figma-consent-continue');
const reloadButton = document.getElementById('figma-consent-reload');
const statusElement = document.getElementById('figma-consent-status');
let pending = false,
  current = null,
  active = true;
const controller = new AbortController();
function clearForm() {
  continueButton.disabled = true;
  for (const input of form.elements) if (input.type === 'hidden') input.value = '';
  current = null;
}
async function read(path) {
  const response = await fetch(path, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
  });
  if (!response.ok || response.redirected || new URL(response.url).origin !== location.origin)
    throw Error('CONSENT_STATUS_UNAVAILABLE');
  return response.json();
}
function available(value) {
  return (
    value?.configuration.endpoint === figmaRemote &&
    value.configuration.mode === 'own-oauth' &&
    value.stage === 'waiting-for-callback' &&
    value.handoffAvailable &&
    value.flowId
  );
}
async function load() {
  if (pending || !active) return;
  pending = true;
  clearForm();
  reloadButton.disabled = true;
  try {
    // Queries are never copied, parsed or forwarded. GET never starts/redeems auth.
    if (location.search || location.hash) throw Error('CONSENT_URL_INVALID');
    const bootstrap = await read('/api/bootstrap');
    const value = safeAuthStatus(await read('/api/figma-settings/auth'));
    if (!value) throw Error('CONSENT_RESPONSE_INVALID');
    if (!active) return;
    if (!available(value)) {
      statusElement.textContent = value.code
        ? authProblem(value.code)
        : '사용할 수 있는 현재 로그인 동의가 없습니다. 포털에서 상태를 확인하세요.';
      return;
    }
    if (
      typeof bootstrap.csrfToken !== 'string' ||
      !/^[A-Za-z0-9_-]{16,256}$/u.test(bootstrap.csrfToken)
    )
      throw Error('CONSENT_CSRF_UNAVAILABLE');
    current = { ...authBinding(value), flowId: value.flowId };
    for (const [name, field] of Object.entries({ csrf: bootstrap.csrfToken, ...current }))
      form.elements.namedItem(name).value = String(field);
    continueButton.disabled = false;
    statusElement.textContent =
      '현재 로그인 동의를 확인했습니다. 계속 버튼을 누른 뒤 Figma 화면에서 직접 검토하세요.';
  } catch {
    if (active)
      statusElement.textContent =
        '동의 상태를 확인하지 못했습니다. 새 동의 요청을 전송하지 않았습니다. 포털 상태를 확인하세요.';
  } finally {
    pending = false;
    if (active) reloadButton.disabled = false;
  }
}
reloadButton.addEventListener('click', () => void load());
form.addEventListener('submit', event => {
  event.preventDefault();
  if (pending || !current || !active) return;
  if (location.search || location.hash) {
    clearForm();
    statusElement.textContent =
      '동의 화면 주소가 변경되었습니다. 동의를 전송하지 않았습니다. 포털 상태를 확인하세요.';
    return;
  }
  pending = true;
  continueButton.disabled = true;
  reloadButton.disabled = true;
  const original = current;
  void (async () => {
    try {
      const value = safeAuthStatus(await read('/api/figma-settings/auth'));
      if (!active || !available(value)) throw Error('CONSENT_SUPERSEDED');
      const next = { ...authBinding(value), flowId: value.flowId };
      if (Object.keys(original).some(name => original[name] !== next[name]))
        throw Error('CONSENT_SUPERSEDED');
      if (location.search || location.hash) throw Error('CONSENT_URL_INVALID');
      // The only native POST follows this explicit manual submit. No JSON URL handoff.
      HTMLFormElement.prototype.submit.call(form);
    } catch {
      if (active) {
        clearForm();
        statusElement.textContent =
          '로그인이 변경되거나 취소되었습니다. 동의를 전송하지 않았습니다. 포털 상태를 다시 확인하세요.';
      }
    } finally {
      pending = false;
      if (active) reloadButton.disabled = false;
    }
  })();
});
window.addEventListener(
  'pagehide',
  () => {
    active = false;
    controller.abort();
    clearForm();
  },
  { once: true },
);
void load();
