import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Camera, CircleUserRound, Loader2, Trash2, Plus, Check, Upload, ArrowLeft, Mic, MicOff, Play, Volume2, X, ImagePlus, Images, RefreshCw } from "lucide-react";
import { useState, useRef, useCallback } from "react";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { StorytellerProfile } from "@shared/schema";

const VOICE_OPTIONS = [
  { id: "alloy", label: "Alloy", description: "Warm & balanced" },
  { id: "echo", label: "Echo", description: "Deep & smooth" },
  { id: "fable", label: "Fable", description: "Expressive & British" },
  { id: "onyx", label: "Onyx", description: "Rich & authoritative" },
  { id: "nova", label: "Nova", description: "Friendly & bright" },
  { id: "shimmer", label: "Shimmer", description: "Soft & gentle" },
] as const;

function VoiceRecorder({ profileId, existingSampleUrl, onSaved }: {
  profileId: number;
  existingSampleUrl: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to record your voice.", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!audioBlob) return;
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]);
        };
        reader.readAsDataURL(audioBlob);
      });
      await apiRequest("PATCH", `/api/storyteller-profiles/${profileId}/voice`, {
        voiceSample: base64,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      toast({ title: "Voice sample saved!" });
      onSaved();
    },
    onError: () => {
      toast({ title: "Failed to save voice sample", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/storyteller-profiles/${profileId}/voice`, {
        voiceSample: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      setAudioBlob(null);
      setAudioUrl(null);
      toast({ title: "Voice sample removed" });
      onSaved();
    },
  });

  return (
    <div className="space-y-3">
      <Label>Your Voice Recording</Label>
      <p className="text-xs text-muted-foreground">
        Record a short sample of your voice (10-30 seconds). This can be used to narrate your story movies with your own voice.
      </p>

      {existingSampleUrl && !audioBlob && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/30">
          <Check className="h-4 w-4 text-green-600 flex-shrink-0" />
          <span className="text-sm text-green-700 dark:text-green-400 flex-1">Voice sample recorded</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const audio = new Audio(existingSampleUrl);
              audio.play();
            }}
            data-testid="button-play-existing-sample"
          >
            <Play className="h-3.5 w-3.5 mr-1" />
            Play
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeMutation.mutate()}
            disabled={removeMutation.isPending}
            data-testid="button-remove-sample"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Remove
          </Button>
        </div>
      )}

      {!existingSampleUrl && !audioBlob && !isRecording && (
        <Button
          variant="outline"
          onClick={startRecording}
          data-testid="button-start-voice-recording"
        >
          <Mic className="mr-2 h-4 w-4" />
          Record Voice Sample
        </Button>
      )}

      {isRecording && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
          <div className="h-3 w-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-medium text-red-700 dark:text-red-400 flex-1">
            Recording... {recordingDuration}s
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={stopRecording}
            data-testid="button-stop-voice-recording"
          >
            <MicOff className="mr-1.5 h-3.5 w-3.5" />
            Stop
          </Button>
        </div>
      )}

      {audioBlob && !isRecording && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted">
            <span className="text-sm flex-1">Voice sample recorded ({recordingDuration}s)</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (audioUrl) {
                  const audio = new Audio(audioUrl);
                  audio.play();
                }
              }}
              data-testid="button-play-new-sample"
            >
              <Play className="h-3.5 w-3.5 mr-1" />
              Play
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="button-save-voice-sample"
            >
              {saveMutation.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-3.5 w-3.5" />
              )}
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAudioBlob(null);
                setAudioUrl(null);
                startRecording();
              }}
              data-testid="button-re-record"
            >
              <Mic className="mr-1.5 h-3.5 w-3.5" />
              Re-record
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAudioBlob(null);
                setAudioUrl(null);
              }}
              data-testid="button-discard-recording"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function VoiceSelector({ profileId, currentVoice, onSaved }: {
  profileId: number;
  currentVoice: string | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const voiceMutation = useMutation({
    mutationFn: async (voice: string | null) => {
      await apiRequest("PATCH", `/api/storyteller-profiles/${profileId}/voice`, {
        voicePreference: voice,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      toast({ title: "Voice preference saved!" });
      onSaved();
    },
    onError: () => {
      toast({ title: "Failed to save voice preference", variant: "destructive" });
    },
  });

  const previewVoice = async (voiceId: string) => {
    if (previewingVoice) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (previewingVoice === voiceId) {
        setPreviewingVoice(null);
        return;
      }
    }
    setPreviewingVoice(voiceId);
    try {
      const res = await apiRequest("POST", "/api/preview-voice", { voice: voiceId });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPreviewingVoice(null);
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch {
      setPreviewingVoice(null);
      toast({ title: "Failed to preview voice", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <Label>AI Narration Voice</Label>
      <p className="text-xs text-muted-foreground">
        Choose an AI voice to narrate your story movies. You can preview each one before selecting.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {VOICE_OPTIONS.map((voice) => (
          <button
            key={voice.id}
            onClick={() => voiceMutation.mutate(voice.id)}
            className={`relative p-3 rounded-lg border-2 text-left transition-all ${
              currentVoice === voice.id
                ? "border-primary bg-primary/5"
                : "border-muted hover:border-primary/40"
            }`}
            data-testid={`button-voice-${voice.id}`}
          >
            {currentVoice === voice.id && (
              <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />
            )}
            <div className="text-sm font-medium">{voice.label}</div>
            <div className="text-xs text-muted-foreground">{voice.description}</div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5 h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                previewVoice(voice.id);
              }}
              disabled={voiceMutation.isPending}
              data-testid={`button-preview-voice-${voice.id}`}
            >
              {previewingVoice === voice.id ? (
                <Volume2 className="h-3 w-3 mr-1 animate-pulse" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              {previewingVoice === voice.id ? "Playing..." : "Preview"}
            </Button>
          </button>
        ))}
      </div>
      {currentVoice && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => voiceMutation.mutate(null)}
          className="text-xs"
          data-testid="button-clear-voice"
        >
          Clear voice preference
        </Button>
      )}
    </div>
  );
}

function ReanalyzeButton({ profileId }: { profileId: number }) {
  const { toast } = useToast();
  const reanalyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/storyteller-profiles/${profileId}/reanalyze`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      toast({ title: "Appearance re-analyzed with improved detail" });
    },
    onError: () => {
      toast({ title: "Re-analysis failed", variant: "destructive" });
    },
  });

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => reanalyzeMutation.mutate()}
      disabled={reanalyzeMutation.isPending}
      className="text-xs h-6 px-2"
      data-testid={`button-reanalyze-${profileId}`}
    >
      {reanalyzeMutation.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin mr-1" />
      ) : (
        <RefreshCw className="h-3 w-3 mr-1" />
      )}
      Re-analyze
    </Button>
  );
}

