/** Keep the iPad screen awake during a party (Screen Wake Lock API, Safari 16.4+). */
let lock: { release: () => Promise<void> } | null = null;

export async function keepAwake(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
  if (!nav.wakeLock || lock) return;
  try {
    lock = await nav.wakeLock.request('screen');
    (lock as unknown as EventTarget).addEventListener?.('release', () => { lock = null; });
  } catch {
    lock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void keepAwake();
});
