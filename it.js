import { execSync } from 'node:child_process';

// Script to launch integration tests

execSync('node packages/assistant/integration-tests/setup-config.js ' + process.argv[2], {
  stdio: [process.stdin, process.stdout, process.stderr],
});
try {
  const testArgs = process.argv.slice(3);
  const test = testArgs.length > 0 ? ` ${testArgs.join(' ')}` : '';
  execSync('vitest run --config vitest-it.config.ts' + test, {
    stdio: [process.stdin, process.stdout, process.stderr],
  });
} catch {
  process.exit(1);
}
