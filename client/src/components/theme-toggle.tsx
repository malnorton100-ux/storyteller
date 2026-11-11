import { Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";

/** Big, labelled switch between light and dark screens. */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex items-center gap-2 h-12 min-w-[48px] px-4 rounded-lg border-2 border-border bg-background text-lg font-semibold hover:bg-muted active:bg-muted transition-colors"
      aria-label={isLight ? "Switch to dark screen" : "Switch to light screen"}
      data-testid="button-theme-toggle"
    >
      {isLight ? <Moon className="h-6 w-6" /> : <Sun className="h-6 w-6" />}
      <span>{isLight ? "Dark" : "Light"}</span>
    </button>
  );
}