function AdditionalPhotos({ profile }: { profile: StorytellerProfile }) {
  const { toast } = useToast();
  const addPhotoRef = useRef<HTMLInputElement>(null);
  const addCameraRef = useRef<HTMLInputElement>(null);

  const processAndUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please upload an image file", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please use an image under 10MB.", variant: "destructive" });
      return;
    }
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const maxSize = 800;
      let width = img.width;
      let height = img.height;
      if (width > maxSize || height > maxSize) {
        if (width > height) { height = Math.round((height * maxSize) / width); width = maxSize; }
        else { width = Math.round((width * maxSize) / height); height = maxSize; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      const base64 = dataUrl.split(",")[1];
      URL.revokeObjectURL(objectUrl);
      addMutation.mutate(base64);
    };
    img.src = objectUrl;
  };

  const addMutation = useMutation({
    mutationFn: async (photoBase64: string) => {
      const res = await apiRequest("POST", `/api/storyteller-profiles/${profile.id}/photos`, { photo: photoBase64 });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      toast({ title: "Photo added!", description: "Your appearance description has been updated using all your photos." });
    },
    onError: () => {
      toast({ title: "Failed to add photo", variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (photoUrl: string) => {
      const res = await apiRequest("DELETE", `/api/storyteller-profiles/${profile.id}/photos`, { photoUrl });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      toast({ title: "Photo removed", description: "Your appearance description has been updated." });
    },
    onError: () => {
      toast({ title: "Failed to remove photo", variant: "destructive" });
    },
  });

  const additionalPhotos = profile.additionalPhotos || [];
  const totalPhotos = (profile.photoUrl ? 1 : 0) + additionalPhotos.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Images className="h-4 w-4 text-primary" />
        <Label>Reference Photos ({totalPhotos})</Label>
      </div>
      <p className="text-xs text-muted-foreground">
        More photos from different angles help the AI depict you more accurately. Try a side profile, a full-body shot, or different lighting.
      </p>

      <input
        ref={addCameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) processAndUpload(e.target.files[0]); e.target.value = ""; }}
        data-testid="input-additional-camera"
      />
      <input
        ref={addPhotoRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) processAndUpload(e.target.files[0]); e.target.value = ""; }}
        data-testid="input-additional-photo"
      />

      <div className="flex flex-wrap gap-3">
        {additionalPhotos.map((url, i) => (
          <div key={url} className="relative group">
            <img
              src={url}
              alt={`Reference ${i + 2}`}
              className="w-20 h-20 rounded-lg object-cover border border-border"
              data-testid={`img-additional-photo-${i}`}
            />
            <button
              onClick={() => { if (confirm("Remove this photo?")) removeMutation.mutate(url); }}
              className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
              disabled={removeMutation.isPending}
              data-testid={`button-remove-additional-${i}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {addMutation.isPending ? (
          <div className="w-20 h-20 rounded-lg border-2 border-dashed border-primary/30 flex items-center justify-center bg-primary/5">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => addCameraRef.current?.click()}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-primary/5 transition-all"
              data-testid="button-add-photo-camera"
            >
              <Camera className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Selfie</span>
            </button>
            <button
              onClick={() => addPhotoRef.current?.click()}
              className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:border-primary/50 hover:bg-primary/5 transition-all"
              data-testid="button-add-photo-upload"
            >
              <ImagePlus className="h-4 w-4 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">Upload</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Profile() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data: profiles, isLoading } = useQuery<StorytellerProfile[]>({
    queryKey: ["/api/storyteller-profiles"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/storyteller-profiles", {
        name,
        photo: photoBase64,
        voicePreference: selectedVoice,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      setName("");
      setPhotoPreview(null);
      setPhotoBase64(null);
      setSelectedVoice(null);
      setShowForm(false);
      toast({ title: "Profile created!", description: "Your photo has been analyzed. You'll appear as the character in generated content." });
    },
    onError: () => {
      toast({ title: "Failed to create profile", description: "Please try again.", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/storyteller-profiles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      toast({ title: "Profile removed" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Please upload an image file", variant: "destructive" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please use an image under 10MB.", variant: "destructive" });
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const maxSize = 800;
      let width = img.width;
      let height = img.height;
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      setPhotoPreview(dataUrl);
      setPhotoBase64(dataUrl.split(",")[1]);
      URL.revokeObjectURL(objectUrl);
    };
    img.src = objectUrl;
  };

  const getVoiceLabel = (voiceId: string | null) => {
    if (!voiceId) return null;
    return VOICE_OPTIONS.find(v => v.id === voiceId)?.label || voiceId;
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <Link href="/stories">
            <Button variant="outline" size="icon" className="mt-1 rounded-full shrink-0 h-10 w-10" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-profile-title">My Storyteller Profile</h1>
            <p className="text-muted-foreground mt-1">
              Upload your photo and set up your voice so you appear and sound like yourself in your story movies.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-48 w-full rounded-md" />
          </div>
        ) : (
          <>
            {profiles && profiles.length > 0 ? (
              <div className="space-y-4">
                {profiles.map((profile) => (
                  <Card key={profile.id} data-testid={`card-profile-${profile.id}`}>
                    <CardContent className="p-5 space-y-4">
                      <div className="flex gap-5">
                        {profile.photoUrl ? (
                          <img
                            src={profile.photoUrl}
                            alt={profile.name}
                            className="w-24 h-24 rounded-full object-cover border-2 border-primary/20 flex-shrink-0"
                            data-testid={`img-profile-photo-${profile.id}`}
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                            <CircleUserRound className="h-12 w-12 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="text-lg font-semibold" data-testid={`text-profile-name-${profile.id}`}>{profile.name}</h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Remove this profile?")) {
                                  deleteMutation.mutate(profile.id);
                                }
                              }}
                              data-testid={`button-delete-profile-${profile.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                          {profile.appearanceDescription ? (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 justify-between">
                                <div className="flex items-center gap-1.5">
                                  <Check className="h-3.5 w-3.5 text-green-600" />
                                  <span className="text-xs font-medium text-green-600">Appearance analyzed</span>
                                </div>
                                <ReanalyzeButton profileId={profile.id} />
                              </div>
                              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                                {profile.appearanceDescription}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground italic">
                              No photo uploaded yet. The AI will use generic character descriptions.
                            </p>
                          )}
                        </div>
                      </div>

                      {profile.photoUrl && (
                        <div className="border-t pt-4">
                          <AdditionalPhotos profile={profile} />
                        </div>
                      )}

                      <div className="border-t pt-4 space-y-1">
                        <div className="flex items-center gap-2 mb-3">
                          <Volume2 className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">Voice Settings</span>
                          {profile.voicePreference && (
                            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full" data-testid={`text-voice-label-${profile.id}`}>
                              {getVoiceLabel(profile.voicePreference)}
                            </span>
                          )}
                          {profile.voiceSampleUrl && (
                            <span className="text-xs bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">
                              Custom recording
                            </span>
                          )}
                        </div>
                        <VoiceSelector
                          profileId={profile.id}
                          currentVoice={profile.voicePreference}
                          onSaved={() => {}}
                        />
                        <div className="pt-3">
                          <VoiceRecorder
                            profileId={profile.id}
                            existingSampleUrl={profile.voiceSampleUrl}
                            onSaved={() => {}}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {!showForm && (
                  <Button
                    variant="outline"
                    onClick={() => setShowForm(true)}
                    className="w-full"
                    data-testid="button-add-another-profile"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Another Storyteller
                  </Button>
                )}
              </div>
            ) : !showForm ? (
              <Card>
                <CardContent className="p-8 text-center space-y-4">
                  <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                    <Camera className="h-10 w-10 text-primary/50" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1">No profiles yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Add your photo and voice so the AI knows what you look and sound like when creating your story movies.
                    </p>
                    <Button onClick={() => setShowForm(true)} data-testid="button-create-first-profile">
                      <Camera className="mr-2 h-4 w-4" />
                      Add My Profile
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {showForm && (
              <Card>
                <CardContent className="p-5 space-y-5">
                  <h3 className="font-semibold">Add Storyteller Profile</h3>

                  <div className="space-y-2">
                    <Label htmlFor="storyteller-name">Your Name</Label>
                    <Input
                      id="storyteller-name"
                      placeholder="e.g., Grandma Rose"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      data-testid="input-storyteller-name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Your Photo</Label>
                    <input
                      ref={cameraInputRef}
                      type="file"
                      accept="image/*"
                      capture="user"
                      className="hidden"
                      onChange={handleFileChange}
                      data-testid="input-camera-capture"
                    />
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                      data-testid="input-photo-file"
                    />

                    {photoPreview ? (
                      <div className="flex items-center gap-4">
                        <img
                          src={photoPreview}
                          alt="Preview"
                          className="w-24 h-24 rounded-full object-cover border-2 border-primary/20"
                          data-testid="img-photo-preview"
                        />
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">Photo selected</p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => cameraInputRef.current?.click()}
                              data-testid="button-retake-selfie"
                            >
                              <Camera className="mr-1.5 h-3.5 w-3.5" />
                              Retake
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => fileInputRef.current?.click()}
                              data-testid="button-change-photo"
                            >
                              <Upload className="mr-1.5 h-3.5 w-3.5" />
                              Upload Different
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-4">
                        <Camera className="h-10 w-10 text-muted-foreground/50 mx-auto" />
                        <p className="text-sm text-muted-foreground">
                          A clear photo of your face helps the AI depict you accurately as the character in your stories.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2 justify-center">
                          <Button
                            variant="default"
                            onClick={() => cameraInputRef.current?.click()}
                            data-testid="button-take-selfie"
                          >
                            <Camera className="mr-2 h-4 w-4" />
                            Take a Selfie
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            data-testid="button-upload-photo"
                          >
                            <Upload className="mr-2 h-4 w-4" />
                            Upload a Photo
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Label>Narration Voice (optional)</Label>
                    <p className="text-xs text-muted-foreground">
                      Pick an AI voice for narrating your story movies. You can change this later or record your own voice.
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {VOICE_OPTIONS.map((voice) => (
                        <button
                          key={voice.id}
                          onClick={() => setSelectedVoice(selectedVoice === voice.id ? null : voice.id)}
                          className={`relative p-3 rounded-lg border-2 text-left transition-all ${
                            selectedVoice === voice.id
                              ? "border-primary bg-primary/5"
                              : "border-muted hover:border-primary/40"
                          }`}
                          data-testid={`button-create-voice-${voice.id}`}
                        >
                          {selectedVoice === voice.id && (
                            <Check className="absolute top-2 right-2 h-3.5 w-3.5 text-primary" />
                          )}
                          <div className="text-sm font-medium">{voice.label}</div>
                          <div className="text-xs text-muted-foreground">{voice.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={() => createMutation.mutate()}
                      disabled={!name.trim() || createMutation.isPending}
                      data-testid="button-save-profile"
                    >
                      {createMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Analyzing your photo...
                        </>
                      ) : (
                        <>
                          <Camera className="mr-2 h-4 w-4" />
                          Save Profile
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowForm(false);
                        setName("");
                        setPhotoPreview(null);
                        setPhotoBase64(null);
                        setSelectedVoice(null);
                      }}
                      data-testid="button-cancel-profile"
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <Card className="bg-primary/5 border-primary/10">
          <CardContent className="p-5">
            <h3 className="font-semibold mb-2">How does this work?</h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li>1. Upload a clear photo of yourself (face visible)</li>
              <li>2. Add more photos from different angles (side profile, full body, different lighting) for better accuracy</li>
              <li>3. AI analyzes ALL your photos together to build a detailed description of your appearance</li>
              <li>4. Choose an AI narration voice or record your own</li>
              <li>5. When you create stories, the AI uses your appearance and voice to bring your stories to life</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
