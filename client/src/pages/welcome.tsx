import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { BookOpen, Camera, Check, ChevronLeft, Loader2, Mic, RotateCcw, Sparkles, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export const ONBOARDING_SKIP_KEY = "lw.onboarding.skipped";

/** The poses we ask for. More angles = the AI gets the face right more often. */
const POSES = [
  { key: "front", title: "Look straight at the camera", tip: "Face the camera, chin level, relaxed face.", emoji: "🙂" },
  { key: "left", title: "Turn your head a little to the left", tip: "Just a small turn - keep both eyes in view.", emoji: "↖️" },
  { key: "right", title: "Now a little to the right", tip: "Same again, the other way.", emoji: "↗️" },
  { key: "smile", title: "Give us a big smile!", tip: "Look straight ahead and smile like you mean it.", emoji: "😄" },
] as const;

const DECADES = ["1940s", "1950s", "1960s", "1970s", "1980s", "1990s", "2000s"];
const MEMORY_IDEAS = [
  "A family holiday you'll never forget",
  "Your first bike, car or pet",
  "Something cheeky you got up to as a kid",
  "Your best mate growing up",
];

/** Shrink a photo to max 1024px and return JPEG base64 (no data: prefix). */
async function toJpegBase64(source: HTMLVideoElement | HTMLImageElement, mirror: boolean): Promise<string> {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  const scale = Math.min(1, 1024 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  if (mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        resolve(await toJpegBase64(img, false));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-label={`Step ${step} of 3`}>
      {[1, 2, 3].map((n) => (
        <div key={n} className={`h-2.5 rounded-full transition-all ${n === step ? "w-10 bg-primary" : n < step ? "w-2.5 bg-primary" : "w-2.5 bg-primary/25"}`} />
      ))}
    </div>
  );
}

export default function Welcome({ onSkip }: { onSkip: () => void }) {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [name, setName] = useState(user?.name || "");
  const [shots, setShots] = useState<(string | null)[]>(POSES.map(() => null));
  const [poseIndex, setPoseIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // memory step
  const [era, setEra] = useState<string>("");
  const [memory, setMemory] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const profileIdRef = useRef<number | null>(null);

  // ---------- camera ----------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (step !== 1) {
      stopCamera();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraOk(true);
      } catch {
        setCameraOk(false);
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [step, stopCamera]);

  const allDone = shots.every(Boolean);
  const takenCount = shots.filter(Boolean).length;

  const saveShot = (b64: string) => {
    setShots((prev) => {
      const next = [...prev];
      next[poseIndex] = b64;
      const nextEmpty = next.findIndex((s) => !s);
      if (nextEmpty !== -1) setPoseIndex(nextEmpty);
      return next;
    });
  };

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    saveShot(await toJpegBase64(v, true));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      saveShot(await fileToBase64(f));
    } catch {
      setError("That photo couldn't be read. Please try another.");
    }
  };

  const uploadPhotos = async () => {
    setError(null);
    setBusy("Getting to know your face…");
    try {
      const front = shots[0]!;
      const res = await apiRequest("POST", "/api/storyteller-profiles", {
        name: name.trim() || "Me",
        photo: front,
        voicePreference: "alloy",
      });
      const profile = await res.json();
      profileIdRef.current = profile.id;
      const extras = shots.slice(1).filter(Boolean) as string[];
      if (extras.length) await apiRequest("POST", `/api/storyteller-profiles/${profile.id}/photos/batch`, { photos: extras });
      queryClient.invalidateQueries({ queryKey: ["/api/storyteller-profiles"] });
      stopCamera();
      setStep(2);
    } catch {
      setError("Something went wrong saving your photos. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  // ---------- voice ----------
  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.start(250);
      recorderRef.current = rec;
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setError("We couldn't use your microphone. You can type your memory instead.");
    }
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (timerRef.current) clearInterval(timerRef.current);
    rec.onstop = () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      const reader = new FileReader();
      reader.onload = async () => {
        setBusy("Writing down your words…");
        try {
          const base64 = (reader.result as string).split(",")[1];
          const res = await apiRequest("POST", "/api/transcribe", { audio: base64 });
          const data = await res.json();
          setMemory((m) => (m ? m + "\n\n" : "") + (data.transcript || ""));
        } catch {
          setError("We couldn't hear that clearly. Please try again, or type it in.");
        } finally {
          setBusy(null);
        }
      };
      reader.readAsDataURL(blob);
    };
    rec.stop();
  };

  const makeMagic = async () => {
    setError(null);
    setBusy("Saving your memory…");
    try {
      let title = "My first memory";
      try {
        const t = await (await apiRequest("POST", "/api/suggest-title", { content: memory })).json();
        if (t?.title) title = t.title;
      } catch {}
      const story = await (
        await apiRequest("POST", "/api/stories", {
          title,
          content: memory.trim(),
          era: era || null,
          category: null,
          contentRating: "G",
          coverImageUrl: null,
          audioTranscript: memory.trim(),
        })
      ).json();
      setBusy("Starting your pictures…");
      setStep(3);
      const job = await (
        await apiRequest("POST", `/api/stories/${story.id}/illustrations`, {
          style: "era",
          profileId: profileIdRef.current,
          sceneCount: 2,
        })
      ).json();
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      try { localStorage.setItem(ONBOARDING_SKIP_KEY, "done"); } catch {}
      navigate(`/stories/${story.id}?job=${encodeURIComponent(job.jobId)}&total=${job.totalScenes || 2}&first=1`);
    } catch {
      setBusy(null);
      setStep(2);
      setError("Something went wrong. Please try again.");
    }
  };

  // ---------- screens ----------
  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        {step > 0 && step < 3 ? (
          <Button variant="ghost" className="h-11 text-base" onClick={() => setStep((s) => (s - 1) as any)} data-testid="button-welcome-back">
            <ChevronLeft className="h-5 w-5 mr-1" /> Back
          </Button>
        ) : <span />}
        {step < 3 && (
          <Button variant="ghost" className="h-11 text-base text-foreground/60" onClick={onSkip} data-testid="button-welcome-skip">
            Skip for now
          </Button>
        )}
      </div>

      <div className="flex-1 w-full max-w-md mx-auto px-5 pb-10 flex flex-col">
        {step === 0 && (
          <div className="flex-1 flex flex-col justify-center gap-7 text-center">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-primary/15 flex items-center justify-center">
              <BookOpen className="h-10 w-10 text-primary" />
            </div>
            <div className="space-y-3">
              <h1 className="font-serif text-3xl font-bold leading-tight">Let's bring your first memory to life</h1>
              <p className="text-lg text-foreground/80">Three quick steps - about 3 minutes - and you'll see yourself as a kid, right back in the moment.</p>
            </div>
            <ol className="text-left text-lg space-y-3 mx-auto">
              <li>📸 &nbsp;A few quick selfies</li>
              <li>🎙️ &nbsp;Tell us one memory</li>
              <li>✨ &nbsp;See yourself back then</li>
            </ol>
            <div className="space-y-2 text-left">
              <label htmlFor="welcome-name" className="text-lg font-medium">What should we call you?</label>
              <Input id="welcome-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Poppy Mal" className="h-14 text-lg" data-testid="input-welcome-name" />
            </div>
            <Button className="h-14 text-lg" onClick={() => setStep(1)} disabled={!name.trim()} data-testid="button-welcome-start">
              Let's start
            </Button>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-5 pt-2">
            <StepDots step={1} />
            <div className="text-center space-y-1">
              <p className="text-base text-foreground/70">Photo {Math.min(poseIndex + 1, POSES.length)} of {POSES.length}</p>
              <h2 className="font-serif text-2xl font-bold">{allDone ? "Great photos!" : POSES[poseIndex].title}</h2>
              <p className="text-base text-foreground/75">{allDone ? "Check they look like you, then carry on." : POSES[poseIndex].tip}</p>
            </div>

            {!allDone && (
              <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden bg-black">
                {cameraOk !== false && (
                  <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover -scale-x-100" data-testid="video-selfie" />
                )}
                {/* face guide */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-[62%] aspect-[3/4] rounded-[50%] border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
                <div className="absolute top-3 inset-x-0 text-center text-4xl" aria-hidden="true">{POSES[poseIndex].emoji}</div>
                {flash && <div className="absolute inset-0 bg-white" />}
                {cameraOk === false && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center text-white">
                    <Camera className="h-10 w-10" />
                    <p className="text-lg">Tap below to take this photo with your camera.</p>
                  </div>
                )}
                {cameraOk === null && (
                  <div className="absolute inset-0 flex items-center justify-center text-white">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-4 gap-2">
              {POSES.map((p, i) => (
                <button
                  key={p.key}
                  onClick={() => setPoseIndex(i)}
                  className={`relative aspect-square rounded-xl overflow-hidden border-2 ${i === poseIndex && !allDone ? "border-primary" : "border-transparent"} bg-muted flex items-center justify-center`}
                  aria-label={shots[i] ? `Retake: ${p.title}` : p.title}
                  data-testid={`button-pose-${p.key}`}
                >
                  {shots[i] ? (
                    <>
                      <img src={`data:image/jpeg;base64,${shots[i]}`} alt="" className="w-full h-full object-cover" />
                      <span className="absolute bottom-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5"><Check className="h-3.5 w-3.5" /></span>
                    </>
                  ) : (
                    <span className="text-2xl">{p.emoji}</span>
                  )}
                </button>
              ))}
            </div>
            {takenCount > 0 && <p className="text-sm text-center text-foreground/60">Tap a photo to retake it.</p>}

            <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFile} />

            {!allDone ? (
              <div className="flex flex-col gap-3">
                <Button
                  className="h-16 text-lg rounded-full"
                  onClick={() => (cameraOk ? capture() : fileRef.current?.click())}
                  data-testid="button-take-photo"
                >
                  <Camera className="h-6 w-6 mr-2" /> Take photo
                </Button>
                <div className="flex gap-3">
                  {cameraOk && (
                    <Button variant="outline" className="flex-1 h-12 text-base" onClick={() => fileRef.current?.click()} data-testid="button-upload-photo">
                      <Upload className="h-5 w-5 mr-2" /> Choose a photo
                    </Button>
                  )}
                  {shots[0] && (
                    <Button variant="ghost" className="flex-1 h-12 text-base" onClick={uploadPhotos} disabled={!!busy} data-testid="button-photos-good-enough">
                      That's enough
                    </Button>
                  )}
                </div>
                <p className="text-sm text-center text-foreground/65">Good light on your face · take off hats and sunglasses · glasses are fine if you always wear them</p>
              </div>
            ) : (
              <Button className="h-14 text-lg" onClick={uploadPhotos} disabled={!!busy} data-testid="button-photos-continue">
                {busy ? <Loader2 className="h-5 w-5 mr-2 animate-spin" /> : null}
                {busy || "These look great - next"}
              </Button>
            )}
            {busy && !allDone && <p className="text-center text-base">{busy}</p>}
            {error && <p className="text-center text-destructive text-base" role="alert">{error}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-6 pt-2">
            <StepDots step={2} />
            <div className="text-center space-y-1">
              <h2 className="font-serif text-2xl font-bold">Tell us one memory</h2>
              <p className="text-base text-foreground/75">Just talk, like you're telling a friend. A minute is plenty.</p>
            </div>

            <div className="space-y-2">
              <p className="text-lg font-medium">Roughly when was it?</p>
              <div className="flex flex-wrap gap-2">
                {DECADES.map((d) => (
                  <Button key={d} variant={era === d ? "default" : "outline"} className="h-11 text-base" onClick={() => setEra(d)} data-testid={`button-era-${d}`}>
                    {d}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={!!busy}
                className={`w-28 h-28 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95 ${recording ? "bg-destructive animate-pulse" : "bg-primary"} text-primary-foreground disabled:opacity-60`}
                aria-label={recording ? "Stop recording" : "Start recording"}
                data-testid="button-record-memory"
              >
                {recording ? <Square className="h-10 w-10" /> : <Mic className="h-12 w-12" />}
              </button>
              <p className="text-lg">
                {busy ? busy : recording ? `Listening… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} - tap to finish` : memory ? "Tap to add more" : "Tap and start talking"}
              </p>
            </div>

            {!memory && !recording && (
              <div className="space-y-2">
                <p className="text-base text-foreground/70">Not sure what to say? Try:</p>
                <ul className="space-y-1 text-base">
                  {MEMORY_IDEAS.map((m) => <li key={m}>• {m}</li>)}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-base text-foreground/70">{memory ? "Here's what we heard - fix anything you like:" : "Or type it instead:"}</p>
              <Textarea
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                rows={6}
                className="text-lg"
                placeholder="When I was about ten, we used to camp at…"
                data-testid="input-memory"
              />
            </div>

            {error && <p className="text-center text-destructive text-base" role="alert">{error}</p>}
            <Button className="h-14 text-lg" onClick={makeMagic} disabled={!!busy || recording || memory.trim().length < 40} data-testid="button-make-magic">
              <Sparkles className="h-5 w-5 mr-2" /> Bring it to life
            </Button>
            {memory.trim().length > 0 && memory.trim().length < 40 && (
              <p className="text-center text-sm text-foreground/60">Tell us a little more - a few sentences is perfect.</p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center">
            <StepDots step={3} />
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <h2 className="font-serif text-2xl font-bold">{busy || "Opening your story…"}</h2>
            <p className="text-lg text-foreground/75">In about a minute you'll see yourself, back then.</p>
            {error && (
              <Button variant="outline" onClick={() => setStep(2)}>
                <RotateCcw className="h-4 w-4 mr-2" /> Try again
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
