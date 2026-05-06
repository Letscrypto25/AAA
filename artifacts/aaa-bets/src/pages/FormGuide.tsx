import { useState } from "react";
import { BookOpen, ExternalLink, RefreshCw } from "lucide-react";

const GALLOP_URL = "https://www.gallop.co.za/fixtures/fixtureIframeLink";

export default function FormGuide() {
  const [key, setKey] = useState(0);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <BookOpen className="size-5 text-primary" />
          <h1 className="font-semibold text-foreground">Form Guide</h1>
          <span className="text-xs text-muted-foreground ml-1">via gallop.co.za</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setKey((k) => k + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-xs font-medium transition-colors"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </button>
          <a
            href={GALLOP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <ExternalLink className="size-3.5" /> Open
          </a>
        </div>
      </div>
      <div className="flex-1 relative bg-background">
        <iframe
          key={key}
          src={GALLOP_URL}
          title="Gallop Form Guide"
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          loading="lazy"
        />
      </div>
    </div>
  );
}
