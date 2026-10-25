import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The full suite exercises POSIX modes, real symlinks and executable fixtures.
// Keep those checks intact when starting the suite from a Windows checkout.
const script = fileURLToPath(new URL('./test-linux.sh', import.meta.url));
const args = process.argv.slice(2);
let result;
if (process.platform === 'win32') {
  const distro = process.env.SCREENER_WSL_DISTRO || 'Ubuntu';
  const linuxPath = execFileSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', script.replaceAll('\\', '/')], { encoding: 'utf8' }).trim();
  result = spawnSync('wsl.exe', ['-d', distro, '--exec', 'bash', linuxPath, ...args], { stdio: 'inherit' });
} else {
  result = spawnSync('bash', [script, ...args], { stdio: 'inherit' });
}
if (result.error) throw result.error;
process.exit(result.status ?? 1);
