import { useState, useRef, useEffect } from "react";
import { useGetChatHistory, useSendChatMessage, useGetRaces, useGetDashboardSummary } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetChatHistoryQueryKey, getGetRacesQueryKey } from "@workspace/api-client-react";
import { Bot, CalendarDays, Clock3, MessageSquare, Send, Settings2, ShieldCheck, Sparkles, TrendingUp, User, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatConfidenceBand, formatMinutesToRace } from "@/lib/forecast";
import { Link } from "wouter";

function renderMessage(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const bold = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const isHeading = /^###?\s/.test(line);
    const isBullet = /^[-•*]\s/.test(line);
    const isNumbered = /^\d+\.\s/.test(line);
    const clean = bold.replace(/^#{1,3}\s/, "").replace(/^[-•*]\s/, "").replace(/^\d+\.\s/, "");

    if (isHeading) {
      return (
        <p key={i} className="font-semibold text-foreground mt-2 mb-0.5"
          dangerouslySetInnerHTML={{ __html: clean }} />
      );
    }
    if (isBullet || isNumbered) {
      return (
        <div key={i} className="flex gap-1.5 ml-1">
          <span className="text-primary mt-0.5 shrink-0">{isNumbered ? line.match(/^\d+/)?.[0] + "." : "•"}</span>
          <p dangerouslySetInnerHTML={{ __html: clean }} />
        </div>
      );
    }
    if (line.trim() === "") return <div key={i} className="h-2" />;
    return <p key={i} dangerouslySetInnerHTML={{ __html: bold }} />;
  });
}

type WeightsUpdate = {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
  updatedAt: string;
};

function formatConfidence(value?: number | null) {
  return value == null ? "Forecast pending" : `${Math.round(value * 100)}% confidence`;
}

