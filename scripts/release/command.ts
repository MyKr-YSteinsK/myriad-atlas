export function npmCommand(platform = process.platform): 'npm' | 'npm.cmd' {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}
