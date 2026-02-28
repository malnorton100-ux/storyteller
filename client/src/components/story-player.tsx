import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { X, Play, Pause, Maximize, Volume2, VolumeX } from "lucide-react";

interface StoryPlayerProps {
  videoUrl: string;
  title: string;
  style: string;
  onClose: () => void;
}

export function StoryPlayer({ videoUrl, title, style, onClose }: StoryPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showControls, setShowControls] = useState(true);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setProgress((videoRef.current.currentTime / videoRef.current.duration) * 100);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pct * videoRef.current.duration;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      onKeyDown={handleKeyDown}
      tabIndex={0}
      onMouseMove={() => {
        setShowControls(true);
      }}
      data-testid="story-player"
    >
      <div className={`absolute top-0 left-0 right-0 z-20 p-4 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0"}`}>
        <div>
          <p className="text-white text-sm font-medium">{title}</p>
          <p className="text-white/60 text-xs capitalize">{style} style</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={onClose}
          className="text-white hover:bg-white/20"
          data-testid="button-close-player"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center cursor-pointer" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={videoUrl}
          className="max-w-full max-h-full"
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onEnded={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedData={(e) => {
            const vid = e.currentTarget;
            vid.muted = false;
            vid.play().catch(() => {
              vid.muted = true;
              setIsMuted(true);
              vid.play().catch(() => {});
            });
          }}
          data-testid="video-element"
        />

        {!isPlaying && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/50 backdrop-blur-sm rounded-full p-5">
              <Play className="h-12 w-12 text-white" fill="white" />
            </div>
          </div>
        )}
      </div>

      <div className={`bg-black/90 p-3 z-20 space-y-2 transition-opacity duration-300 ${showControls ? "opacity-100" : "opacity-0"}`}>
        <div
          className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer group"
          onClick={handleSeek}
          data-testid="video-progress-bar"
        >
          <div
            className="h-full bg-primary rounded-full relative transition-all"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
        <div className="flex items-center justify-center gap-4">
          <Button
            size="icon"
            variant="ghost"
            onClick={togglePlay}
            className="text-white hover:bg-white/20"
            data-testid="button-play-pause"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setIsMuted(!isMuted);
              if (videoRef.current) videoRef.current.muted = !isMuted;
            }}
            className="text-white hover:bg-white/20"
            data-testid="button-mute-toggle"
          >
            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
