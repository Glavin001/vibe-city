import { forwardRef } from "react";

interface AudioPlayerProps {
  audioUrl: string | null;
  loading: boolean;
}

export const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(
  ({ audioUrl, loading }, ref) => {
    if (!audioUrl && !loading) return null;

    return (
      <div className="border border-gray-600 rounded-xl p-4 space-y-3 bg-gray-800/30">
        <h2 className="text-lg font-semibold text-gray-200">Generated Audio</h2>
        <audio
          ref={ref}
          controls
          className="w-full"
          preload="auto"
        >
          <track kind="captions" label="Generated speech" />
          Your browser does not support the audio element.
        </audio>
      </div>
    );
  }
);

AudioPlayer.displayName = "AudioPlayer";
