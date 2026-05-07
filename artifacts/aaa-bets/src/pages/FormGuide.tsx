import { useState } from "react";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

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
    id: "tote",
    label: "Tote Betting",
    url: "https://www.tote.co.za",
    description: "Tote — pool betting",
  },
] as const;

export default function FormGuide() {
  const [activeTab, setActiveTab] = useState<string>("fixture");
  const [key, setKey] = useState(0);

  const current = TABS.find((t) => t.id === activeTab) ?? TABS[0];

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
        {TABS.map((tab) => (
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
