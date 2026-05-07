import { useState } from "react";
import { useGetDashboardSummary, useGetRaces } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Trophy, Clock, Zap, Users, TrendingUp, ChevronRight, BarChart2, RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({
  icon: Icon,
  label,
  value,
  color = "primary",
}: {
  icon: React.ElementType;
  label: string;
  value: string | number | undefined;
  color?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-5 flex items-center gap-4">
      <div className={cn(
        "size-11 rounded-lg flex items-center justify-center shrink-0",
        color === "primary" && "bg-primary/15 text-primary",
        color === "green" && "bg-accent/15 text-accent",
        color === "blue" && "bg-blue-500/15 text-blue-400",
        color === "purple" && "bg-purple-500/15 text-purple-400",
      )}>
        <Icon className="size-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5">{value ?? "—"}</p>
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
      const data = await res.json() as { racesCreated?: number; meetingsFound?: number; status?: string };
      setLastResult(data);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      setLastResult({ status: "error" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center justify-between bg-card border border-card-border rounded-xl px-5 py-3.5">
      <div className="flex items-center gap-3">
        {lastResult?.status === "error" ? (
          <AlertCircle className="size-4 text-destructive" />
        ) : (
          <CheckCircle className="size-4 text-accent" />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">Auto Race Sync</p>
          <p className="text-xs text-muted-foreground">
            {lastResult
              ? lastResult.status === "error"
                ? "Sync failed — check connection"
                : `Found ${lastResult.meetingsFound ?? 0} meeting(s) · ${lastResult.racesCreated ?? 0} new races added`
              : "Races sync automatically every 2 hours from Gold Circle"}
          </p>
        </div>
      </div>
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
        {syncing ? "Syncing..." : "Sync Now"}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: races } = useGetRaces();

  const upcoming = races?.filter((r) => r.status === "upcoming" || r.status === "analyzing") ?? [];
  const analyzed = races?.filter((r) => r.lastAnalyzedAt) ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <TrendingUp className="size-6 text-primary" />
          Dashboard
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          AI-powered horse racing predictions for South Africa
        </p>
      </div>

      <SyncBar />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Trophy} label="Total Races" value={summary?.totalRaces} color="primary" />
        <StatCard icon={BarChart2} label="Analyzed" value={summary?.analyzedRaces} color="green" />
        <StatCard icon={Clock} label="Upcoming" value={summary?.upcomingRaces} color="blue" />
        <StatCard icon={Users} label="Horses" value={summary?.totalHorses} color="purple" />
      </div>

      {summary?.topPick && (
        <div className="bg-primary/10 border border-primary/30 rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-primary font-semibold uppercase tracking-wide">Top AI Pick</p>
            <p className="text-xl font-bold text-foreground mt-1">{summary.topPick}</p>
            {summary.topPickRace && (
              <p className="text-sm text-muted-foreground mt-0.5">{summary.topPickRace}</p>
            )}
          </div>
          <Zap className="size-10 text-primary opacity-60" />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
            <h2 className="font-semibold text-foreground">Upcoming Races</h2>
            <Link href="/races">
              <span className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                All races <ChevronRight className="size-3" />
              </span>
            </Link>
          </div>
          {isLoading ? (
            <div className="p-5 text-center text-muted-foreground text-sm">Loading...</div>
          ) : upcoming.length === 0 ? (
            <div className="p-5 text-center text-muted-foreground text-sm space-y-2">
              <p>No races loaded yet.</p>
              <p className="text-xs">Click <strong>Sync Now</strong> above to load today's race card automatically.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {upcoming.slice(0, 5).map((race) => (
                <Link key={race.id} href={`/races/${race.id}`}>
                  <div className="px-5 py-3.5 hover:bg-muted/40 cursor-pointer transition-colors flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-foreground">{race.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {race.venue} · {race.raceTime} · {race.distance}m
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full font-medium",
                        race.status === "analyzing"
                          ? "bg-accent/15 text-accent"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {race.status === "analyzing" ? "Analyzed" : "Upcoming"}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
            <h2 className="font-semibold text-foreground">Recent Predictions</h2>
          </div>
          {analyzed.length === 0 ? (
            <div className="p-5 text-center text-muted-foreground text-sm">
              No predictions yet. Select a race and click "Analyze" to get started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {analyzed.slice(0, 5).map((race) => (
                <Link key={race.id} href={`/races/${race.id}`}>
                  <div className="px-5 py-3.5 hover:bg-muted/40 cursor-pointer transition-colors flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-foreground">{race.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {race.venue} · {race.distance}m {race.surface}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
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
