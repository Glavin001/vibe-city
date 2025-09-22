import { describe, expect, it } from 'vitest';
import { createWhisperOrchestratorMachine } from '../machines/whisperOrchestrator.machine';

describe('whisperOrchestratorMachine', () => {
  it('exports a machine factory', () => {
    expect(typeof createWhisperOrchestratorMachine).toBe('function');
  });
});
