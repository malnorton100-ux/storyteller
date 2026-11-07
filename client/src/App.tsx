import { Switch, Route, useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import AuthPage from "@/pages/auth-page";
import Welcome, { ONBOARDING_SKIP_KEY } from "@/pages/welcome";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Stories from "@/pages/stories";
import StoryDetail from "@/pages/story-detail";
import NewStory from "@/pages/new-story";
import RecordStory from "@/pages/record-story";
import Profile from "@/pages/profile";
import Timeline from "@/pages/timeline";
import SharedStory from "@/pages/shared-story";
import Prompts from "@/pages/prompts";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/stories" component={Stories} />
      <Route path="/stories/:id" component={StoryDetail} />
      <Route path="/prompts" component={Prompts} />
      <Route path="/new" component={NewStory} />
      <Route path="/record" component={RecordStory} />
      <Route path="/timeline" component={Timeline} />
      <Route path="/profile" component={Profile} />
      <Route path="/shared/:token" component={SharedStory} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

function Shell() {
  const { user, isLoading } = useAuth();
  const [location] = useLocation();
  const [skipped, setSkipped] = useState(() => {
    try { return !!localStorage.getItem(ONBOARDING_SKIP_KEY); } catch { return false; }
  });
  const { data: profiles, isLoading: profilesLoading } = useQuery<any[]>({
    queryKey: ["/api/storyteller-profiles"],
    enabled: !!user,
  });

  // Shared/gifted storybooks are public - family can open them without an account.
  if (location.startsWith("/shared/")) {
    return (
      <main className="h-screen overflow-y-auto">
        <Switch>
          <Route path="/shared/:token" component={SharedStory} />
        </Switch>
      </main>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return <div className="h-screen overflow-y-auto"><AuthPage /></div>;

  // Brand-new users (no photo yet) get the guided 3-step start.
  if (profilesLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!skipped && Array.isArray(profiles) && profiles.length === 0) {
    return (
      <div className="h-screen overflow-y-auto">
        <Welcome
          onSkip={() => {
            try { localStorage.setItem(ONBOARDING_SKIP_KEY, "skipped"); } catch {}
            setSkipped(true);
          }}
        />
      </div>
    );
  }

  return (
          <SidebarProvider style={sidebarStyle as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-1 p-2 border-b relative z-50">
                  <SidebarTrigger className="h-9 w-9 min-h-[36px] min-w-[36px]" data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-hidden">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <Shell />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
