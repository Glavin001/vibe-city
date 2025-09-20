import { assign, setup } from 'xstate';

export type VoiceSegmentsStateValue = 'idle' | 'speaking' | 'settling' | 'waitingWhisper' | 'flushing' | 'error';

export interface VoiceSegmentsContext {
  settleMs: number;
  whisperWaitMs: number;
  // Live text accumulation
  liveText: string;
  bestLiveText: string;
  lastFinalText: string | null;
  // Deadlines for UI countdowns
  settleDeadline: number | null;
  waitingDeadline: number | null;
  // Whisper status for guards
  whisperStatus: 'idle' | 'loading' | 'ready' | 'start' | 'update' | 'complete' | 'error';
  // Internal flags
  waitingForWhisper: boolean;
  error: string | null;
}

export type VoiceSegmentsEvents =
  | { type: 'VAD.START' }
  | { type: 'VAD.END' }
  | { type: 'LIVE_UPDATE'; text: string }
  | { type: 'WHISPER.STATUS'; status: VoiceSegmentsContext['whisperStatus'] }
  | { type: 'WHISPER.COMPLETE' }
  | { type: 'FORCE.FLUSH' }
  | { type: 'ERROR'; error: string };

function createVoiceSegmentsMachine() {
  console.log("[voiceSegments.machine] createVoiceSegmentsMachine");
  return setup({
    delays: {
      SETTLE_DELAY: ({ context }) => context.settleMs,
      WAITING_DELAY: ({ context }) => context.whisperWaitMs,
    },
    actions: {
      resetLive: assign({ liveText: '', bestLiveText: '' }),
      clearDeadlines: assign({ settleDeadline: null, waitingDeadline: null, waitingForWhisper: false }),
      startSettleDeadline: assign({ settleDeadline: ({ context }) => Date.now() + context.settleMs }),
      startWaitingDeadline: assign({ waitingDeadline: ({ context }) => Date.now() + context.whisperWaitMs }),
      setWaitingFlagTrue: assign({ waitingForWhisper: true }),
      updateLive: assign(({ context, event }) => {
        console.log("[voiceSegments.machine] updateLive", event);
        if (event.type !== 'LIVE_UPDATE') return {} as Partial<VoiceSegmentsContext>;
        const txt = event.text ?? '';
        return {
          liveText: txt,
          bestLiveText: txt.length >= (context.bestLiveText?.length ?? 0) ? txt : context.bestLiveText,
        };
      }),
      setWhisperStatus: assign({ whisperStatus: ({ event }) => (event.type === 'WHISPER.STATUS' ? event.status : 'idle') }),
      computeFinal: assign(({ context }) => {
        const candidate = (context.liveText || '').trim();
        const best = (context.bestLiveText || '').trim();
        const finalText = best.length >= candidate.length ? best : candidate;
        return {
          lastFinalText: finalText.length > 0 ? finalText : context.lastFinalText,
        };
      }),
      resetAfterFlush: assign({ liveText: '', bestLiveText: '', settleDeadline: null, waitingDeadline: null, waitingForWhisper: false }),
    },
  }).createMachine({
    id: 'voiceSegments',
    types: {
      context: {} as VoiceSegmentsContext,
      events: {} as VoiceSegmentsEvents,
      input: {} as { settleMs?: number; whisperWaitMs?: number },
    },
    context: ({ input }: { input?: { settleMs?: number; whisperWaitMs?: number } }) => ({
      settleMs: input?.settleMs ?? 300,
      whisperWaitMs: input?.whisperWaitMs ?? 1500,
      liveText: '',
      bestLiveText: '',
      lastFinalText: null,
      settleDeadline: null,
      waitingDeadline: null,
      whisperStatus: 'idle',
      waitingForWhisper: false,
      error: null,
    }),
    initial: 'idle' as VoiceSegmentsStateValue,
    states: {
      idle: {
        on: {
          'VAD.START': { target: 'speaking', actions: ['resetLive', 'clearDeadlines'] },
          'LIVE_UPDATE': { actions: ['updateLive'] },
          'FORCE.FLUSH': { target: 'flushing' },
          'WHISPER.STATUS': { actions: ['setWhisperStatus'] },
        },
      },
      speaking: {
        on: {
          'VAD.END': {
            target: 'settling',
            actions: ['startSettleDeadline'],
          },
          'LIVE_UPDATE': { actions: ['updateLive'] },
          'WHISPER.STATUS': { actions: ['setWhisperStatus'] },
          'FORCE.FLUSH': { target: 'flushing' },
        },
      },
      settling: {
        after: {
          // After settle window, either flush immediately if Whisper already completed, or wait for it
          SETTLE_DELAY: [
            {
              guard: ({ context }) => context.whisperStatus === 'complete',
              target: 'flushing',
            },
            {
              target: 'waitingWhisper',
              actions: ['startWaitingDeadline', 'setWaitingFlagTrue'],
            },
          ],
        },
        on: {
          'LIVE_UPDATE': { actions: ['updateLive'] },
          'WHISPER.STATUS': [
            // Flush immediately if complete
            {
              guard: ({ event }) => event.type === 'WHISPER.STATUS' && event.status === 'complete',
              target: 'flushing',
              actions: ['setWhisperStatus'],
            },
            // Otherwise, just record latest status
            { actions: ['setWhisperStatus'] },
          ],
          // If our finalize pipeline explicitly signals completion, flush now
          'WHISPER.COMPLETE': { target: 'flushing' },
          'FORCE.FLUSH': { target: 'flushing' },
        },
      },
      waitingWhisper: {
        after: {
          WAITING_DELAY: {
            target: 'flushing',
          },
        },
        on: {
          'LIVE_UPDATE': { actions: ['updateLive'] },
          'WHISPER.STATUS': [
            {
              actions: ['setWhisperStatus'],
              guard: ({ event }) => event.type === 'WHISPER.STATUS' && event.status === 'complete',
              target: 'flushing',
            },
            { actions: ['setWhisperStatus'] },
          ],
          'WHISPER.COMPLETE': { target: 'flushing' },
          'FORCE.FLUSH': { target: 'flushing' },
        },
      },
      flushing: {
        entry: ['computeFinal', 'resetAfterFlush'],
        always: { target: 'idle' },
      },
      error: {
        entry: assign({ error: ({ event }) => (event.type === 'ERROR' ? event.error : 'Unknown error') }),
      },
    },
    on: {
        'LIVE_UPDATE': { actions: ['updateLive'] },
    },
  });
}

export const voiceSegmentsMachine = createVoiceSegmentsMachine();
