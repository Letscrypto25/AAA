import { useMemo, useState } from "react";
import {
  getGetDashboardSummaryQueryKey,
  getGetRacesQueryKey,
  useAnalyzeRace,
  useGetDashboardSummary,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle,
  Clock,
  Download,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatConfidenceBand, formatMinutesToRace } from "@/lib/forecast";

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function SyncBar() {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<{ racesCreated?: number; meetingsFound?: number; status?: string } | null>(null);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as { racesCreated?: number; meetingsFound?: number; status?: string };
      setLastResult(data);
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setLastResult({ status: "error" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold text-foreground">Weekly sync</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {lastResult
            ? lastResult.status === "error"
              ? "Sync failed, check the live feed and try again."
              : `Checked ${lastResult.meetingsFound ?? 0} meeting(s) and loaded ${lastResult.racesCreated ?? 0} new race(s).`
            : "Pull the next 7 days, refresh live cards, and keep forecasts current."}
        </p>
      </div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
        {syncing ? "Syncing..." : "Sync now"}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const analyzeRace = useAnalyzeRace();
  const { data: summary, isLoading } = useGetDashboardSummary();
  const [analyzingToday, setAnalyzingToday] = useState(false);
  const [analyzeTodayResult, setAnalyzeTodayResult] = useState<{ status: "idle" | "success" | "error"; count?: number; failed?: number }>({ status: "idle" });

  const summaryData = summary && typeof summary === "object" ? summary : undefined;
  const todayCards = Array.isArray(summaryData?.todayCards) ? summaryData.todayCards : [];
  const weeklyOverview = Array.isArray(summaryData?.weeklyOverview) ? summaryData.weeklyOverview : [];
  const performance = summaryData?.performance && typeof summaryData.performance === "object" ? summaryData.performance : undefined;
  const analyzableTodayRaces = todayCards.filter((race) => race.horseCount > 0 && race.status !== "completed");

  const nextUpRace = useMemo(
    () =>
      [...todayCards]
        .filter((race) => race.status === "upcoming" || race.status === "analyzing")
        .sort((left, right) => (left.minutesToRace ?? Number.MAX_SAFE_INTEGER) - (right.minutesToRace ?? Number.MAX_SAFE_INTEGER))[0],
    [todayCards],
  );

  const bestBetRace = useMemo(
    () =>
      [...todayCards]
        .filter((race) => race.topPrediction)
        .sort((left, right) => (right.topPrediction?.confidence ?? 0) - (left.topPrediction?.confidence ?? 0))[0],
    [todayCards],
  );

  const handleAnalyzeToday = async () => {
    if (analyzingToday || analyzableTodayRaces.length === 0) return;

    setAnalyzingToday(true);
    let successCount = 0;
    let failedCount = 0;

    for (const race of analyzableTodayRaces) {
      try {
        await analyzeRace.mutateAsync({ raceId: race.id });
        successCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    await queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });

    setAnalyzeTodayResult({
      status: failedCount > 0 ? "error" : "success",
      count: successCount,
      failed: failedCount,
    });
    setAnalyzingToday(false);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">AAA Bets</p>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-foreground">Simple race board</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Live South African cards, clearer forecast picks, and a cleaner weekly view built for quick decisions.
            </p>
          </div>
          <div className="text-sm text-muted-foreground">
            {summaryData?.topPick
              ? `${summaryData.topPick} is the strongest live angle right now.`
              : "Run a sync to load the latest meetings and forecasts."}
          </div>
        </div>
      </div>

      <SyncBar />

      <div className="flex flex-col gap-3 rounded-2xl border border-card-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">Analyze today’s races</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Run the forecast engine across every loaded race on today’s card in one go.
          </p>
          {analyzeTodayResult.status !== "idle" && (
            <p className={cn("mt-2 text-xs font-medium", analyzeTodayResult.status === "success" ? "text-emerald-300" : "text-amber-300")}>
              {analyzeTodayResult.status === "success"
                ? `Analyzed ${analyzeTodayResult.count ?? 0} race(s).`
                : `Analyzed ${analyzeTodayResult.count ?? 0} race(s), ${analyzeTodayResult.failed ?? 0} failed.`}
            </p>
          )}
        </div>
        <button
          onClick={handleAnalyzeToday}
          disabled={analyzingToday || analyzableTodayRaces.length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {analyzeTodayResult.status === "error" && !analyzingToday ? <AlertCircle className="size-4" /> : <Zap className={cn("size-4", analyzingToday && "animate-pulse")} />}
          {analyzingToday ? `Analyzing ${analyzableTodayRaces.length}...` : `Analyze today (${analyzableTodayRaces.length})`}
        </button>
      </div>

      <Link href="/install">
        <div className="cursor-pointer rounded-2xl border border-primary/20 bg-primary/10 p-5 transition-colors hover:bg-primary/15">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">Install AAA</p>
              <h2 className="mt-2 text-xl font-semibold text-foreground">Download it like an app</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Install on desktop, Android, or iPhone home screen with a cleaner standalone layout.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl bg-background/80 px-4 py-2 text-sm font-medium text-foreground">
              <Download className="size-4 text-primary" />
              Open install guide
            </div>
          </div>
        </div>
      </Link>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Today" value={summaryData?.todayRaceCount ?? 0} note="Live races on today’s card" />
        <MetricCard label="This week" value={summaryData?.weekRaceCount ?? 0} note="Races stored in the forecast window" />
        <MetricCard
          label="Hit rate"
          value={performance ? `${Math.round(performance.topPickWinRate * 100)}%` : "-"}
          note="Top-pick win rate from graded results"
        />
        <MetricCard label="Samples" value={performance?.sampleSize ?? 0} note="Completed results feeding the model" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <div className="overflow-hidden rounded-2xl border border-card-border bg-card">
          <div className="flex items-center justify-between border-b border-card-border px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <Clock className="size-4 text-primary" />
                Today’s races
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">The cleanest view of what matters now.</p>
            </div>
            <Link href="/races">
              <span className="cursor-pointer text-xs font-medium text-primary hover:underline">Open all races</span>
            </Link>
          </div>

          {isLoading ? (
            <div className="p-5 text-sm text-muted-foreground">Loading today’s board...</div>
          ) : todayCards.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No current-day races loaded yet.</div>
          ) : (
            <div className="divide-y divide-border">
              {todayCards.slice(0, 6).map((race) => (
                <Link key={race.id} href={`/races/${race.id}`}>
                  <div className="cursor-pointer px-5 py-4 transition-colors hover:bg-muted/30">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            Race {race.raceNumber}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{race.dayLabel}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                            {formatConfidenceBand(race.forecastBand)}
                          </span>
                        </div>
                        <p className="mt-2 truncate text-base font-semibold text-foreground">{race.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {race.venue} · {race.raceTime} · {race.distance}m · {formatMinutesToRace(race.minutesToRace)}
                        </p>
                      </div>

                      <div className="shrink-0 text-left md:text-right">
                        {race.result ? (
                          <>
                            <p className="text-sm font-semibold text-foreground">Winner: {race.result.winnerHorseName}</p>
                            <p
                              className={cn(
                                "mt-1 text-xs font-medium",
                                race.result.topPickCorrect ? "text-emerald-300" : "text-rose-300",
                              )}
                            >
                              {race.result.topPickCorrect ? "Top pick hit" : "Top pick missed"}
                            </p>
                          </>
                        ) : race.topPrediction ? (
                          <>
                            <p className="text-sm font-semibold text-primary">{race.topPrediction.horseName}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {Math.round(race.topPrediction.confidence * 100)}% confidence
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">Forecast pending</p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-card-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Sparkles className="size-4 text-primary" />
              Best bet now
            </h2>
            {bestBetRace?.topPrediction ? (
              <div className="mt-4 space-y-2">
                <p className="text-lg font-semibold text-foreground">{bestBetRace.topPrediction.horseName}</p>
                <p className="text-sm text-muted-foreground">
                  Race {bestBetRace.raceNumber} {bestBetRace.name}
                </p>
                <p className="text-sm text-primary">
                  {Math.round(bestBetRace.topPrediction.confidence * 100)}% confidence · {formatConfidenceBand(bestBetRace.forecastBand)}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No standout top pick yet.</p>
            )}
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <Target className="size-4 text-primary" />
              Next up
            </h2>
            {nextUpRace ? (
              <div className="mt-4 space-y-2">
                <p className="text-lg font-semibold text-foreground">Race {nextUpRace.raceNumber} {nextUpRace.name}</p>
                <p className="text-sm text-muted-foreground">{nextUpRace.venue} · {nextUpRace.raceTime}</p>
                <p className="text-sm text-foreground">{formatMinutesToRace(nextUpRace.minutesToRace)}</p>
                <p className="text-xs text-muted-foreground">
                  {nextUpRace.topPrediction ? `${nextUpRace.topPrediction.horseName} currently leads.` : "Forecast still building."}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">No upcoming race loaded.</p>
            )}
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-5">
            <h2 className="flex items-center gap-2 font-semibold text-foreground">
              <CheckCircle className="size-4 text-primary" />
              Model form
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Win rate</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {performance ? `${Math.round(performance.topPickWinRate * 100)}%` : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Placed</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {performance ? `${Math.round(performance.placedRate * 100)}%` : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg confidence</p>
                <p className="mt-1 text-xl font-semibold text-foreground">
                  {performance ? `${Math.round(performance.averageConfidence * 100)}%` : "-"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-2xl border border-card-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <CalendarDays className="size-4 text-primary" />
            This week
          </h2>
          {weeklyOverview.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Sync races to see the week ahead.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {weeklyOverview.map((day) => (
                <div key={day.date} className="rounded-xl border border-border bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{day.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{day.raceCount} races · {day.venues.join(", ")}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{day.analyzedCount} forecasted</p>
                      <p>{day.completedCount} completed</p>
                    </div>
                  </div>
                  {day.spotlightRaceName && (
                    <p className="mt-2 text-sm text-foreground">
                      {day.spotlightRaceName}
                      {day.spotlightHorseName ? ` · ${day.spotlightHorseName}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-card-border bg-card p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Trophy className="size-4 text-primary" />
            Recent graded results
          </h2>
          {performance?.recentResults?.length ? (
            <div className="mt-4 space-y-3">
              {performance.recentResults.slice(0, 4).map((result) => (
                <div key={`${result.raceId}-${result.winnerHorseName}`} className="rounded-xl border border-border bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{result.raceName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result.topPickHorseName ?? "No top pick"}{" → "}{result.winnerHorseName}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        result.topPickCorrect ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300",
                      )}
                    >
                      {result.topPickCorrect ? "Hit" : "Miss"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Results will appear here once races are graded back into the model.</p>
          )}
        </div>
      </div>
    </div>
  );
}
