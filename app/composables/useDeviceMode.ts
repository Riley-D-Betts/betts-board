/** Per-device "wall display" flag, persisted in localStorage. Idle slideshow
 * activates only on display-flagged devices (plus always on /tv routes). */
export function useDeviceMode() {
  const isDisplayDevice = useLocalStorage('betts-device-display', false)
  return { isDisplayDevice }
}
