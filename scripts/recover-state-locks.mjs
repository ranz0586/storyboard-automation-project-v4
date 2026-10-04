import { config } from '../src/config.js';
import { recoverStateLocks } from '../src/utils/jsonStateFile.js';

try {
  const recovered = recoverStateLocks({
    files: [config.scheduler.runStatePath, config.scheduler.statePath],
    serversStopped: process.argv.includes('--servers-stopped'),
  });
  console.log(JSON.stringify({ recovered }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