export default function Chat() {
  const qc = useQueryClient();
  const { data: history, isLoading } = useGetChatHistory();
  const { data: races } = useGetRaces();
  const { data: summary } = useGetDashboardSummary();
  const sendMessage = useSendChatMessage();

  const [input, setInput] = useState("");
  const [selectedRaceId, setSelectedRaceId] = useState<number | undefined>();
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{ role: string; content: string; id: number }>>([]);
  const [lastWeightsUpdate, setLastWeightsUpdate] = useState<WeightsUpdate | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const allMessages = [...(history ?? []), ...optimisticMessages];
  const summaryTodayCards = summary?.todayCards ?? [];
  const todayRaces = summaryTodayCards.length > 0
    ? summaryTodayCards
    : (races ?? []).filter((r) => r.status === "upcoming" || r.status === "analyzing");
  const weeklyOverview = summary?.weeklyOverview ?? [];
  const performance = summary?.performance;
  const focusRace = (races ?? []).find((race) => race.id === selectedRaceId)
    ?? todayRaces.find((race) => race.id === selectedRaceId);
  const nextUpRace = [...todayRaces]
    .filter((race) => race.status === "upcoming" || race.status === "analyzing")
    .sort((left, right) => {
      const leftMinutes = left.minutesToRace ?? Number.MAX_SAFE_INTEGER;
      const rightMinutes = right.minutesToRace ?? Number.MAX_SAFE_INTEGER;
      return leftMinutes - rightMinutes;
    })[0];
  const bestBetRace = [...todayRaces]
    .filter((race) => race.topPrediction)
    .sort((left, right) => {
      const confidenceGap = (right.topPrediction?.confidence ?? 0) - (left.topPrediction?.confidence ?? 0);
      if (confidenceGap !== 0) return confidenceGap;
      return (right.prominence ?? 0) - (left.prominence ?? 0);
    })[0];
  const recentModelResult = performance?.recentResults?.[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length, sendMessage.isPending]);

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || sendMessage.isPending) return;

    setInput("");
    const tempId = Date.now();
    setOptimisticMessages((prev) => [...prev, { role: "user", content: msg, id: tempId }]);

    try {
      const result = await sendMessage.mutateAsync({
        data: { message: msg, raceId: selectedRaceId },
      });
      if ((result as { updatedWeights?: WeightsUpdate }).updatedWeights) {
        setLastWeightsUpdate((result as { updatedWeights: WeightsUpdate }).updatedWeights);
        await qc.invalidateQueries({ queryKey: getGetRacesQueryKey() });
      }
      await qc.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
      setOptimisticMessages([]);
    } catch {
      setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const dynamicSuggestions = todayRaces.length > 0
    ? [
        bestBetRace?.topPrediction ? `Why is ${bestBetRace.topPrediction.horseName} the best bet today?` : null,
        nextUpRace ? `Talk me through ${nextUpRace.name}` : null,
        focusRace?.topPrediction ? `Who can beat ${focusRace.topPrediction.horseName} in ${focusRace.name}?` : null,
        weeklyOverview[0]?.spotlightRaceName ? `Which race later this week looks strongest?` : null,
        recentModelResult ? `What did the latest ${recentModelResult.topPickCorrect ? "hit" : "miss"} teach the model?` : null,
        `Which jockey has the best book today?`,
        `Which races are worth betting on?`,
        `Increase weight on odds movement`,
      ].filter((value): value is string => Boolean(value))
    : [
        "Give more weight to odds movement",
        "Which horse has the best trainer/jockey combo?",
        "Explain the current prediction weights",
        "Make course form more important",
      ];

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] md:h-screen max-w-3xl mx-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-5 text-primary" />
          <h1 className="font-semibold text-foreground">AI Chat</h1>
          {todayRaces.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/15 text-accent font-medium">
              {todayRaces.length} races loaded
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:block">Focus:</span>
          <select
            value={selectedRaceId ?? ""}
            onChange={(e) => setSelectedRaceId(e.target.value ? Number(e.target.value) : undefined)}
            className="text-xs bg-card border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring max-w-[160px]"
          >
            <option value="">All races</option>
            {(races ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      {lastWeightsUpdate && (
        <div className="mx-6 mt-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent/10 border border-accent/20">
          <Settings2 className="size-4 text-accent shrink-0" />
          <p className="text-xs text-accent flex-1">
            <strong>Weights updated:</strong> Course Form {(lastWeightsUpdate.courseForm * 100).toFixed(0)}% · Form/Dist {(lastWeightsUpdate.formDistance * 100).toFixed(0)}% · Jockey/Trainer {(lastWeightsUpdate.jockeyTrainer * 100).toFixed(0)}% · Odds {(lastWeightsUpdate.oddsMovement * 100).toFixed(0)}% · History {(lastWeightsUpdate.history * 100).toFixed(0)}%
          </p>
          <button onClick={() => setLastWeightsUpdate(null)} className="text-muted-foreground hover:text-foreground text-base leading-none">&times;</button>
        </div>
      )}

      <div className="px-6 pt-4 grid gap-3 md:grid-cols-3">
        {bestBetRace?.topPrediction && (
          <button
            onClick={() => {
              setSelectedRaceId(bestBetRace.id);
              setInput(`Why is ${bestBetRace.topPrediction?.horseName} the best bet today?`);
            }}
            className="text-left rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 hover:bg-primary/15 transition-colors"
          >
            <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-wide">
              <Sparkles className="size-3.5" /> Best bet now
            </div>
            <p className="text-sm font-semibold text-foreground mt-2">{bestBetRace.topPrediction.horseName}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Race {bestBetRace.raceNumber} {bestBetRace.name} · {formatConfidence(bestBetRace.topPrediction.confidence)}
            </p>
            <p className="text-xs text-primary mt-2">{formatConfidenceBand(bestBetRace.forecastBand)}</p>
          </button>
        )}

        {nextUpRace && (
          <button
            onClick={() => {
              setSelectedRaceId(nextUpRace.id);
              setInput(`Talk me through ${nextUpRace.name}`);
            }}
            className="text-left rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/30 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Clock3 className="size-3.5 text-primary" /> Next off
            </div>
            <p className="text-sm font-semibold text-foreground mt-2">Race {nextUpRace.raceNumber} {nextUpRace.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{nextUpRace.venue} · {nextUpRace.raceTime} · {formatMinutesToRace(nextUpRace.minutesToRace)}</p>
            <p className="text-xs text-foreground mt-2">{nextUpRace.topPrediction ? `${nextUpRace.topPrediction.horseName} leads the book` : "Forecast still building"}</p>
          </button>
        )}

        {(weeklyOverview[0] || recentModelResult) && (
          <button
            onClick={() => setInput(weeklyOverview[0]?.spotlightRaceName ? `Which race later this week looks strongest?` : `What did the latest result teach the model?`)}
            className="text-left rounded-xl border border-border bg-card px-4 py-3 hover:border-primary/30 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {weeklyOverview[0]?.spotlightRaceName ? <CalendarDays className="size-3.5 text-primary" /> : <ShieldCheck className="size-3.5 text-primary" />} Weekly angle
            </div>
            <p className="text-sm font-semibold text-foreground mt-2">
              {weeklyOverview[0]?.spotlightRaceName ?? (recentModelResult?.topPickCorrect ? "Recent model hit" : "Recent model lesson")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {weeklyOverview[0]?.spotlightRaceName
                ? `${weeklyOverview[0].label} · ${weeklyOverview[0].spotlightHorseName ?? "Spotlight forming"}${weeklyOverview[0].spotlightConfidence != null ? ` · ${Math.round(weeklyOverview[0].spotlightConfidence * 100)}%` : ""}`
                : recentModelResult
                  ? `${recentModelResult.raceName} · ${recentModelResult.topPickCorrect ? "top pick landed" : "top pick missed"}`
                  : "Ask for the week-ahead confidence map"}
            </p>
            <p className="text-xs text-foreground mt-2">
              {performance?.strongestEdge ?? "Use chat to compare today against the next 7 days"}
            </p>
          </button>
        )}
      </div>

      {focusRace && (
        <div className="mx-6 mt-3 rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Focused race</p>
            <p className="text-sm font-semibold text-foreground mt-1">Race {focusRace.raceNumber} {focusRace.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {focusRace.venue} · {focusRace.raceTime} · {formatMinutesToRace(focusRace.minutesToRace)}
            </p>
            <p className="text-xs text-foreground mt-2">
              {focusRace.topPrediction
                ? `${focusRace.topPrediction.horseName} leads at ${formatConfidence(focusRace.topPrediction.confidence)} · ${formatConfidenceBand(focusRace.forecastBand)}`
                : "Forecast still building for this race"}
            </p>
          </div>
          <button onClick={() => setSelectedRaceId(undefined)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {isLoading ? (
          <div className="text-center text-muted-foreground text-sm pt-8">Loading chat history...</div>
        ) : allMessages.length === 0 ? (
          <div className="text-center pt-8 space-y-5">
            <div className="size-16 rounded-full bg-primary/15 flex items-center justify-center mx-auto">
              <Bot className="size-8 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-lg">AAA Bets AI Analyst</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                I have full visibility of today's race card — every horse, jockey, trainer, form, odds movement, and AI prediction score. Ask me anything.
              </p>
            </div>
            {todayRaces.length > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-4 max-w-md mx-auto text-left space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Today's races I can analyse</p>
                {todayRaces.slice(0, 5).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm gap-3">
                    <span className="text-foreground min-w-0 truncate">{r.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{r.raceTime} · {r.distance}m</span>
                  </div>
                ))}
                {todayRaces.length > 5 && (
                  <p className="text-xs text-muted-foreground">+{todayRaces.length - 5} more races</p>
                )}
              </div>
            )}
            {weeklyOverview.length > 0 && (
              <div className="bg-card border border-card-border rounded-xl p-4 max-w-md mx-auto text-left space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Week-ahead angles</p>
                {weeklyOverview.slice(0, 3).map((day) => (
                  <div key={day.date} className="flex items-start justify-between gap-3 text-sm">
                    <div>
                      <p className="text-foreground font-medium">{day.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {day.raceCount} races · {day.venues.join(", ") || "Venues pending"}
                      </p>
                    </div>
                    <span className="text-xs text-primary shrink-0">
                      {day.spotlightHorseName && day.spotlightConfidence != null
                        ? `${day.spotlightHorseName} ${Math.round(day.spotlightConfidence * 100)}%`
                        : "Building"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
              {dynamicSuggestions.slice(0, 4).map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-primary/15 hover:text-primary transition-colors text-muted-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          allMessages.map((msg, i) => (
            <div
              key={(msg as { id?: number }).id ?? `opt-${i}`}
              className={cn("flex gap-3", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              <div className={cn(
                "size-8 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
              )}>
                {msg.role === "user" ? <User className="size-4" /> : <Bot className="size-4 text-primary" />}
              </div>
              <div className={cn(
                "max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-relaxed space-y-0.5",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-card border border-card-border text-foreground rounded-tl-sm",
              )}>
                {msg.role === "assistant"
                  ? renderMessage(msg.content)
                  : msg.content
                }
              </div>
            </div>
          ))
        )}
        {sendMessage.isPending && (
          <div className="flex gap-3">
            <div className="size-8 rounded-full bg-muted flex items-center justify-center">
              <Bot className="size-4 text-primary" />
            </div>
            <div className="bg-card border border-card-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-4">
                <span className="size-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="size-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="size-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {allMessages.length > 0 && allMessages.length < 5 && (
        <div className="px-6 pb-2 flex flex-wrap gap-2">
          {dynamicSuggestions.slice(0, 3).map((s) => (
            <button
              key={s}
              onClick={() => setInput(s)}
              className="text-xs px-3 py-1.5 rounded-full bg-muted hover:bg-primary/15 hover:text-primary transition-colors text-muted-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="px-6 py-4 border-t border-border space-y-2">
        <div className="flex gap-3 items-end bg-card border border-card-border rounded-xl p-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={focusRace
              ? `Ask about ${focusRace.name}, ${focusRace.topPrediction?.horseName ?? "the field"}, or the best play...`
              : todayRaces.length > 0
                ? `Ask about today's ${todayRaces.length} races, best bets, weights...`
                : "Ask about predictions, weights, race strategy..."}
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground resize-none focus:outline-none placeholder:text-muted-foreground min-h-[24px] max-h-[120px]"
            style={{ height: "auto" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 120) + "px";
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMessage.isPending}
            className="size-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity disabled:opacity-40"
          >
            {sendMessage.isPending ? <Zap className="size-4 animate-pulse" /> : <Send className="size-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {focusRace ? `Focused on Race ${focusRace.raceNumber} · ` : ""}Enter to send · Shift+Enter for new line
          </p>
          <Link href="/weights">
            <span className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer">
              <TrendingUp className="size-3" /> Adjust weights
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
