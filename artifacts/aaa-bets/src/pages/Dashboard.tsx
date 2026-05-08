import { useState } from "react";
import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  AlertCircle,
  BarChart2,
  CalendarDays,
  CheckCircle,
  ChevronRight,
  Clock,
  RefreshCw,
  Target,
  Trophy,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatConfidenceBand, formatMinutesToRace } from "@/lib/forecast";

function StatCard({
  icon: Icon,
  label,
  value,
  color = "primary",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number | undefined;
  color?: "primary" | "green" | "blue" | "amber";
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex items-center gap-4">
      <div
        className={cn(
          "size-11 rounded-lg flex items-center justify-center shrink-0",
          color === "primary" && "bg-primary/15 text-primary",
          color === "green" && "bg-accent/15 text-accent",
          color === "blue" && "bg-blue-500/15 text-blue-300",
          color === "amber" && "bg-amber-500/15 text-amber-300",
        )}
      >
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5">{value ?? "-"}</p>
      </div>
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
    <div className="flex items-center justify-between bg-card border border-card-border rounded-xl px-5 py-3.5 gap-4">
      <div className="flex items-center gap-3">
        {lastResult?.status === "error" ? (
          <AlertCircle className="size-4 text-destructive" />
        ) : (
          <CheckCircle className="size-4 text-accent" />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">Weekly Race Sync</p>
          <p className="text-xs text-muted-foreground">
            {lastResult
              ? lastResult.status === "error"
                ? "Sync failed - check the upstream feed"
                : `Checked ${lastResult.meetingsFound ?? 0} meeting(s) and loaded ${lastResult.racesCreated ?? 0} new races`
              : "Sync pulls the next 7 days, stores forecasts, and refreshes live cards over time"}
          </p>
        </div>
      </div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
      >
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
        {syncing ? "Syncing..." : "Sync Now"}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();

  const todayCards = summary?.todayCards ?? [];
  const weeklyOverview = summary?.weeklyOverview ?? [];
  const performance = summary?.performance;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="size-6 text-primary" />
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Persisted forecasts, weekly outlook, and graded learning for South African racing
        </p>
      </div>

      <SyncBar />

      <div className="grid lg:grid-cols-[1.45fr_1fr] gap-4">
        <div className="bg-primary/10 border border-primary/25 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-primary font-semibold uppercase tracking-[0.18em]">Today Spotlight</p>
              <h2 className="text-2xl font-bold text-foreground mt-2">
                {summary?.todayRaceCount ?? 0} current-day races
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                {summary?.topPick
                  ? `${summary.topPick} leads the board in ${summary.topPickRace}. Forecast confidence tightens as race time approaches.`
                  : "Sync the next 7 days to build today cards and forecast confidence."}
              </p>
            </div>
            <div className="size-14 rounded-2xl bg-primary/15 flex items-center justify-center shrink-0">
              <Target className="size-7 text-primary" />
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mt-5">
            <div className="bg-background/60 border border-white/10 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Today</p>
              <p className="text-2xl font-bold text-foreground mt-1">{summary?.todayRaceCount ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Live card prominence</p>
            </div>
            <div className="bg-background/60 border border-white/10 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">This Week</p>
              <p className="text-2xl font-bold text-foreground mt-1">{summary?.weekRaceCount ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Forecasted races</p>
            </div>
            <div className="bg-background/60 border border-white/10 rounded-xl p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Model Hit Rate</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {performance ? `${Math.round(performance.topPickWinRate * 100)}%` : "-"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Top-pick wins</p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <BarChart2 className="size-4 text-primary" />
              Model Learning
            </h2>
            {performance?.strongestEdge && (
              <span className="text-xs px-2 py-1 rounded-full bg-accent/10 text-accent">
                {performance.strongestEdge}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Win Rate</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {performance ? `${Math.round(performance.topPickWinRate * 100)}%` : "-"}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Placed</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {performance ? `${Math.round(performance.placedRate * 100)}%` : "-"}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg Confidence</p>
              <p className="text-xl font-bold text-foreground mt-1">
                {performance ? `${Math.round(performance.averageConfidence * 100)}%` : "-"}
              </p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Samples</p>
              <p className="text-xl font-bold text-foreground mt-1">{performance?.sampleSize ?? 0}</p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {performance?.recentResults?.length ? (
              performance.recentResults.slice(0, 3).map((result) => (
                <div key={`${result.raceId}-${result.winnerHorseName}`} className="rounded-xl border border-border bg-background/70 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">{result.raceName}</p>
                    <span
                      className={cn(
                        "text-[11px] px-2 py-0.5 rounded-full font-medium",
                        result.topPickCorrect ? "bg-accent/15 text-accent" : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {result.topPickCorrect ? "Hit" : "Miss"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.topPickHorseName ?? "No top pick"}{" → "}{result.winnerHorseName}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-border bg-background/70 px-3 py-4 text-sm text-muted-foreground">
                Results will start feeding the learning loop once race outcomes are recorded.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Trophy} label="Total Races" value={summary?.totalRaces} color="primary" />
        <StatCard icon={Zap} label="Forecasted" value={summary?.analyzedRaces} color="green" />
        <StatCard icon={Clock} label="Upcoming" value={summary?.upcomingRaces} color="blue" />
        <StatCard icon={Users} label="Completed" value={summary?.completedRaces} color="amber" />
      </div>

      <div className="grid xl:grid-cols-[1.3fr_1fr] gap-4">
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
            <h2 className="font-semibold text-foreground">Today&apos;s Races</h2>
            <Link href="/races">
              <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                All races <ChevronRight className="size-3" />
              </span>
            </Link>
          </div>
          {isLoading ? (
            <div className="p-5 text-center text-muted-foreground text-sm">Loading...</div>
          ) : todayCards.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm space-y-2">
              <p>No current-day races loaded yet.</p>
              <p className="text-xs">Use Sync Now to import the next 7 days and build the live card.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {todayCards.map((race) => (
                <Link key={race.id} href={`/races/${race.id}`}>
                  <div className="px-5 py-4 hover:bg-muted/40 cursor-pointer transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                            Race {race.raceNumber}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                            {formatConfidenceBand(race.forecastBand)}
                          </span>
                        </div>
                        <p className="font-semibold text-foreground mt-2 truncate">{race.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {race.venue} · {race.raceTime} · {race.distance}m · {formatMinutesToRace(race.minutesToRace)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {race.topPrediction ? (
                          <>
                            <p className="text-sm font-semibold text-primary">{race.topPrediction.horseName}</p>
                            <p className="text-xs text-muted-foreground">
                              {Math.round(race.topPrediction.confidence * 100)}% confidence
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">Forecast pending</p>
                        )}
                      </div>
                    </div>
                    {race.result && (
                      <div className="mt-3 flex items-center gap-2 text-xs">
                        <span
                          className={cn(
                            "px-2 py-0.5 rounded-full font-medium",
                            race.result.topPickCorrect ? "bg-accent/15 text-accent" : "bg-destructive/15 text-destructive",
                          )}
                        >
                          {race.result.topPickCorrect ? "Top pick hit" : "Top pick missed"}
                        </span>
                        <span className="text-muted-foreground">Winner: {race.result.winnerHorseName}</span>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" />
              Weekly Outlook
            </h2>
          </div>
          {weeklyOverview.length === 0 ? (
            <div className="p-5 text-center text-muted-foreground text-sm">Sync races to see the week map.</div>
          ) : (
            <div className="divide-y divide-border">
              {weeklyOverview.map((day) => (
                <div key={day.date} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{day.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {day.raceCount} races · {day.venues.join(", ")}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{day.analyzedCount} forecasted</p>
                      <p>{day.completedCount} completed</p>
                    </div>
                  </div>
                  {day.spotlightRaceName && (
                    <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2.5">
                      <p className="text-sm font-medium text-foreground">{day.spotlightRaceName}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {day.spotlightHorseName ?? "Forecast pending"}
                        {day.spotlightConfidence != null && ` · ${Math.round(day.spotlightConfidence * 100)}% confidence`}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl p-5">
        <h2 className="font-semibold text-foreground mb-3">Quick Links</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/races", label: "All Races", icon: Trophy },
            { href: "/form-guide", label: "Form Guide", icon: BarChart2 },
            { href: "/chat", label: "AI Chat", icon: Zap },
            { href: "/weights", label: "Adjust Weights", icon: Users },
          ].map((item) => (
            <Link key={item.href} href={item.href}>
              <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted hover:bg-accent/10 hover:text-accent transition-colors cursor-pointer text-center">
                <item.icon className="size-5" />
                <span className="text-xs font-medium">{item.label}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
