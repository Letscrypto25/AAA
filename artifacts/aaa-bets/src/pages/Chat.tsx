import { useEffect, useRef, useState } from "react";
import {
  getGetChatHistoryQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetRacesQueryKey,
  getGetWeightsQueryKey,
  useGetChatHistory,
  useGetDashboardSummary,
  useGetRaces,
  useSendChatMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, MessageSquare, Send, Settings2, TrendingUp, User, Zap } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  isHistoryRaceCard,
  isLiveRaceCard,
  sortHistoryRaceCards,
  sortLiveRaceCards,
} from "@/lib/race-board";

type BetType = "win" | "place" | "exacta" | "trifecta" | "pick3";

type WeightsUpdate = {
  courseForm: number;
  formDistance: number;
  jockeyTrainer: number;
  oddsMovement: number;
  history: number;
  fieldStrength: number;
  weightCarried: number;
  surfaceFit: number;
  paceProfile: number;
  priceValue: number;
  updatedAt: string;
};

type ActionResult = {
  type: string;
  status: "executed" | "skipped" | "failed";
  label: string;
  detail: string;
};

type ChatMutationResult = {
  updatedWeights?: WeightsUpdate | null;
  actionResults?: ActionResult[];
  triggeredAnalysis?: boolean;
  selectedBetType?: BetType;
};

const BET_TYPE_OPTIONS: Array<{
  value: BetType;
  label: string;
  shortLabel: string;
  hint: string;
}> = [
  {
    value: "win",
    label: "Win",
    shortLabel: "Win",
    hint: "Single-runner edge for the cleanest straight bet.",
  },
  {
    value: "place",
    label: "Place",
    shortLabel: "Place",
    hint: "Safer runners that should finish in the money.",
  },
  {
    value: "exacta",
    label: "Exacta",
    shortLabel: "Exacta",
    hint: "Ordered first-second combinations with a clear pair.",
  },
  {
    value: "trifecta",
    label: "Trifecta",
    shortLabel: "Trifecta",
    hint: "Ordered top-three combinations when the race shape is clear.",
  },
  {
    value: "pick3",
    label: "Pick 3",
    shortLabel: "Pick 3",
    hint: "Three-leg sequences across today's best-linked races.",
  },
];

