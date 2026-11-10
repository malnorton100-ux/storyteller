import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Loader2, ArrowLeft, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Question = { question: string; hint?: string };
type Step = "questions" | "result";

interface StoryHelperProps {
  content: string;
  era?: string;
  category?: string;
  onUse: (story: string) => void;
}

/**
 * Story Helper: asks a few friendly follow-up questions, then rewrites the memory into a
 * vivid, picture-ready story in the storyteller's own voice. Replaces the old "Polish my story".
 */
export function StoryHelper({ content, era, category, onUse }: StoryHelperProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("questions");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [story, setStory] = useState("");

  const questionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/story-helper/questions", { content, era, category });
      return res.json() as Promise<{ questions: Question[] }>;
    },
    onSuccess: (data) => {
      setQuestions(data.questions);
      setAnswers(data.questions.map(() => ""));
      setStep("questions");
    },
    onError: () => {
      setOpen(false);
      toast({ title: "Couldn't start the Story Helper", description: "Please try again.", variant: "destructive" });
    },
  });

  const writeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/story-helper/write", {
        content,
        era,
        category,
        answers: questions.map((q, i) => ({ question: q.question, answer: answers[i] || "" })),
      });
      return res.json() as Promise<{ story: string }>;
    },
    onSuccess: (data) => {
      setStory(data.story);
      setStep("result");
    },
    onError: () => {
      toast({ title: "Couldn't write your story", description: "Please try again.", variant: "destructive" });
    },
  });

  function start() {
    setOpen(true);
    setStep("questions");
    setQuestions([]);
    setStory("");
    questionsMutation.mutate();
  }

  const answeredCount = answers.filter((a) => a.trim()).length;
  const loadingQuestions = questionsMutation.isPending;
  const writing = writeMutation.isPending;

  return (
    <>
      <Button
        type="button"
        variant="default"
        className="w-full h-11 text-base"
        onClick={start}
        disabled={content.trim().length < 20}
        data-testid="button-story-helper"
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Make my story amazing
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!writing) setOpen(o); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto w-[calc(100%-1.5rem)] rounded-lg p-5">
          {loadingQuestions && (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-medium">Reading your story...</p>
              <p className="text-sm text-muted-foreground">Thinking of a few questions to bring it to life.</p>
            </div>
          )}

          {!loadingQuestions && writing && (
            <div className="py-10 flex flex-col items-center gap-3 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-medium">Writing your story...</p>
              <p className="text-sm text-muted-foreground">Weaving in your answers. This takes about 20 seconds.</p>
            </div>
          )}

          {!loadingQuestions && !writing && step === "questions" && questions.length > 0 && (
            <div className="space-y-5">
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-xl">A few quick questions</DialogTitle>
                <DialogDescription>
                  The more you tell us, the better your pictures and movie will be. Skip any you like.
                </DialogDescription>
              </DialogHeader>

              {questions.map((q, i) => (
                <div key={i} className="space-y-2">
                  <Label htmlFor={`helper-q-${i}`} className="text-base leading-snug">{q.question}</Label>
                  <Textarea
                    id={`helper-q-${i}`}
                    value={answers[i] || ""}
                    placeholder={q.hint || "Type or tap the mic on your keyboard to talk"}
                    onChange={(e) => {
                      const next = [...answers];
                      next[i] = e.target.value;
                      setAnswers(next);
                    }}
                    className="min-h-[72px] text-base"
                    data-testid={`input-helper-answer-${i}`}
                  />
                </div>
              ))}

              <Button
                className="w-full h-11 text-base"
                onClick={() => writeMutation.mutate()}
                data-testid="button-helper-write"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {answeredCount > 0 ? "Write my story" : "Skip questions and write it"}
              </Button>
            </div>
          )}

          {!loadingQuestions && !writing && step === "result" && (
            <div className="space-y-4">
              <DialogHeader className="text-left">
                <DialogTitle className="font-serif text-xl">Here's your story</DialogTitle>
                <DialogDescription>
                  Read it through. If it feels like you, use it. You can still edit any word afterwards.
                </DialogDescription>
              </DialogHeader>

              <div
                className="rounded-md border bg-muted/30 p-4 font-serif text-base leading-relaxed whitespace-pre-wrap max-h-[45vh] overflow-y-auto"
                data-testid="text-helper-story"
              >
                {story}
              </div>

              <div className="space-y-2">
                <Button
                  className="w-full h-11 text-base"
                  onClick={() => {
                    onUse(story);
                    setOpen(false);
                    toast({ title: "Story updated!", description: "Your new story is ready. Edit anything you like." });
                  }}
                  data-testid="button-helper-use"
                >
                  <Check className="mr-2 h-4 w-4" />
                  Use this story
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setStep("questions")} data-testid="button-helper-back">
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Add more
                  </Button>
                  <Button variant="outline" onClick={() => writeMutation.mutate()} data-testid="button-helper-retry">
                    <RefreshCw className="mr-1 h-4 w-4" />
                    Try again
                  </Button>
                </div>
                <Button variant="ghost" className="w-full" onClick={() => setOpen(false)} data-testid="button-helper-keep">
                  Keep my original
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
