/** Consume the owner's one-use local bundle seed. Never persist it in UI state or diagnostics. */
export const consumePairBootstrap = (document: Pick<Document, 'getElementById'>): string | null => {
  const element = document.getElementById('sfp-pair-bootstrap');
  if (element === null) return null;
  const text = element.textContent ?? '';
  element.textContent = '';
  element.remove();
  if (text.length > 128) return null;
  try {
    const value = JSON.parse(text) as { pairCode?: unknown };
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.pairCode !== 'string' ||
      !/^SFP-[A-Z2-7]{10}-\d{8}$/u.test(value.pairCode)
    )
      return null;
    return value.pairCode;
  } catch {
    return null;
  }
};
