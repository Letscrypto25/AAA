import { useEffect, useMemo, useState } from "react";
import { Download, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

export default function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const ios = useMemo(() => isIosDevice(), []);

  useEffect(() => {
    setInstalled(isStandaloneMode());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    setInstalling(true);
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setDismissed(true);
    }
    setDeferredPrompt(null);
    setInstalling(false);
  };

  if (installed || dismissed) return null;
  if (!ios && !deferredPrompt) return null;

  return (
    <div className="border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex max-w-5xl items-start gap-3 px-4 py-3 sm:px-6 sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary sm:mt-0">
            {ios ? <Smartphone className="size-4" /> : <Download className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Install AAA Bets</p>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {ios
                ? "On iPhone or iPad, tap Share and choose Add to Home Screen."
                : "Install the app directly from your browser for desktop and mobile use."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {deferredPrompt && !ios && (
            <button
              onClick={handleInstall}
              disabled={installing}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50",
              )}
            >
              <Download className="size-4" />
              {installing ? "Installing..." : "Install app"}
            </button>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="inline-flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dismiss install banner"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
