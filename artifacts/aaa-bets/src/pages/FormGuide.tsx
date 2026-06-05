import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const GALLOP_TV_FALLBACK_URL = "https://www.galloptv.co.za/live-streams/gallop-tv";

const TABS = [
  {
    id: "fixture",
    label: "Race Card",
    url: "https://www.sahorseform.co.za/v4.html",
    description: "SA Horse Form — live race cards & form",
  },
  {
    id: "programme",
    label: "Programme",
    url: "https://sahorseracing.co.za/sahr/public.html#mprog",
    description: "SA Horse Racing — race programme",
  },
  {
    id: "stats",
    label: "Racing Stats",
    url: "https://www.nhra.co.za/index.php/statistics/racing",
    description: "NHRA — historical racing statistics",
  },
  {
    id: "gallop-tv",
    label: "Gallop TV",
    url: GALLOP_TV_FALLBACK_URL,
    description: "Gallop TV - live racing stream",
  },
] as const;

function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function FormGuide() {
  const [activeTab, setActiveTab] = useState<string>("fixture");
  const [key, setKey] = useState(0);
  const [gallopTvUrl, setGallopTvUrl] = useState(GALLOP_TV_FALLBACK_URL);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/gallop/links")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancelled || !data || typeof data !== "object") return;
        const url = normalizeExternalUrl((data as { galloptvLink?: unknown }).galloptvLink);
        if (url) setGallopTvUrl(url);
      })
      .catch(() => {
        if (!cancelled) setGallopTvUrl(GALLOP_TV_FALLBACK_URL);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const tabs = useMemo(
    () => TABS.map((tab) => (tab.id === "gallop-tv" ? { ...tab, url: gallopTvUrl } : tab)),
    [gallopTvUrl],
  );
  const current = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          <h1 className="font-semibold text-foreground">Form Guide</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setKey((k) => k + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs font-medium transition-colors"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
          <a
            href={current.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="size-3.5" /> Open
          </a>
        </div>
      </div>

      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-card/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setKey((k) => k + 1); }}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground hidden sm:block">
          {current.description}
        </span>
      </div>

      <div className="flex-1 relative bg-background">
        <iframe
          key={`${activeTab}-${key}`}
          src={current.url}
          title={current.label}
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation"
          loading="lazy"
        />
      </div>
    </div>
  );
}
