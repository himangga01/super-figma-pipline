import { setTimeout as delay } from 'node:timers/promises';

/** Wait for durable admission or producer settlement without publishing an early accepted frame. */
export async function waitForDurableAdmission(ready: () => boolean): Promise<void> {
  while (!ready()) {
    // Awaiting recursion retained every prior promise during slow filesystem/profile admission.
    // A bounded polling cadence also keeps that pre-admission wait from spinning the event loop.
    // eslint-disable-next-line no-await-in-loop -- each check waits for the same admission boundary
    await delay(10);
  }
}
