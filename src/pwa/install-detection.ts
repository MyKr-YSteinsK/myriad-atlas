export function isStandalone(matches: boolean, navigatorStandalone: boolean): boolean {
  return matches || navigatorStandalone
}

export function isIphoneSafari(userAgent: string): boolean {
  return /iPhone|iPad|iPod/i.test(userAgent) && /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(userAgent)
}
