import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

/** Big, labelled Menu button for the top bar - easy to see and tap for older users. */
export function MenuButton() {
  const { toggleSidebar } = useSidebar();
  return (
    <button
      type="button"
      onClick={toggleSidebar}
      className="flex items-center gap-2 h-12 min-w-[48px] px-4 rounded-lg border-2 border-border bg-background text-lg font-semibold hover:bg-muted active:bg-muted transition-colors"
      aria-label="Open menu"
      data-testid="button-sidebar-toggle"
    >
      <Menu className="h-6 w-6" />
      <span>Menu</span>
    </button>
  );
}
