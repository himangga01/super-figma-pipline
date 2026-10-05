import type { Page } from 'playwright';

import { writeCapture } from './artifacts.js';

/** Diagnostic editor state is never a frontend oracle or a complete design capture. */
export async function retainChromeFailure(page: Page, folder: string, error: unknown) {
  try {
    await writeCapture(
      folder,
      'failure.png',
      await page.screenshot({ type: 'png', timeout: 5_000 }),
    );
    const pluginCards = await page
      .getByRole('button', { name: 'Scripter', exact: true })
      .evaluateAll(elements =>
        elements.slice(0, 4).map(element => ({
          text: element.textContent?.slice(0, 256),
          icons: Array.from(element.querySelectorAll('img') as Iterable<{ src: string }>).map(
            image => {
              const url = new URL(image.src);
              return {
                origin: url.origin,
                path: url.pathname,
                resourceId: url.searchParams.get('resource_id'),
              };
            },
          ),
        })),
      );
    await writeCapture(folder, 'diagnostics.json', {
      source: 'service-playwright-chrome',
      exactDesignValues: false,
      frames: page
        .frames()
        .slice(0, 32)
        .map(frame => {
          try {
            const url = new URL(frame.url());
            return {
              origin: url.origin,
              path: /^https?:$/u.test(url.protocol) ? url.pathname.slice(0, 256) : '',
            };
          } catch {
            return { origin: 'unavailable', path: '' };
          }
        }),
      url: page.url(),
      error: error instanceof Error ? error.message : 'PRECISION_READ_FAILED',
      ui: (await page.locator('body').ariaSnapshot({ timeout: 5_000 })).slice(0, 100_000),
      pluginCards,
    });
  } catch {
    // Losing the source page must not replace its original collection failure.
  }
}
