import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, '..', 'src', 'tests');
const files = readdirSync(testsDir)
  .filter((file) => file.endsWith('.machine.test.ts'))
  .map((file) => join('src', 'tests', file));

if (files.length === 0) {
  console.error('No machine test files found.');
  process.exit(1);
}

const ctx = await startVitest('run', files);
const exitCode = await ctx?.close();
process.exit(exitCode ?? 0);
