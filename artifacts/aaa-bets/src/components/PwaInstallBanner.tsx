import { Download, Smartphone, X } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { usePwaInstall } from "@/hooks/use-pwa-install";

export default function PwaInstallBanner() {
  const { ios, canPromptInstall, installed, dismissed, installing, install, dismiss } = usePwaInstall();

  if (installed || dismissed) return null;
  if (!ios && !canPromptInstall) return null;

  return (
    <div className="border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-primary/10 p-2 text-primary sm:mt-0">
            {ios ? <Smartphone className="size-4" /> : <Download className="size-4" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Install AAA Bets</p>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {ios
                ? "On iPhone or iPad, tap Share and choose Add to Home Screen for the app-style version."
                : "Install AAA directly from your browser for desktop and mobile use."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/install">
            <span className="cursor-pointer rounded-xl border border-border px-3 py-2 text-sm text-foreground hover:bg-muted">
              Install guide
            </span>
          </Link>
          {canPromptInstall && !ios && (
            <button
              onClick={() => void install()}
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
            onClick={dismiss}
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
