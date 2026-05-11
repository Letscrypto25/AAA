import { CheckCircle2, Download, Laptop, Share2, Smartphone, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { usePwaInstall } from "@/hooks/use-pwa-install";

function StepCard({
  title,
  description,
  steps,
  icon: Icon,
}: {
  title: string;
  description: string;
  steps: string[];
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-primary/10 p-2 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {steps.map((step, index) => (
          <div key={step} className="flex gap-3 text-sm text-foreground">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
              {index + 1}
            </span>
            <p>{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function InstallApp() {
  const { ios, android, installed, canPromptInstall, installing, install, resetDismissed } = usePwaInstall();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="rounded-3xl border border-primary/20 bg-primary/10 p-6 sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Install AAA Bets</p>
            <h1 className="mt-2 text-3xl font-semibold text-foreground">Turn AAA into a proper app on phone or desktop</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Install it once and open it like a native app, straight from the web, with its own icon and cleaner full-screen feel.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {[
                "Desktop install",
                "Android install",
                "iPhone home screen",
                "Standalone app mode",
              ].map((pill) => (
                <span key={pill} className="rounded-full bg-background/70 px-3 py-1 text-foreground">
                  {pill}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-background/70 p-4 lg:min-w-[280px]">
            <p className="text-sm font-semibold text-foreground">Install status</p>
            {installed ? (
              <div className="mt-3 space-y-2">
                <p className="flex items-center gap-2 text-sm text-emerald-300">
                  <CheckCircle2 className="size-4" /> AAA Bets is already installed on this device.
                </p>
                <button
                  onClick={resetDismissed}
                  className="rounded-xl border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                >
                  Show install tips again
                </button>
              </div>
            ) : canPromptInstall ? (
              <div className="mt-3 space-y-3">
                <p className="text-sm text-muted-foreground">This browser can install AAA directly right now.</p>
                <button
                  onClick={() => void install()}
                  disabled={installing}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Download className="size-4" />
                  {installing ? "Installing..." : "Install AAA Bets"}
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                <p>{ios ? "Use Safari’s Share menu to add AAA to your home screen." : "Open this in a supported browser to install as an app."}</p>
                <p className="text-xs">Chrome, Edge, Samsung Internet, and Safari home-screen install are the best options.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <StepCard
          icon={Laptop}
          title="Desktop"
          description="Install AAA from Chrome or Edge on Windows or Mac."
          steps={[
            "Open AAA Bets in Chrome or Edge.",
            "Click the install icon in the address bar, or use the browser menu and choose Install App.",
            "Launch AAA Bets from your desktop or app launcher after install.",
          ]}
        />
        <StepCard
          icon={Smartphone}
          title="Android"
          description="Install AAA directly to your Android home screen."
          steps={[
            "Open AAA Bets in Chrome or Samsung Internet.",
            "Tap Install App or Add to Home Screen when prompted.",
            "Open AAA from the home screen like a normal app.",
          ]}
        />
        <StepCard
          icon={Share2}
          title="iPhone and iPad"
          description="Use Safari to save AAA as a home-screen app."
          steps={[
            "Open AAA Bets in Safari.",
            "Tap Share, then choose Add to Home Screen.",
            "Launch AAA from the icon for a cleaner app-style view.",
          ]}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-card-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Sparkles className="size-4 text-primary" />
            Why install it
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              "Opens like a dedicated app, not a browser tab",
              "Cleaner full-screen layout on mobile",
              "Faster return access from desktop or home screen",
              "Better day-to-day use for live cards and quick checks",
            ].map((item) => (
              <div key={item} className="rounded-xl border border-border bg-background/60 p-3 text-sm text-foreground">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-card-border bg-card p-5">
          <h2 className="font-semibold text-foreground">Best install route for this device</h2>
          <div className="mt-4 space-y-3 text-sm text-muted-foreground">
            {ios && <p>Use <span className="font-medium text-foreground">Safari</span> and Add to Home Screen.</p>}
            {!ios && android && <p>Use <span className="font-medium text-foreground">Chrome or Samsung Internet</span> and tap Install.</p>}
            {!ios && !android && <p>Use <span className="font-medium text-foreground">Chrome or Edge</span> and install from the address bar.</p>}
            <p>Once installed, AAA will feel much more like a normal app with a dedicated icon and standalone window.</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/">
              <span className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">Back to dashboard</span>
            </Link>
            {canPromptInstall && !installed && (
              <button
                onClick={() => void install()}
                disabled={installing}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {installing ? "Installing..." : "Install now"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