function renderMessage(text: string) {
  const lines = text.split("\n");
  return lines.map((line, index) => {
    const bold = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const isHeading = /^###?\s/.test(line);
    const isBullet = /^[-*]\s/.test(line);
    const isNumbered = /^\d+\.\s/.test(line);
    const clean = bold.replace(/^#{1,3}\s/, "").replace(/^[-*]\s/, "").replace(/^\d+\.\s/, "");

    if (isHeading) {
      return (
        <p
          key={index}
          className="mb-0.5 mt-2 font-semibold text-foreground"
          dangerouslySetInnerHTML={{ __html: clean }}
        />
      );
    }

    if (isBullet || isNumbered) {
      return (
        <div key={index} className="ml-1 flex gap-1.5">
          <span className="mt-0.5 shrink-0 text-primary">
            {isNumbered ? `${line.match(/^\d+/)?.[0]}.` : "-"}
          </span>
          <p dangerouslySetInnerHTML={{ __html: clean }} />
        </div>
      );
    }

    if (line.trim() === "") {
      return <div key={index} className="h-2" />;
    }

    return <p key={index} dangerouslySetInnerHTML={{ __html: bold }} />;
  });
}

function formatRacePrompt(race: { raceNumber: number; name: string; venue: string }) {
  return `Race ${race.raceNumber} ${race.name} at ${race.venue}`;
}

function buildSuggestions(args: {
  betType: BetType;
  bestBetRace?: {
    topPrediction?: { horseName: string } | null;
  };
  nextUpRace?: {
    raceNumber: number;
    name: string;
    venue: string;
  };
  focusRace?: {
    raceNumber: number;
    name: string;
    venue: string;
    topPrediction?: { horseName: string } | null;
  };
  todayRaceCount: number;
  weeklySpotlight?: string | null;
  recentModelResult?: { topPickCorrect: boolean; raceName: string } | null;
}) {
  const {
    betType,
    bestBetRace,
    nextUpRace,
    focusRace,
    todayRaceCount,
    weeklySpotlight,
    recentModelResult,
  } = args;

  const shared = [
    "Analyze today's live races now",
    "Sync the live card now",
    "Increase weight on odds movement",
  ];

  if (betType === "win") {
    return [
      bestBetRace?.topPrediction ? `What is the best win bet today and why is ${bestBetRace.topPrediction.horseName} on top?` : null,
      nextUpRace ? `Give me the cleanest win angle in ${formatRacePrompt(nextUpRace)}` : null,
      focusRace?.topPrediction ? `Can ${focusRace.topPrediction.horseName} win ${formatRacePrompt(focusRace)} cleanly?` : null,
      todayRaceCount > 0 ? `Which race has the clearest straight win edge from today's ${todayRaceCount} races?` : null,
      ...shared,
    ];
  }

  if (betType === "place") {
    return [
      focusRace ? `Which runner is safest for a place in ${formatRacePrompt(focusRace)}?` : null,
      todayRaceCount > 0 ? `Which horse is the strongest place bet on today's card?` : null,
      recentModelResult ? `Did the latest ${recentModelResult.topPickCorrect ? "hit" : "miss"} change which runners you trust for place bets?` : null,
      "Show me the safest each-way angle today",
      ...shared,
    ];
  }

  if (betType === "exacta") {
    return [
      focusRace ? `Build the best exacta for ${formatRacePrompt(focusRace)}` : null,
      nextUpRace ? `What is the strongest exacta in ${formatRacePrompt(nextUpRace)}?` : null,
      "Which race has the clearest top-two exacta shape today?",
      weeklySpotlight ? `Would you rather play exacta structure on ${weeklySpotlight} or today's live card?` : null,
      ...shared,
    ];
  }

  if (betType === "trifecta") {
    return [
      focusRace ? `Build the best trifecta for ${formatRacePrompt(focusRace)}` : null,
      "Which race has the clearest ordered top three for a trifecta today?",
      "Should the trifecta be boxed or kept in order?",
      recentModelResult ? `What did the latest ${recentModelResult.topPickCorrect ? "result" : "miss"} teach the model about top-three structure?` : null,
      ...shared,
    ];
  }

  return [
    "Build the strongest Pick 3 sequence on today's card",
    nextUpRace ? `Start a Pick 3 from ${formatRacePrompt(nextUpRace)}` : null,
    "Which three races link best for a Pick 3 today?",
    weeklySpotlight ? `Is there a stronger Pick 3 path later this week around ${weeklySpotlight}?` : null,
    ...shared,
  ];
}

export default function Chat() {
  const queryClient = useQueryClient();
  const { data: history, isLoading } = useGetChatHistory();
  const { data: races } = useGetRaces();
  const { data: summary } = useGetDashboardSummary();
  const sendMessage = useSendChatMessage();

  const [input, setInput] = useState("");
  const [selectedRaceId, setSelectedRaceId] = useState<number | undefined>();
  const [selectedBetType, setSelectedBetType] = useState<BetType>("win");
  const [optimisticMessages, setOptimisticMessages] = useState<Array<{ role: string; content: string; id: number }>>([]);
  const [lastWeightsUpdate, setLastWeightsUpdate] = useState<WeightsUpdate | null>(null);
  const [lastActionResults, setLastActionResults] = useState<ActionResult[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const allMessages = [...(history ?? []), ...optimisticMessages];
  const usableRaces = [
    ...sortLiveRaceCards((races ?? []).filter((race) => isLiveRaceCard(race))),
    ...sortHistoryRaceCards(
      (races ?? []).filter((race) => isHistoryRaceCard(race) && (race.horseCount > 0 || !!race.topPrediction || !!race.result)),
    ),
  ];
  const summaryTodayCards = summary?.todayCards ?? [];
  const todayRaces = summaryTodayCards.length > 0
    ? summaryTodayCards
    : usableRaces.filter((race) => race.status === "upcoming" || race.status === "analyzing");
  const weeklyOverview = summary?.weeklyOverview ?? [];
  const performance = summary?.performance;
  const focusRace = usableRaces.find((race) => race.id === selectedRaceId)
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
  const recentModelResult = performance?.recentResults?.[0] ?? null;
  const selectedBetMeta = BET_TYPE_OPTIONS.find((option) => option.value === selectedBetType) ?? BET_TYPE_OPTIONS[0];
  const dynamicSuggestions = buildSuggestions({
    betType: selectedBetType,
    bestBetRace,
    nextUpRace,
    focusRace,
    todayRaceCount: todayRaces.length,
    weeklySpotlight: weeklyOverview[0]?.spotlightRaceName ?? null,
    recentModelResult,
  }).filter((value): value is string => Boolean(value));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [allMessages.length, sendMessage.isPending]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || sendMessage.isPending) return;

    setInput("");
    const tempId = Date.now();
    setOptimisticMessages((prev) => [...prev, { role: "user", content: message, id: tempId }]);

    try {
      const result = await sendMessage.mutateAsync({
        data: { message, raceId: selectedRaceId, betType: selectedBetType },
      }) as ChatMutationResult;

      if (result.selectedBetType) {
        setSelectedBetType(result.selectedBetType);
      }

      if (result.updatedWeights) {
        setLastWeightsUpdate(result.updatedWeights);
        await queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getGetWeightsQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      }

      if (result.actionResults?.length) {
        setLastActionResults(result.actionResults);
      }

      if (result.updatedWeights || result.actionResults?.some((action) => action.status === "executed")) {
        await queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getGetWeightsQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      }

      await queryClient.invalidateQueries({ queryKey: getGetChatHistoryQueryKey() });
      setOptimisticMessages([]);
    } catch {
      setOptimisticMessages((prev) => prev.filter((messageItem) => messageItem.id !== tempId));
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-5xl flex-col md:h-screen">
      <div className="border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-5 text-primary" />
            <h1 className="font-semibold text-foreground">AI Chat</h1>
            {todayRaces.length > 0 && (
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                {todayRaces.length} races loaded
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-muted-foreground sm:block">Focus:</span>
            <select
              value={selectedRaceId ?? ""}
              onChange={(event) => setSelectedRaceId(event.target.value ? Number(event.target.value) : undefined)}
              className="max-w-[260px] rounded-lg border border-border bg-card px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All races</option>
              {usableRaces.map((race) => (
                <option key={race.id} value={race.id}>
                  {`R${race.raceNumber} ${race.venue} ${race.raceTime} - ${race.name}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {BET_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                onClick={() => setSelectedBetType(option.value)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  selectedBetType === option.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {option.shortLabel}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Active bet lens: <span className="font-medium text-foreground">{selectedBetMeta.label}</span> - {selectedBetMeta.hint}
          </p>
        </div>
      </div>

      {lastWeightsUpdate && (
        <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/10 px-4 py-2.5">
          <Settings2 className="size-4 shrink-0 text-accent" />
          <p className="flex-1 text-xs text-accent">
            <strong>Weights updated:</strong> Course {(lastWeightsUpdate.courseForm * 100).toFixed(0)}% - Form {(lastWeightsUpdate.formDistance * 100).toFixed(0)}% - J/T {(lastWeightsUpdate.jockeyTrainer * 100).toFixed(0)}% - Odds {(lastWeightsUpdate.oddsMovement * 100).toFixed(0)}% - Hist {(lastWeightsUpdate.history * 100).toFixed(0)}% - Field {(lastWeightsUpdate.fieldStrength * 100).toFixed(0)}% - Weight {(lastWeightsUpdate.weightCarried * 100).toFixed(0)}% - Surface {(lastWeightsUpdate.surfaceFit * 100).toFixed(0)}% - Pace {(lastWeightsUpdate.paceProfile * 100).toFixed(0)}% - Value {(lastWeightsUpdate.priceValue * 100).toFixed(0)}%
          </p>
          <button
            onClick={() => setLastWeightsUpdate(null)}
            className="text-base leading-none text-muted-foreground hover:text-foreground"
          >
            x
          </button>
        </div>
      )}

      {lastActionResults.length > 0 && (
        <div className="mx-6 mt-3 rounded-lg border border-card-border bg-card px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">App actions</p>
              {lastActionResults.map((action, index) => (
                <p
                  key={`${action.type}-${index}`}
                  className={cn(
                    "text-xs",
                    action.status === "executed"
                      ? "text-emerald-300"
                      : action.status === "failed"
                        ? "text-rose-300"
                        : "text-muted-foreground",
                  )}
                >
                  <strong>{action.label}:</strong> {action.detail}
                </p>
              ))}
            </div>
            <button
              onClick={() => setLastActionResults([])}
              className="text-base leading-none text-muted-foreground hover:text-foreground"
            >
              x
            </button>
          </div>
        </div>
      )}

      {focusRace && (
        <div className="mx-6 mt-3 flex items-start justify-between gap-3 rounded-xl border border-primary/20 bg-primary/8 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Focused race</p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              Race {focusRace.raceNumber} {focusRace.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {focusRace.venue} - {focusRace.raceTime}
            </p>
            <p className="mt-2 text-xs text-foreground">
              {focusRace.topPrediction
                ? `${focusRace.topPrediction.horseName} is the current lead for the ${selectedBetMeta.label.toLowerCase()} lens.`
                : "Forecast still building for this race."}
            </p>
          </div>
          <button
            onClick={() => setSelectedRaceId(undefined)}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="pt-8 text-center text-sm text-muted-foreground">Loading chat history...</div>
        ) : allMessages.length === 0 ? (
          <div className="space-y-5 pt-10 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/15">
              <Bot className="size-8 text-primary" />
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">AAA Bets AI Analyst</p>
              <p className="mx-auto mt-2 max-w-2xl text-base leading-7 text-muted-foreground">
                Clean chat mode is active. Pick the bet type you want, keep the race focus narrow when needed, and ask for the strongest angle, a combo ticket, or a full refresh.
              </p>
            </div>
            <div className="mx-auto flex max-w-2xl flex-wrap justify-center gap-2">
              {dynamicSuggestions.slice(0, 5).map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          allMessages.map((messageItem, index) => (
            <div
              key={(messageItem as { id?: number }).id ?? `opt-${index}`}
              className={cn("flex gap-3", messageItem.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              <div
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                  messageItem.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {messageItem.role === "user" ? (
                  <User className="size-4" />
                ) : (
                  <Bot className="size-4 text-primary" />
                )}
              </div>
              <div
                className={cn(
                  "max-w-[90%] space-y-1 rounded-2xl px-5 py-4 text-[15px] leading-7 md:max-w-[78%]",
                  messageItem.role === "user"
                    ? "rounded-tr-sm bg-primary text-primary-foreground"
                    : "rounded-tl-sm border border-card-border bg-card text-foreground",
                )}
              >
                {messageItem.role === "assistant" ? renderMessage(messageItem.content) : messageItem.content}
              </div>
            </div>
          ))
        )}

        {sendMessage.isPending && (
          <div className="flex gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-muted">
              <Bot className="size-4 text-primary" />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-card-border bg-card px-4 py-3">
              <div className="flex h-4 items-center gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: "0ms" }} />
                <span className="size-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: "150ms" }} />
                <span className="size-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="px-6 pb-2">
        <div className="flex flex-wrap gap-2">
          {dynamicSuggestions.slice(0, allMessages.length > 0 ? 3 : 4).map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setInput(suggestion)}
              className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-t border-border px-6 py-4">
        <div className="flex items-end gap-3 rounded-xl border border-card-border bg-card p-4">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              focusRace
                ? `Ask for a ${selectedBetMeta.label.toLowerCase()} read on ${focusRace.name}, refresh forecasts, or compare the field...`
                : todayRaces.length > 0
                  ? `Ask for a ${selectedBetMeta.label.toLowerCase()} angle across today's ${todayRaces.length} live races, sync, forecasts, or weights...`
                  : `Ask for a ${selectedBetMeta.label.toLowerCase()} angle, results history, sync, or weight changes...`
            }
            rows={1}
            className="min-h-[24px] max-h-[120px] flex-1 resize-none bg-transparent text-[15px] leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none"
            style={{ height: "auto" }}
            onInput={(event) => {
              const target = event.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${Math.min(target.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sendMessage.isPending}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sendMessage.isPending ? <Zap className="size-4 animate-pulse" /> : <Send className="size-4" />}
          </button>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {focusRace ? `Focused on Race ${focusRace.raceNumber} - ` : ""}Enter to send - Shift+Enter for new line
          </p>
          <Link href="/weights">
            <span className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
              <TrendingUp className="size-3" /> Set or adjust weights
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
