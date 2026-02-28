import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Sparkles, Trash2, BookOpen, Palette, Image as ImageIcon, Loader2, Film, Play, CircleUserRound, ShieldCheck, Images, ChevronLeft, ChevronRight, Download, ShoppingCart, Check, FileText, Video, Volume2, Type, X, Pencil, RotateCcw, Bot, Users, Plus, UserCircle, Share2, Gift, Copy, CheckCircle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StoryPlayer } from "@/components/story-player";
import type { Story, Illustration, StoryVideo, StorytellerProfile, Purchase, StoryPerspective } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type StoryWithIllustrations = Story & { illustrations: Illustration[] };

const ratingOptions = [
  { value: "G", label: "G", desc: "Fully family-friendly" },
  { value: "PG", label: "PG", desc: "Some dramatic tension" },
  { value: "M", label: "M", desc: "Raw, intense emotion" },
];

function StorySlideshow({ illustrations, onViewImage, onDelete, storyId, indexOffset }: {
  illustrations: Illustration[];
  onViewImage: (index: number) => void;
  onDelete: (id: number) => void;
  storyId: number;
  indexOffset: number;
}) {
  const [current, setCurrent] = useState(0);
  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [savingText, setSavingText] = useState(false);
  const { toast } = useToast();
  const sorted = [...illustrations].sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0));
  const ill = sorted[current];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (editingText) return;
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(sorted.length - 1, c + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sorted.length, editingText]);

  if (!ill) return null;

  const hasCustomText = !!ill.customText;
  const displayText = ill.customText || ill.sceneCaption || "";

  const startEditing = () => {
    setTextDraft(ill.customText ?? ill.sceneCaption ?? "");
    setEditingText(true);
  };

  const saveText = async () => {
    setSavingText(true);
    try {
      await apiRequest("PATCH", `/api/illustrations/${ill.id}`, { customText: textDraft || null });
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
      setEditingText(false);
      toast({ title: "Text saved" });
    } catch {
      toast({ title: "Failed to save text", variant: "destructive" });
    }
    setSavingText(false);
  };

  const resetToAI = async () => {
    setSavingText(true);
    try {
      await apiRequest("PATCH", `/api/illustrations/${ill.id}`, { customText: null });
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
      toast({ title: "Reset to AI caption" });
    } catch {
      toast({ title: "Failed to reset text", variant: "destructive" });
    }
    setSavingText(false);
  };

  let slideTouchStartX = 0;
  let slideTouchStartY = 0;
  const handleSlideTouchStart = (e: React.TouchEvent) => {
    slideTouchStartX = e.touches[0].clientX;
    slideTouchStartY = e.touches[0].clientY;
  };
  const handleSlideTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - slideTouchStartX;
    const dy = e.changedTouches[0].clientY - slideTouchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && current < sorted.length - 1) setCurrent(c => c + 1);
      if (dx > 0 && current > 0) setCurrent(c => c - 1);
    }
  };

  return (
    <Card data-testid={`slideshow-${sorted[0].id}`}>
      <CardContent className="p-0">
        <div className="relative" onTouchStart={handleSlideTouchStart} onTouchEnd={handleSlideTouchEnd}>
          <img
            src={ill.imageUrl}
            alt={ill.sceneCaption || `Scene ${current + 1}`}
            className="w-full aspect-[16/10] object-cover rounded-t-md cursor-pointer select-none"
            onClick={() => !editingText && onViewImage(indexOffset + current)}
            draggable={false}
            data-testid={`img-scene-${current + 1}`}
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4 rounded-b-none">
            {editingText ? (
              <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                <p className="text-white/70 text-xs font-medium uppercase tracking-wide">Write your own text for this page</p>
                <textarea
                  value={textDraft}
                  onChange={(e) => setTextDraft(e.target.value)}
                  className="w-full bg-black/40 text-white text-sm rounded-md px-3 py-2 border border-white/30 resize-none focus:outline-none focus:border-white/60"
                  rows={3}
                  placeholder="Tell this part of the story in your own words..."
                  autoFocus
                  data-testid="input-page-text"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setEditingText(false)}
                    className="bg-white/20 hover:bg-white/30 text-white rounded-md px-3 py-1.5 text-xs transition-colors"
                    data-testid="button-cancel-text"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveText}
                    disabled={savingText}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                    data-testid="button-save-text"
                  >
                    {savingText ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  {hasCustomText ? (
                    <span className="inline-flex items-center gap-1 text-amber-300/90 text-[10px] uppercase tracking-wider font-semibold">
                      <Pencil className="h-2.5 w-2.5" />
                      Your text
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-blue-300/80 text-[10px] uppercase tracking-wider font-semibold">
                      <Bot className="h-2.5 w-2.5" />
                      AI caption
                    </span>
                  )}
                </div>
                <p className="text-white text-sm font-medium leading-snug">{displayText || `Scene ${current + 1}`}</p>
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); startEditing(); }}
                    className="inline-flex items-center gap-1.5 bg-white/15 hover:bg-white/25 text-white/90 rounded-md px-2.5 py-1 text-xs transition-colors"
                    data-testid="button-edit-text"
                  >
                    <Pencil className="h-3 w-3" />
                    {hasCustomText ? "Edit your text" : "Write your own"}
                  </button>
                  {hasCustomText && (
                    <button
                      onClick={(e) => { e.stopPropagation(); resetToAI(); }}
                      disabled={savingText}
                      className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white/70 rounded-md px-2.5 py-1 text-xs transition-colors"
                      data-testid="button-reset-ai-text"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Use AI caption
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          {sorted.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingText(false); setCurrent(Math.max(0, current - 1)); }}
                className={`absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors ${current === 0 ? "opacity-30 pointer-events-none" : ""}`}
                data-testid="button-prev-scene"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingText(false); setCurrent(Math.min(sorted.length - 1, current + 1)); }}
                className={`absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 transition-colors ${current === sorted.length - 1 ? "opacity-30 pointer-events-none" : ""}`}
                data-testid="button-next-scene"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Images className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm capitalize">{ill.style} style</span>
              <span className="text-xs text-muted-foreground">Page {current + 1} of {sorted.length}</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(ill.id)}
              data-testid={`button-delete-illustration-${ill.id}`}
            >
              <Trash2 className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
          <div className="flex gap-1.5 justify-center">
            {sorted.map((_, idx) => (
              <button
                key={idx}
                onClick={() => { setEditingText(false); setCurrent(idx); }}
                className={`w-2 h-2 rounded-full transition-colors ${idx === current ? "bg-primary" : "bg-muted-foreground/30"}`}
                data-testid={`dot-scene-${idx + 1}`}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function StoryDetail() {
  const [, params] = useRoute("/stories/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedStyle, setSelectedStyle] = useState("cartoon");
  const [selectedRating, setSelectedRating] = useState("G");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [viewingImageIndex, setViewingImageIndex] = useState<number | null>(null);
  const [playingVideo, setPlayingVideo] = useState<StoryVideo | null>(null);
  const [pollingVideoId, setPollingVideoId] = useState<number | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [isGeneratingIllustrations, setIsGeneratingIllustrations] = useState(false);
  const [illustrationJobId, setIllustrationJobId] = useState<string | null>(null);
  const [illustrationProgress, setIllustrationProgress] = useState({ completed: 0, total: 4 });
  const [enableNarration, setEnableNarration] = useState(true);
  const [sceneCount, setSceneCount] = useState(4);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [giftMessageDraft, setGiftMessageDraft] = useState("");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isEditingStory, setIsEditingStory] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editEra, setEditEra] = useState("");
  const [editCategory, setEditCategory] = useState("");

  const storyId = params?.id ? parseInt(params.id) : 0;

  const { data: story, isLoading } = useQuery<StoryWithIllustrations>({
    queryKey: ["/api/stories", storyId],
    enabled: storyId > 0,
  });

  useEffect(() => {
    if (story?.contentRating) setSelectedRating(story.contentRating);
  }, [story?.contentRating]);

  const { data: videos, isLoading: videosLoading } = useQuery<StoryVideo[]>({
    queryKey: ["/api/stories", storyId, "videos"],
    enabled: storyId > 0,
  });

  const { data: profiles } = useQuery<StorytellerProfile[]>({
    queryKey: ["/api/storyteller-profiles"],
  });

  const { data: perspectives, isLoading: perspectivesLoading } = useQuery<StoryPerspective[]>({
    queryKey: ["/api/stories", storyId, "perspectives"],
    enabled: storyId > 0,
  });

  const [showPerspectiveForm, setShowPerspectiveForm] = useState(false);
  const [perspectiveAuthor, setPerspectiveAuthor] = useState("");
  const [perspectiveContent, setPerspectiveContent] = useState("");

  const addPerspectiveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/stories/${storyId}/perspectives`, {
        authorName: perspectiveAuthor,
        content: perspectiveContent,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId, "perspectives"] });
      setPerspectiveAuthor("");
      setPerspectiveContent("");
      setShowPerspectiveForm(false);
      toast({ title: "Perspective added", description: "Another voice has been added to this story." });
    },
    onError: () => {
      toast({ title: "Failed to add perspective", variant: "destructive" });
    },
  });

  const deletePerspectiveMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/perspectives/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId, "perspectives"] });
      toast({ title: "Perspective removed" });
    },
  });

  const { data: videoConfig } = useQuery<{ aiVideoEnabled: boolean; mode: string }>({
    queryKey: ["/api/video-config"],
  });
  const aiVideoEnabled = videoConfig?.aiVideoEnabled ?? false;

  const [browserSessionId] = useState(() => {
    let id = localStorage.getItem("storykeeper_session");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("storykeeper_session", id);
    }
    return id;
  });

  const { data: stripeProducts } = useQuery<any[]>({
    queryKey: ["/api/stripe/products"],
  });

  const { data: storyPurchases, refetch: refetchPurchases } = useQuery<Purchase[]>({
    queryKey: ["/api/stories", storyId, "purchases", browserSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/stories/${storyId}/purchases?sessionId=${browserSessionId}`);
      return res.json();
    },
    enabled: storyId > 0,
  });

  const hasPdfPurchase = storyPurchases?.some(p => p.productType === "pdf_download" || p.productType === "bundle_download") ?? false;
  const hasVideoPurchase = storyPurchases?.some(p => p.productType === "video_download" || p.productType === "bundle_download") ?? false;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "success" && params.get("session_id")) {
      const verifyPayment = async () => {
        try {
          await apiRequest("POST", "/api/stripe/verify-payment", { sessionId: params.get("session_id"), browserSessionId });
          refetchPurchases();
          toast({ title: "Payment successful!", description: "Your download is now available." });
          window.history.replaceState({}, "", `/stories/${storyId}`);
        } catch {
          toast({ title: "Payment verification issue", description: "Please refresh the page.", variant: "destructive" });
        }
      };
      verifyPayment();
    } else if (params.get("payment") === "cancelled") {
      toast({ title: "Payment cancelled", description: "No charge was made." });
      window.history.replaceState({}, "", `/stories/${storyId}`);
    }
  }, [storyId, toast, refetchPurchases]);

  const checkoutMutation = useMutation({
    mutationFn: async ({ priceId, productType }: { priceId: string; productType: string }) => {
      const res = await apiRequest("POST", "/api/stripe/checkout", {
        priceId,
        storyId,
        productType,
        sessionId: browserSessionId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
    onError: () => {
      toast({ title: "Checkout failed", description: "Please try again.", variant: "destructive" });
    },
  });

  const { data: pollingVideo } = useQuery<StoryVideo>({
    queryKey: ["/api/videos", pollingVideoId],
    enabled: pollingVideoId !== null,
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (pollingVideo && pollingVideo.status === "complete") {
      setPollingVideoId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId, "videos"] });
      toast({ title: "Animated story ready!", description: "Your story has been brought to life. Click play to watch." });
    } else if (pollingVideo && pollingVideo.status === "failed") {
      setPollingVideoId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId, "videos"] });
      toast({ title: "Video generation failed", description: "The AI couldn't create this video. Try a different art style or adjust the content rating.", variant: "destructive" });
    }
  }, [pollingVideo, storyId, toast]);

  const generateMutation = useMutation({
    mutationFn: async (style: string) => {
      await apiRequest("PATCH", `/api/stories/${storyId}`, { contentRating: selectedRating });
      const res = await apiRequest("POST", `/api/stories/${storyId}/illustrations`, { style, profileId: selectedProfileId, sceneCount });
      return res.json();
    },
    onSuccess: (data) => {
      setDialogOpen(false);
      setIsGeneratingIllustrations(true);
      setIllustrationJobId(data.jobId);
      setIllustrationProgress({ completed: 0, total: data.totalScenes || sceneCount });
      toast({ title: "Creating your story illustrations...", description: `AI is generating ${data.totalScenes || sceneCount} scenes from your story. This takes about a minute.` });
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (!isGeneratingIllustrations || !illustrationJobId) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/illustration-jobs/${illustrationJobId}`);
        const job = await res.json();
        setIllustrationProgress({ completed: job.completedScenes || 0, total: job.totalScenes || 4 });

        if (job.status === "complete" || job.status === "failed" || job.status === "cancelled") {
          setIsGeneratingIllustrations(false);
          setIllustrationJobId(null);
          queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
          if (job.status === "complete") {
            toast({ title: "Story illustrations complete!", description: `${job.completedScenes} scenes have been illustrated.` });
          } else if (job.status === "cancelled") {
            // Already toasted from cancel button
          } else {
            toast({ title: "Some illustrations may have failed", description: "Please try again.", variant: "destructive" });
          }
        } else {
          queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
        }
      } catch {
        queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isGeneratingIllustrations, illustrationJobId, storyId, toast]);

  const selectedProfile = profiles?.find(p => p.id === selectedProfileId) || profiles?.[0];
  const profileHasVoice = !!(selectedProfile?.voicePreference);

  const generateVideoMutation = useMutation({
    mutationFn: async (style: string) => {
      await apiRequest("PATCH", `/api/stories/${storyId}`, { contentRating: selectedRating });
      const res = await apiRequest("POST", `/api/stories/${storyId}/videos`, {
        style,
        profileId: selectedProfileId,
        enableNarration: enableNarration && profileHasVoice,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setVideoDialogOpen(false);
      setPollingVideoId(data.id);
      const hasNarration = enableNarration && profileHasVoice;
      toast({
        title: "Creating your AI movie...",
        description: hasNarration
          ? "AI is generating video clips and narration for each scene. This takes 4-6 minutes."
          : "AI is generating real moving video clips for each scene. This takes 3-5 minutes.",
      });
    },
    onError: () => {
      toast({ title: "Generation failed", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  const shareMutation = useMutation({
    mutationFn: async (giftMessage: string) => {
      const res = await apiRequest("POST", `/api/stories/${storyId}/share`, { giftMessage: giftMessage || null });
      return res.json();
    },
    onSuccess: (data) => {
      const link = `${window.location.origin}/shared/${data.shareToken}`;
      setShareLink(link);
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
    },
    onError: () => {
      toast({ title: "Failed to generate share link", variant: "destructive" });
    },
  });

  const handleCopyLink = useCallback(() => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setLinkCopied(true);
      toast({ title: "Link copied to clipboard!" });
      setTimeout(() => setLinkCopied(false), 3000);
    }
  }, [shareLink, toast]);

  const handleOpenShareDialog = useCallback(() => {
    setShareDialogOpen(true);
    setGiftMessageDraft("");
    setShareLink(story?.shareToken ? `${window.location.origin}/shared/${story.shareToken}` : null);
    setLinkCopied(false);
  }, [story?.shareToken]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/stories/${storyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      navigate("/stories");
      toast({ title: "Story deleted" });
    },
  });

  const editStoryMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; era?: string; category?: string }) => {
      await apiRequest("PATCH", `/api/stories/${storyId}`, data);
    },
    onSuccess: () => {
      setIsEditingStory(false);
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/stories"] });
      toast({ title: "Story updated" });
    },
    onError: () => {
      toast({ title: "Failed to save changes", variant: "destructive" });
    },
  });

  const startEditingStory = useCallback(() => {
    if (!story) return;
    setEditTitle(story.title);
    setEditContent(story.content);
    setEditEra(story.era || "");
    setEditCategory(story.category || "");
    setIsEditingStory(true);
  }, [story]);

  const deleteIllustrationMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/illustrations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
      toast({ title: "Illustration removed" });
    },
  });

  const deleteVideoMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/videos/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId, "videos"] });
      toast({ title: "Animated story removed" });
    },
  });

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full rounded-md" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (!story) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <BookOpen className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground">Story not found</p>
          <Link href="/stories">
            <Button variant="secondary">Back to Stories</Button>
          </Link>
        </div>
      </div>
    );
  }

  const completedVideos = videos?.filter((v) => v.status === "complete") || [];
  const generatingVideos = videos?.filter((v) => v.status === "generating") || [];
  const failedVideos = videos?.filter((v) => v.status === "failed") || [];
  const isGeneratingVideo = pollingVideoId !== null || generatingVideos.length > 0;

  const hasProfiles = profiles && profiles.length > 0;
  const activeProfile = selectedProfileId ? profiles?.find(p => p.id === selectedProfileId) : profiles?.[0];

  const ProfilePicker = () => (
    hasProfiles ? (
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Storyteller Character</p>
        <div className="flex flex-wrap gap-2">
          {profiles!.map((profile) => (
            <button
              key={profile.id}
              onClick={() => setSelectedProfileId(profile.id === selectedProfileId ? null : profile.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                (selectedProfileId === profile.id || (!selectedProfileId && profiles![0].id === profile.id))
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/50"
              }`}
              data-testid={`button-select-profile-${profile.id}`}
            >
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt={profile.name} className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <CircleUserRound className="w-5 h-5" />
              )}
              <span>{profile.name}</span>
            </button>
          ))}
        </div>
        {activeProfile?.appearanceDescription && (
          <p className="text-xs text-green-600">AI will depict {activeProfile.name} as the character</p>
        )}
      </div>
    ) : (
      <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/50 text-sm">
        <CircleUserRound className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-muted-foreground">
          <Link href="/profile" className="text-primary underline" data-testid="link-add-profile">Add your photo</Link> so the AI can depict you as the character
        </span>
      </div>
    )
  );

  const styleOptions = [
    { value: "cartoon", label: "Cartoon", desc: "Fun, colorful, Pixar-style", img: "/images/style-cartoon.png" },
    { value: "realistic", label: "Realistic", desc: "Photorealistic, cinematic", img: "/images/style-realistic.png" },
    { value: "era", label: "Era Style", desc: "Authentic period art", img: "/images/style-era.png" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {playingVideo && playingVideo.videoUrl && (
        <StoryPlayer
          videoUrl={playingVideo.videoUrl}
          title={story.title}
          style={playingVideo.style}
          onClose={() => setPlayingVideo(null)}
        />
      )}

      {viewingImageIndex !== null && (() => {
        const allSorted = [...(story.illustrations || [])].sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0));
        const img = allSorted[viewingImageIndex];
        if (!img) return null;
        const goPrev = () => setViewingImageIndex(Math.max(0, viewingImageIndex - 1));
        const goNext = () => setViewingImageIndex(Math.min(allSorted.length - 1, viewingImageIndex + 1));
        let touchStartX = 0;
        let touchStartY = 0;
        const handleTouchStart = (e: React.TouchEvent) => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        };
        const handleTouchEnd = (e: React.TouchEvent) => {
          const dx = e.changedTouches[0].clientX - touchStartX;
          const dy = e.changedTouches[0].clientY - touchStartY;
          if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
            if (dx < 0 && viewingImageIndex < allSorted.length - 1) goNext();
            if (dx > 0 && viewingImageIndex > 0) goPrev();
          }
        };
        return (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
            onClick={() => setViewingImageIndex(null)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            data-testid="overlay-image-viewer"
          >
            <button
              className="absolute top-4 right-4 text-white/70 hover:text-white z-10"
              onClick={(e) => { e.stopPropagation(); setViewingImageIndex(null); }}
              data-testid="button-close-viewer"
            >
              <X className="h-8 w-8" />
            </button>
            {allSorted.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); goPrev(); }}
                  className={`absolute left-3 md:left-6 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/30 text-white rounded-full p-2 md:p-3 transition-colors z-10 ${viewingImageIndex === 0 ? "opacity-20 pointer-events-none" : ""}`}
                  data-testid="button-viewer-prev"
                >
                  <ChevronLeft className="h-6 w-6 md:h-8 md:w-8" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); goNext(); }}
                  className={`absolute right-3 md:right-6 top-1/2 -translate-y-1/2 bg-white/15 hover:bg-white/30 text-white rounded-full p-2 md:p-3 transition-colors z-10 ${viewingImageIndex === allSorted.length - 1 ? "opacity-20 pointer-events-none" : ""}`}
                  data-testid="button-viewer-next"
                >
                  <ChevronRight className="h-6 w-6 md:h-8 md:w-8" />
                </button>
              </>
            )}
            <div className="flex flex-col items-center gap-3 max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
              <img src={img.imageUrl} alt={img.sceneCaption || `Scene ${viewingImageIndex + 1}`} className="max-w-[90vw] max-h-[80vh] object-contain rounded-md select-none" draggable={false} />
              <div className="text-center text-white/80 text-sm">
                Page {viewingImageIndex + 1} of {allSorted.length}
                {allSorted.length > 1 && (
                  <div className="flex justify-center gap-1.5 mt-2">
                    {allSorted.map((_, i) => (
                      <button
                        key={i}
                        onClick={(e) => { e.stopPropagation(); setViewingImageIndex(i); }}
                        className={`w-2 h-2 rounded-full transition-all ${i === viewingImageIndex ? "bg-white scale-125" : "bg-white/40"}`}
                        data-testid={`button-viewer-dot-${i}`}
                      />
                    ))}
                  </div>
                )}
                {img.sceneCaption && <span className="block text-white/60 text-xs mt-1">{img.customText || img.sceneCaption}</span>}
              </div>
            </div>
          </div>
        );
      })()}

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-1">
          <Link href="/stories">
            <Button variant="outline" size="icon" className="rounded-full h-10 w-10" data-testid="button-back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex flex-wrap gap-2">
            <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" onClick={handleOpenShareDialog} data-testid="button-share-story">
                  <Share2 className="mr-2 h-4 w-4" />
                  Share
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Share & Gift This Story</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2 pb-4">
                  <p className="text-sm text-muted-foreground">
                    Create a beautiful shareable link to this story. Optionally include a heartfelt gift message.
                  </p>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Gift Message (optional)</label>
                    <textarea
                      value={giftMessageDraft}
                      onChange={(e) => setGiftMessageDraft(e.target.value)}
                      placeholder="e.g., For my grandchildren, may these stories keep our memories alive..."
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      rows={3}
                      data-testid="input-gift-message"
                    />
                  </div>
                  {!shareLink ? (
                    <Button
                      onClick={() => shareMutation.mutate(giftMessageDraft)}
                      disabled={shareMutation.isPending}
                      className="w-full"
                      data-testid="button-generate-share-link"
                    >
                      {shareMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Gift className="mr-2 h-4 w-4" />
                      )}
                      {shareMutation.isPending ? "Generating..." : "Generate Share Link"}
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50 border">
                        <span className="text-sm truncate flex-1 text-muted-foreground" data-testid="text-share-link">{shareLink}</span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleCopyLink}
                          data-testid="button-copy-share-link"
                        >
                          {linkCopied ? (
                            <>
                              <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-green-600" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="mr-1.5 h-3.5 w-3.5" />
                              Copy
                            </>
                          )}
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => { setShareLink(null); shareMutation.mutate(giftMessageDraft); }}
                        disabled={shareMutation.isPending}
                        className="w-full"
                        data-testid="button-update-share-link"
                      >
                        {shareMutation.isPending ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Gift className="mr-2 h-4 w-4" />
                        )}
                        {shareMutation.isPending ? "Updating..." : "Update Gift Message"}
                      </Button>
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="secondary" data-testid="button-create-illustration">
                  <Sparkles className="mr-2 h-4 w-4" />
                  Illustration
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Illustration</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2 pb-4">
                  <ProfilePicker />
                  <p className="text-sm text-muted-foreground">
                    Choose an art style and number of pages. AI will break your story into scenes and create an illustrated series.
                  </p>
                  <div className="grid grid-cols-3 gap-3">
                    {styleOptions.map((style) => (
                      <button
                        key={style.value}
                        onClick={() => setSelectedStyle(style.value)}
                        className={`rounded-md border-2 p-2 text-left transition-colors ${
                          selectedStyle === style.value
                            ? "border-primary bg-primary/5"
                            : "border-transparent bg-muted/50"
                        }`}
                        data-testid={`button-style-${style.value}`}
                      >
                        <img src={style.img} alt={style.label} className="w-full aspect-[4/3] object-cover rounded-md mb-2" />
                        <p className="text-sm font-medium">{style.label}</p>
                        <p className="text-xs text-muted-foreground">{style.desc}</p>
                      </button>
                    ))}
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Content Rating</p>
                    <div className="flex gap-2">
                      {ratingOptions.map((r) => (
                        <button
                          key={r.value}
                          onClick={() => setSelectedRating(r.value)}
                          className={`flex-1 rounded-md border-2 p-2 text-center transition-colors ${
                            selectedRating === r.value
                              ? "border-primary bg-primary/5"
                              : "border-transparent bg-muted/50"
                          }`}
                          data-testid={`button-ill-rating-${r.value}`}
                        >
                          <p className="text-sm font-bold">{r.label}</p>
                          <p className="text-[10px] text-muted-foreground">{r.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Number of Pages</p>
                    <div className="flex gap-2">
                      {[2, 4, 6, 8].map((count) => (
                        <button
                          key={count}
                          onClick={() => setSceneCount(count)}
                          className={`flex-1 rounded-md border-2 p-2 text-center transition-colors ${
                            sceneCount === count
                              ? "border-primary bg-primary/5"
                              : "border-transparent bg-muted/50"
                          }`}
                          data-testid={`button-scene-count-${count}`}
                        >
                          <p className="text-sm font-bold">{count}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {count === 2 ? "Quick" : count === 4 ? "Standard" : count === 6 ? "Detailed" : "Epic"}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => generateMutation.mutate(selectedStyle)}
                    disabled={generateMutation.isPending || isGeneratingIllustrations}
                    data-testid="button-generate"
                  >
                    {generateMutation.isPending || isGeneratingIllustrations ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {isGeneratingIllustrations ? "Generating scenes..." : "Starting..."}
                      </>
                    ) : (
                      <>
                        <Images className="mr-2 h-4 w-4" />
                        Generate Story Series ({sceneCount} pages)
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-video">
                  <Film className="mr-2 h-4 w-4" />
                  Story Movie
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create Story Movie</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2 pb-4">
                  <ProfilePicker />
                  <p className="text-sm text-muted-foreground">
                    {aiVideoEnabled
                      ? "AI will break your story into scenes, generate real moving video clips for each one, and stitch them into a short movie your family can watch."
                      : "AI will break your story into scenes, illustrate each one, and create an animated visual experience your family can watch."}
                  </p>
                  {aiVideoEnabled && (
                    <div className="flex items-center gap-2 p-2.5 rounded-md bg-green-50 dark:bg-green-950/30 text-sm">
                      <Film className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span className="text-green-700 dark:text-green-400">AI Video mode active. Real moving video clips will be generated. This takes 3-5 minutes.</span>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    {styleOptions.map((style) => (
                      <button
                        key={style.value}
                        onClick={() => setSelectedStyle(style.value)}
                        className={`rounded-md border-2 p-2 text-left transition-colors ${
                          selectedStyle === style.value
                            ? "border-primary bg-primary/5"
                            : "border-transparent bg-muted/50"
                        }`}
                        data-testid={`button-video-style-${style.value}`}
                      >
                        <img src={style.img} alt={style.label} className="w-full aspect-[4/3] object-cover rounded-md mb-2" />
                        <p className="text-sm font-medium">{style.label}</p>
                        <p className="text-xs text-muted-foreground">{style.desc}</p>
                      </button>
                    ))}
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">Content Rating</p>
                    <div className="flex gap-2">
                      {ratingOptions.map((r) => (
                        <button
                          key={r.value}
                          onClick={() => setSelectedRating(r.value)}
                          className={`flex-1 rounded-md border-2 p-2 text-center transition-colors ${
                            selectedRating === r.value
                              ? "border-primary bg-primary/5"
                              : "border-transparent bg-muted/50"
                          }`}
                          data-testid={`button-vid-rating-${r.value}`}
                        >
                          <p className="text-sm font-bold">{r.label}</p>
                          <p className="text-[10px] text-muted-foreground">{r.desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                  {aiVideoEnabled && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Volume2 className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">Voice Narration</span>
                        </div>
                        <button
                          onClick={() => setEnableNarration(!enableNarration)}
                          className={`relative w-11 h-6 rounded-full transition-colors ${
                            enableNarration && profileHasVoice ? "bg-primary" : "bg-muted-foreground/30"
                          }`}
                          disabled={!profileHasVoice}
                          data-testid="toggle-narration"
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                            enableNarration && profileHasVoice ? "translate-x-5" : "translate-x-0"
                          }`} />
                        </button>
                      </div>
                      {profileHasVoice ? (
                        <p className="text-xs text-muted-foreground">
                          {enableNarration
                            ? `Scenes will be narrated using the "${selectedProfile?.voicePreference}" AI voice from ${selectedProfile?.name}'s profile.`
                            : "Narration is off. The movie will be silent."}
                        </p>
                      ) : (
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Set up a voice in your <a href="/profile" className="underline">storyteller profile</a> to enable narration.
                        </p>
                      )}
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => generateVideoMutation.mutate(selectedStyle)}
                    disabled={generateVideoMutation.isPending || isGeneratingVideo}
                    data-testid="button-generate-video"
                  >
                    {generateVideoMutation.isPending || isGeneratingVideo ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {isGeneratingVideo ? "Already generating..." : "Starting..."}
                      </>
                    ) : (
                      <>
                        <Film className="mr-2 h-4 w-4" />
                        {aiVideoEnabled ? "Create AI Movie" : "Create Story Movie"}
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm("Are you sure you want to delete this story?")) {
                  deleteMutation.mutate();
                }
              }}
              data-testid="button-delete-story"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>

        {story.coverImageUrl && (
          <img
            src={story.coverImageUrl}
            alt={story.title}
            className="w-full h-48 md:h-64 object-cover rounded-md"
          />
        )}

        {isEditingStory ? (
          <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
            <div>
              <label className="text-sm font-medium mb-1 block">Title</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="text-lg font-bold"
                data-testid="input-edit-title"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">Era</label>
                <select
                  value={editEra}
                  onChange={(e) => setEditEra(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="select-edit-era"
                >
                  <option value="">No era</option>
                  {["1940s","1950s","1960s","1970s","1980s","1990s","2000s","2010s","2020s"].map(e => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Category</label>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="select-edit-category"
                >
                  <option value="">No category</option>
                  {["Childhood","Family","Love","Work","Travel","Holidays","Friendship","Life Lessons","Cooking","Other"].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Story</label>
              <Textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={12}
                className="resize-y"
                data-testid="input-edit-content"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditingStory(false)}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => editStoryMutation.mutate({
                  title: editTitle.trim(),
                  content: editContent.trim(),
                  era: editEra || undefined,
                  category: editCategory || undefined,
                })}
                disabled={!editTitle.trim() || !editContent.trim() || editStoryMutation.isPending}
                data-testid="button-save-edit"
              >
                {editStoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save Changes
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-start justify-between gap-2">
                <h1 className="text-2xl md:text-3xl font-bold mb-2" data-testid="text-story-title">{story.title}</h1>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={startEditingStory}
                  className="flex-shrink-0 mt-1"
                  data-testid="button-edit-story"
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {story.era && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {story.era}
                  </span>
                )}
                {story.category && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {story.category}
                  </span>
                )}
                {story.contentRating && story.contentRating !== "G" && (
                  <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                    story.contentRating === "M" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                  }`} data-testid="badge-content-rating">
                    <ShieldCheck className="h-3 w-3" />
                    {story.contentRating}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {new Date(story.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                </span>
              </div>
            </div>

            <div className="prose prose-neutral dark:prose-invert max-w-none" data-testid="text-story-content">
              {story.content.split("\n").map((paragraph, i) => (
                paragraph.trim() ? <p key={i}>{paragraph}</p> : null
              ))}
            </div>
          </>
        )}

        <section className="space-y-4 pt-4" data-testid="section-perspectives">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Other Perspectives</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPerspectiveForm(!showPerspectiveForm)}
              data-testid="button-add-perspective"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add a Perspective
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Family members can share their own version of this story. Different memories, different angles, same moment.
          </p>

          {showPerspectiveForm && (
            <Card data-testid="form-perspective">
              <CardContent className="p-4 space-y-3">
                <Input
                  placeholder="Your name (e.g., Aunt Rita, Dad)"
                  value={perspectiveAuthor}
                  onChange={(e) => setPerspectiveAuthor(e.target.value)}
                  data-testid="input-perspective-author"
                />
                <Textarea
                  placeholder="Tell this story from your perspective..."
                  value={perspectiveContent}
                  onChange={(e) => setPerspectiveContent(e.target.value)}
                  rows={5}
                  className="resize-none"
                  data-testid="input-perspective-content"
                />
                <div className="flex gap-2 justify-end flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowPerspectiveForm(false);
                      setPerspectiveAuthor("");
                      setPerspectiveContent("");
                    }}
                    data-testid="button-cancel-perspective"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => addPerspectiveMutation.mutate()}
                    disabled={!perspectiveAuthor.trim() || !perspectiveContent.trim() || addPerspectiveMutation.isPending}
                    data-testid="button-submit-perspective"
                  >
                    {addPerspectiveMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Save Perspective
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {perspectivesLoading && (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          )}

          {perspectives && perspectives.length > 0 && (
            <div className="space-y-3">
              {perspectives.map((p) => (
                <Card key={p.id} data-testid={`card-perspective-${p.id}`}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-5 w-5 text-muted-foreground" />
                        <span className="font-medium text-sm" data-testid={`text-perspective-author-${p.id}`}>{p.authorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deletePerspectiveMutation.mutate(p.id)}
                        data-testid={`button-delete-perspective-${p.id}`}
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
                    <div className="text-sm text-muted-foreground leading-relaxed" data-testid={`text-perspective-content-${p.id}`}>
                      {p.content.split("\n").map((para, i) => (
                        para.trim() ? <p key={i} className="mb-2 last:mb-0">{para}</p> : null
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!perspectivesLoading && (!perspectives || perspectives.length === 0) && !showPerspectiveForm && (
            <Card>
              <CardContent className="p-6 text-center">
                <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No other perspectives yet. Invite a family member to share their side of the story.</p>
              </CardContent>
            </Card>
          )}
        </section>

        {/* @ts-ignore - purchases section disabled for now */}
        {false as boolean && story && ((story as any).illustrations.length > 0 || completedVideos.length > 0) && stripeProducts && (stripeProducts as any[]).length > 0 && (
          <section className="pt-4" data-testid="section-downloads">
            <Card className="border-primary/20 bg-gradient-to-br from-amber-50/50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Download className="h-5 w-5 text-primary" />
                  <h2 className="text-lg font-semibold">Download Your Story</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Share this beautiful story with your family. Download as a PDF storybook or an animated video movie.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {stripeProducts?.map((product: any) => {
                    const productType = product.metadata?.type || "";
                    const isPurchased = productType === "pdf_download" ? hasPdfPurchase
                      : productType === "video_download" ? hasVideoPurchase
                      : hasPdfPurchase && hasVideoPurchase;
                    const isDisabled = productType === "pdf_download" ? story!.illustrations.length === 0
                      : productType === "video_download" ? completedVideos.length === 0
                      : story!.illustrations.length === 0 && completedVideos.length === 0;
                    const price = product.unit_amount ? `$${(product.unit_amount / 100).toFixed(2)}` : "";

                    return (
                      <Card key={product.id} className={`transition-all ${isPurchased ? "border-green-500/50 bg-green-50/50 dark:bg-green-950/20" : ""}`} data-testid={`card-product-${productType}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            {productType === "pdf_download" ? <FileText className="h-5 w-5 text-blue-500" /> :
                             productType === "video_download" ? <Video className="h-5 w-5 text-purple-500" /> :
                             <ShoppingCart className="h-5 w-5 text-amber-500" />}
                            <h3 className="font-semibold text-sm">{product.name}</h3>
                          </div>
                          <p className="text-xs text-muted-foreground">{product.description}</p>
                          {isPurchased ? (
                            <Button
                              className="w-full"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (productType === "pdf_download" || productType === "bundle_download") {
                                  window.open(`/api/stories/${storyId}/download/pdf?sessionId=${browserSessionId}`, "_blank");
                                }
                                if (productType === "video_download" || productType === "bundle_download") {
                                  const vid = completedVideos[0];
                                  if (vid?.videoUrl) {
                                    const a = document.createElement("a");
                                    a.href = vid.videoUrl;
                                    a.download = `${story!.title.replace(/[^a-zA-Z0-9]/g, "_")}_video.mp4`;
                                    a.click();
                                  }
                                }
                              }}
                              data-testid={`button-download-${productType}`}
                            >
                              <Check className="mr-2 h-4 w-4 text-green-600" />
                              Purchased: Download
                            </Button>
                          ) : (
                            <Button
                              className="w-full"
                              size="sm"
                              disabled={isDisabled || checkoutMutation.isPending}
                              onClick={() => checkoutMutation.mutate({ priceId: product.price_id, productType })}
                              data-testid={`button-buy-${productType}`}
                            >
                              {checkoutMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <ShoppingCart className="mr-2 h-4 w-4" />
                              )}
                              {price}: Buy Now
                            </Button>
                          )}
                          {isDisabled && !isPurchased && (
                            <p className="text-xs text-muted-foreground text-center">
                              {productType === "pdf_download" ? "Create illustrations first" :
                               productType === "video_download" ? "Create a video first" :
                               "Create content first"}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {isGeneratingVideo && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  </div>
                  <div>
                    <p className="font-medium">Creating your animated story...</p>
                    <p className="text-sm text-muted-foreground">
                      AI is generating {pollingVideo?.scenes ? (pollingVideo.scenes as any[]).length : 0} of 4 scenes. This takes a few minutes.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const videoId = pollingVideoId || generatingVideos[0]?.id;
                    if (videoId) {
                      try {
                        await apiRequest("POST", `/api/videos/${videoId}/cancel`);
                      } catch {}
                    }
                    setPollingVideoId(null);
                    queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId, "videos"] });
                    toast({ title: "Video generation cancelled" });
                  }}
                  data-testid="button-cancel-video"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {completedVideos.length > 0 && (
          <section className="space-y-4 pt-4">
            <div className="flex items-center gap-2">
              <Film className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Animated Stories</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {completedVideos.map((video) => {
                return (
                  <Card key={video.id} data-testid={`card-video-${video.id}`}>
                    <CardContent className="p-0 relative group">
                      <div
                        className="relative cursor-pointer"
                        onClick={() => setPlayingVideo(video)}
                      >
                        <video
                          src={video.videoUrl || ""}
                          className="w-full aspect-video object-cover rounded-t-md"
                          muted
                          playsInline
                          preload="metadata"
                          poster={video.scenes?.[0]?.imageUrl || undefined}
                          onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                          onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                        />
                        <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-t-md group-hover:bg-black/30 transition-colors">
                          <div className="bg-white/90 rounded-full p-3 shadow-lg">
                            <Play className="h-6 w-6 text-black" fill="black" />
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-md px-2 py-1">
                          <span className="text-white text-xs font-medium">VIDEO</span>
                        </div>
                      </div>
                      <div className="p-3 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-2">
                          <Film className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm capitalize">{video.style} style</span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setPlayingVideo(video)}
                            data-testid={`button-play-video-${video.id}`}
                          >
                            <Play className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteVideoMutation.mutate(video.id)}
                            data-testid={`button-delete-video-${video.id}`}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        {failedVideos.length > 0 && (
          <div className="space-y-2">
            {failedVideos.map((video) => (
              <Card key={video.id} className="border-destructive/30 bg-destructive/5">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Film className="h-5 w-5 text-destructive" />
                    <div>
                      <p className="text-sm font-medium">Video generation failed</p>
                      <p className="text-xs text-muted-foreground">The AI couldn't create this animated story. This can happen with intense content. Try adjusting the rating or story.</p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteVideoMutation.mutate(video.id)}
                    data-testid={`button-delete-failed-video-${video.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {isGeneratingIllustrations && (
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-5 w-5 text-primary animate-spin" />
                  </div>
                  <div>
                    <p className="font-medium">Creating your story illustrations...</p>
                    <p className="text-sm text-muted-foreground">
                      AI is illustrating {illustrationProgress.completed} of {illustrationProgress.total} scenes. New images will appear as they're ready.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (illustrationJobId) {
                      try {
                        await apiRequest("POST", `/api/illustration-jobs/${illustrationJobId}/cancel`);
                      } catch {}
                    }
                    setIsGeneratingIllustrations(false);
                    setIllustrationJobId(null);
                    queryClient.invalidateQueries({ queryKey: ["/api/stories", storyId] });
                    toast({ title: "Illustration generation cancelled", description: "Any completed scenes have been saved." });
                  }}
                  data-testid="button-cancel-illustrations"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {story.illustrations && story.illustrations.length > 0 && (() => {
          const sceneSets: Illustration[][] = [];
          let currentSet: Illustration[] = [];
          let lastStyle = "";
          const sorted = [...story.illustrations].sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0) || a.id - b.id);

          sorted.forEach((ill, idx) => {
            if (ill.sceneCaption && ill.sceneOrder) {
              if (currentSet.length > 0 && (ill.sceneOrder === 1 || ill.style !== lastStyle)) {
                sceneSets.push(currentSet);
                currentSet = [];
              }
              currentSet.push(ill);
              lastStyle = ill.style;
            } else {
              if (currentSet.length > 0) {
                sceneSets.push(currentSet);
                currentSet = [];
              }
              sceneSets.push([ill]);
            }
            if (idx === sorted.length - 1 && currentSet.length > 0) {
              sceneSets.push(currentSet);
            }
          });

          return (
            <section className="space-y-6 pt-4" data-testid="section-illustrations">
              <div className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Story Illustrations</h2>
              </div>
              {sceneSets.map((set, setIdx) => {
                const allSorted = [...(story.illustrations || [])].sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0));
                const firstIllOfSet = [...set].sort((a, b) => (a.sceneOrder || 0) - (b.sceneOrder || 0))[0];
                const indexOffset = allSorted.findIndex(ill => ill.id === firstIllOfSet.id);
                if (set.length > 1 && set[0].sceneCaption) {
                  return (
                    <StorySlideshow
                      key={`set-${setIdx}`}
                      illustrations={set}
                      onViewImage={setViewingImageIndex}
                      onDelete={(id) => deleteIllustrationMutation.mutate(id)}
                      storyId={storyId}
                      indexOffset={indexOffset >= 0 ? indexOffset : 0}
                    />
                  );
                }
                return (
                  <Card key={`single-${set[0].id}`} data-testid={`card-illustration-${set[0].id}`}>
                    <CardContent className="p-0 relative group">
                      <img
                        src={set[0].imageUrl}
                        alt={set[0].sceneCaption || `${set[0].style} illustration`}
                        className="w-full aspect-[16/10] object-cover rounded-t-md cursor-pointer"
                        onClick={() => setViewingImageIndex(indexOffset >= 0 ? indexOffset : 0)}
                      />
                      <div className="p-3 flex items-center justify-between gap-1">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm capitalize">{set[0].sceneCaption || `${set[0].style} style`}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteIllustrationMutation.mutate(set[0].id)}
                          data-testid={`button-delete-illustration-${set[0].id}`}
                        >
                          <Trash2 className="h-3 w-3 text-muted-foreground" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </section>
          );
        })()}
      </div>
    </div>
  );
}
