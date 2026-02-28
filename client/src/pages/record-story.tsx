import { useState, useRef, useCallback } from "react";
import { useLocation, Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Mic, MicOff, Save, Loader2, Sparkles, Wand2, Square, ShieldCheck, ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const ERAS = ["1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s", "2010s", "2020s"];
const CATEGORIES = ["Childhood", "Family", "Love", "Work", "Travel", "Holidays", "Friendship", "Life Lessons", "Cooking", "Other"];
const RATINGS = [
  { value: "G", label: "G - General", desc: "Safe for all ages" },
  { value: "PG", label: "PG - Parental Guidance", desc: "Dramatic but softened" },
  { value: "M", label: "M - Mature", desc: "As-written intensity" },
];

export default function RecordStory() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [era, setEra] = useState("");
  const [category, setCategory] = useState("");
  const [contentRating, setContentRating] = useState("G");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);

      toast({ title: "Recording started", description: "Speak naturally. Tell your story." });
    } catch {
      toast({ title: "Microphone access denied", description: "Please allow microphone access to record.", variant: "destructive" });
    }
  }, [toast]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    return new Promise<void>((resolve) => {
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        recorder.stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        setIsTranscribing(true);

        try {
          const reader = new FileReader();
          reader.onload = async () => {
            const base64 = (reader.result as string).split(",")[1];
            const res = await apiRequest("POST", "/api/transcribe", { audio: base64 });
            const data = await res.json();
            setContent((prev) => (prev ? prev + "\n\n" + data.transcript : data.transcript));
            toast({ title: "Transcription complete!", description: "Your words have been captured." });
            setIsTranscribing(false);
            resolve();
          };
          reader.readAsDataURL(blob);
        } catch {
          toast({ title: "Transcription failed", description: "Please try again.", variant: "destructive" });
          setIsTranscribing(false);
          resolve();
        }
      };
      recorder.stop();
    });
  }, [toast]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stories", {
        title: title || "Untitled Story",
        content,
        era: era || null,
        category: category || null,
        contentRating: contentRating || "G",
        coverImageUrl: null,
        audioTranscript: content,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      navigate(`/stories/${data.id}`);
      toast({ title: "Story saved!", description: "Your memory has been preserved." });
    },
    onError: () => {
      toast({ title: "Failed to save", description: "Please try again.", variant: "destructive" });
    },
  });

  const enhanceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/enhance-story", { content });
      return res.json();
    },
    onSuccess: (data) => {
      setContent(data.enhanced);
      toast({ title: "Story polished!" });
    },
  });

  const suggestTitleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/suggest-title", { content });
      return res.json();
    },
    onSuccess: (data) => {
      setTitle(data.title);
    },
  });

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const canSave = content.trim().length > 10;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-start gap-3">
          <Link href="/stories">
            <Button variant="outline" size="icon" className="mt-1 rounded-full shrink-0 h-10 w-10" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-record-title">Record Your Story</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Just press record and start talking. Tell us about a memory, an event, or someone special.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col items-center space-y-4">
              <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all ${
                isRecording
                  ? "bg-destructive/10 animate-pulse"
                  : isTranscribing
                  ? "bg-primary/10"
                  : "bg-muted"
              }`}>
                {isTranscribing ? (
                  <Loader2 className="h-12 w-12 text-primary animate-spin" />
                ) : isRecording ? (
                  <Mic className="h-12 w-12 text-destructive" />
                ) : (
                  <Mic className="h-12 w-12 text-muted-foreground" />
                )}
              </div>

              {isRecording && (
                <div className="text-center">
                  <p className="text-2xl font-mono font-bold text-destructive" data-testid="text-recording-duration">
                    {formatDuration(recordingDuration)}
                  </p>
                  <p className="text-sm text-muted-foreground">Recording...</p>
                </div>
              )}

              {isTranscribing && (
                <p className="text-sm text-muted-foreground">Transcribing your story...</p>
              )}

              <div className="flex gap-3">
                {isRecording ? (
                  <Button
                    size="lg"
                    variant="destructive"
                    onClick={stopRecording}
                    data-testid="button-stop-recording"
                  >
                    <Square className="mr-2 h-4 w-4" />
                    Stop Recording
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    onClick={startRecording}
                    disabled={isTranscribing}
                    data-testid="button-start-recording"
                  >
                    <Mic className="mr-2 h-4 w-4" />
                    {content ? "Record More" : "Start Recording"}
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {(content || isTranscribing) && (
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="space-y-2">
                <div className="flex items-end justify-between gap-1">
                  <Label htmlFor="title">Title</Label>
                  {content.trim().length > 20 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => suggestTitleMutation.mutate()}
                      disabled={suggestTitleMutation.isPending}
                      data-testid="button-suggest-title"
                    >
                      {suggestTitleMutation.isPending ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Wand2 className="mr-1 h-3 w-3" />
                      )}
                      Suggest title
                    </Button>
                  )}
                </div>
                <Input
                  id="title"
                  placeholder="Give your story a title..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  data-testid="input-title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transcript">Your Story</Label>
                <Textarea
                  id="transcript"
                  placeholder="Your transcribed story will appear here..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="min-h-[200px] text-base leading-relaxed"
                  data-testid="input-content"
                />
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs text-muted-foreground">{content.length} characters</span>
                  {content.trim().length > 50 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => enhanceMutation.mutate()}
                      disabled={enhanceMutation.isPending}
                      data-testid="button-enhance"
                    >
                      {enhanceMutation.isPending ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-3 w-3" />
                      )}
                      Polish my story
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>When did this happen?</Label>
                  <Select value={era} onValueChange={setEra}>
                    <SelectTrigger data-testid="select-era">
                      <SelectValue placeholder="Select era..." />
                    </SelectTrigger>
                    <SelectContent>
                      {ERAS.map((e) => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger data-testid="select-category">
                      <SelectValue placeholder="Select category..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <Label>Content Rating</Label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {RATINGS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setContentRating(r.value)}
                      className={`rounded-md border-2 p-2.5 text-left transition-colors ${
                        contentRating === r.value
                          ? "border-primary bg-primary/5"
                          : "border-transparent bg-muted/50 hover:bg-muted"
                      }`}
                      data-testid={`button-rating-${r.value}`}
                    >
                      <p className="text-sm font-semibold">{r.value}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">{r.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={() => createMutation.mutate()}
                disabled={!canSave || createMutation.isPending}
                data-testid="button-save-story"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save My Story
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
