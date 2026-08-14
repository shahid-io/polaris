import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * @packageDocumentation
 * Lifecycle for the shared headless browser that web-session providers drive.
 *
 * A browser is an expensive, stateful, long-lived resource, which is the opposite of
 * everything else behind a `FlightProvider`. Every other adapter is a function of its
 * inputs; this one owns a process. Concentrating that ownership here keeps the adapters
 * themselves ordinary: they ask for a page, use it, and never think about launch cost,
 * concurrency or shutdown.
 */

/** Chromium is launched once and reused; relaunching per search costs roughly a second. */
let browser: Browser | undefined;

/** In-flight launch, so concurrent first-callers share one Chromium rather than racing. */
let launching: Promise<Browser> | undefined;

/**
 * Serialises page work.
 *
 * Two independent reasons, either of which alone would justify it. Each page is a real
 * Chromium tab rendering a heavy commercial site, so running several concurrently is a
 * memory problem in a process that also serves HTTP. And driving one provider's public
 * search page is only defensible at the rate a person would use it, which parallel tabs
 * are not.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Pending idle shutdown, cancelled whenever new work arrives. */
let idleTimer: NodeJS.Timeout | undefined;

/**
 * How long the browser lingers with no work before being closed.
 *
 * Long enough that a burst of searches reuses one Chromium, short enough that an idle dev
 * server is not holding a few hundred megabytes indefinitely.
 */
const IDLE_SHUTDOWN_MS = 120_000;

/** Realistic desktop identity. An Indian locale and zone is what these sites price for. */
const CONTEXT_OPTIONS = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
};

/**
 * The browser could not be started at all.
 *
 * Distinct from a page failing: this means the capability is absent from the environment,
 * Playwright not installed or its Chromium not downloaded, which is a configuration fact
 * rather than a transient error. Adapters map it to `skipped`, the same treatment as a
 * missing API key, so a checkout without browsers installed still runs.
 */
export class BrowserUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'BrowserUnavailableError';
  }
}

/** What {@link withPage} hands to its callback. */
export interface PageSession {
  readonly page: Page;
  readonly context: BrowserContext;
}

/**
 * Launches Chromium, or returns the running instance.
 *
 * @returns The shared browser.
 * @throws {BrowserUnavailableError} When Playwright or its Chromium is not installed.
 * @internal
 */
async function ensureBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;

  // A crashed browser leaves a disconnected handle behind; drop it rather than handing
  // out pages that will fail on first use.
  browser = undefined;

  launching ??= (async () => {
    let chromium: typeof import('playwright').chromium;
    try {
      // Imported lazily so a deployment that never enables a web-session provider does not
      // pay for loading Playwright, and so an install without it fails here, describably,
      // rather than at module load.
      ({ chromium } = await import('playwright'));
    } catch (error) {
      throw new BrowserUnavailableError(
        'Playwright is not installed, run `pnpm add playwright` to enable web-session providers',
        error,
      );
    }

    try {
      return await chromium.launch({
        headless: process.env.BROWSER_HEADFUL !== '1',
        args: ['--disable-blink-features=AutomationControlled'],
      });
    } catch (error) {
      throw new BrowserUnavailableError(
        'Could not launch Chromium, run `pnpm exec playwright install chromium`',
        error,
      );
    }
  })();

  try {
    browser = await launching;
    return browser;
  } finally {
    launching = undefined;
  }
}

/**
 * Runs one piece of page work, serialised against all other page work.
 *
 * Each call gets a **fresh browser context**, so it starts with no cookies and no storage
 * from the previous search. That is deliberate beyond hygiene: a warm session accumulates
 * personalisation, and a personalised fare is not the fare a comparison should be quoting.
 *
 * The caller's `signal` ends the caller's wait and closes the context. It cannot cancel the
 * queue position of work that has not started, which is correct: a queued task that is
 * abandoned before it begins simply never runs.
 *
 * @param task - Receives a ready page. Must not outlive the call.
 * @param signal - Cancellation from the orchestrator's per-provider deadline.
 * @returns Whatever the task returns.
 * @throws {BrowserUnavailableError} When the browser cannot be started.
 */
export function withPage<T>(
  task: (session: PageSession) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  // Chain onto the queue, and keep the queue alive regardless of this task's outcome: a
  // rejection here must not poison every later caller.
  const run = queue.then(() => execute(task, signal));
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Acquires a context, runs the task, and always tears the context down.
 *
 * @param task - The page work.
 * @param signal - Caller cancellation.
 * @returns The task's result.
 * @internal
 */
async function execute<T>(
  task: (session: PageSession) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new Error('Cancelled before the browser was available');

  cancelIdleShutdown();

  const instance = await ensureBrowser();
  const context = await instance.newContext(CONTEXT_OPTIONS);

  // Chromium sets navigator.webdriver under automation. Removing it is not evasion of any
  // access control, it is removing a flag that makes ordinary pages take degraded paths.
  // Passed as source text rather than a function so this package keeps compiling against
  // Node types alone, without pulling in the DOM lib for one line of browser code.
  await context.addInitScript({
    content: "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });",
  });

  const page = await context.newPage();

  // Images and fonts are the bulk of the bytes on a travel site and none of the data.
  // Blocking them is the single largest speedup available and lightens the load we place
  // on the site at the same time.
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'media') return route.abort();
    return route.continue();
  });

  try {
    return await raceAbort(task({ page, context }), signal);
  } finally {
    await context.close().catch(() => undefined);
    scheduleIdleShutdown();
  }
}

/**
 * Rejects as soon as the caller aborts, without waiting for the page work to notice.
 *
 * Playwright's own operations honour their timeouts, but a task can sit between two of
 * them when the deadline passes. This bounds the caller's wait regardless.
 *
 * @param work - The task promise.
 * @param signal - Caller cancellation.
 * @returns The task's result.
 * @internal
 */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Browser session cancelled by caller'));

    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Arms the idle shutdown timer. @internal */
function scheduleIdleShutdown(): void {
  cancelIdleShutdown();
  idleTimer = setTimeout(() => {
    void closeBrowser();
  }, IDLE_SHUTDOWN_MS);
  // Must not keep the process alive on its own account.
  idleTimer.unref?.();
}

/** Disarms the idle shutdown timer. @internal */
function cancelIdleShutdown(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
}

/**
 * Closes the shared browser.
 *
 * Called on idle timeout, and worth calling from an application shutdown hook so a
 * restarting dev server does not leave Chromium processes behind.
 */
export async function closeBrowser(): Promise<void> {
  cancelIdleShutdown();
  const instance = browser;
  browser = undefined;
  await instance?.close().catch(() => undefined);
}
