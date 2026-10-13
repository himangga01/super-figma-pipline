import assert from 'node:assert/strict';

/** Run against the actual generated-target route using the caller's service-owned Chrome. */
export async function runNotesApplicationJourney({ browser, origin, route, owner, assertOwnedListener, restartOwned, verifyBaseline }) {
  const base = new URL(origin); assert.equal(base.origin, origin); assert.equal(base.hostname, '127.0.0.1');
  assert.ok(route.startsWith('/') && !route.startsWith('//'));
  assert.ok(owner?.username && owner?.password && assertOwnedListener && restartOwned && verifyBaseline);
  const context = await browser.newContext(), checks = [];
  const record = id => checks.push({ id, passed: true });
  await context.route('**/*', request => new URL(request.request().url()).origin === origin ? request.continue() : request.abort());
  try {
    await assertOwnedListener(); const page = await context.newPage(); await page.goto(origin + route);
    await page.getByTestId('notes-workspace').waitFor();
    await page.locator('#notes-username').fill(owner.username); await page.locator('#notes-password').fill('synthetic-definitely-wrong-password');
    await page.getByTestId('notes-login').click(); await page.getByTestId('notes-error').waitFor();
    await page.getByTestId('notes-login').waitFor(); record('generated-ui-wrong-password');
    await page.locator('#notes-password').fill(owner.password); await page.getByTestId('notes-login').click();
    await page.getByTestId('notes-editor').waitFor(); record('generated-ui-real-session-login');
    await page.locator('#notes-title').fill('Application acceptance note'); await page.locator('#notes-content').fill('Durable application content');
    await page.getByTestId('notes-save').click(); await page.getByTestId('notes-delete').waitFor(); record('generated-ui-create-handler-sqlite');
    await page.locator('#notes-content').fill('Edited durable application content'); await page.getByTestId('notes-save').click();
    await page.getByTestId('notes-workspace').locator('[role=status]').filter({ hasText: /saved|저장/u }).waitFor(); record('generated-ui-update-handler');
    await restartOwned(); await assertOwnedListener(); await page.reload();
    await page.getByTestId('notes-workspace').getByRole('button', { name: 'Application acceptance note', exact: true }).click();
    assert.equal(await page.locator('#notes-content').inputValue(), 'Edited durable application content'); record('generated-ui-restart-reread');
    await page.getByTestId('notes-delete').click(); await page.getByTestId('notes-confirm-delete').click();
    await page.getByTestId('notes-confirm-delete').waitFor({ state: 'hidden' });
    assert.equal(await page.getByTestId('notes-workspace').getByRole('button', { name: 'Application acceptance note', exact: true }).count(), 0); record('generated-ui-delete-handler');
    await page.getByTestId('notes-logout').click(); await page.getByTestId('notes-login').waitFor();
    await page.reload(); await page.getByTestId('notes-login').waitFor(); record('generated-ui-logout-and-reload');
    await verifyBaseline(); record('generated-ui-original-data-preserved');
    return { passed: true, checks, completeCaseAcceptance: false, designVisualAccepted: false };
  } finally { await context.close(); }
}
