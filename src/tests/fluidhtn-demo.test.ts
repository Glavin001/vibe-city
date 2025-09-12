import { describe, it, expect, beforeAll } from 'vitest';
import { runDemoOnWorker } from '../lib/fluidhtn';

let dotnetUrl: string;
beforeAll(async () => {
  dotnetUrl = new URL('../../public/fluidhtn/_framework/dotnet.js', import.meta.url).href;
});

describe('FluidHTN WASM demo', () => {
	it('RunDemo returns expected sequence shape', async () => {
		const s = await runDemoOnWorker(dotnetUrl);
		// basic sanity: contains known actions and is comma-separated
		expect(typeof s).toBe('string');
		const parts = s.split(',');
		expect(parts.length).toBeGreaterThanOrEqual(2);
		expect(parts).toContain('Get A');
		expect(parts).toContain('Get B');
		expect(parts).toContain('Get C');
		expect(parts).toContain('Done');
	});
});


