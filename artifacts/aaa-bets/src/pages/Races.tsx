import { useMemo, useState } from "react";
import { useCreateRace, useGetRaces } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  CalendarDays,
  ChevronRight,
  Clock,
  Plus,
  Search,
  Target,
  Trophy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  formatConfidenceBand,
  formatMinutesToRace,
  getOutcomeTone,
} from "@/lib/forecast";

const VENUES = [
  "Kenilworth",
  "Turffontein",
  "Greyville",
  "Borrowdale",
  "Scottsville",
  "Flamingo Park",
  "Fairview",
  "Vaal",
  "Hollywoodbets Greyville",
] as const;

const SURFACES = ["turf", "polytrack", "dirt"] as const;
const FILTERS = ["all", "today", "week", "upcoming", "completed"] as const;

type RaceFilter = (typeof FILTERS)[number];
type BaseRace = Record<string, any>;
type AddRaceForm = {
  raceNumber: number;
  name: string;
  venue: (typeof VENUES)[number];
  distance: number;
  raceTime: string;
  meetingDate: string;
  surface: (typeof SURFACES)[number];
  grade: string;
  prize: string;
};
type RacePredictionSummary = {
  id: number;
  horseId: number;
  horseName: string;
  rank: number;
  confidence: number;
  resultStatus: string;
};
type RaceResultSummary = {
  winnerHorseName: string;
  recordedAt: string;
  topPickCorrect: boolean | null;
};
type RaceCard = BaseRace & {
  isToday: boolean;
  isThisWeek: boolean;
  dayLabel: string;
  minutesToRace: number | null;
  prominence: number;
  forecastBand: string;
  topPrediction: RacePredictionSummary | null;
  topPredictions: RacePredictionSummary[];
  result: RaceResultSummary | null;
};

function AddRaceModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const createRace = useCreateRace();
  const [form, setForm] = useState<AddRaceForm>({
    raceNumber: 1,
    name: "",
    venue: VENUES[0],
    distance: 1200,
    raceTime: "13:00",
    meetingDate: new Date().toISOString().slice(0, 10),
    surface: SURFACES[0],
    grade: "",
    prize: "",
  });

  const inputClassName =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  const field = (label: string, children: React.ReactNode) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
    </div>
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createRace.mutateAsync({
        data: {
          raceNumber: form.raceNumber,
          name: form.name,
          venue: form.venue,
          distance: form.distance,
          raceTime: form.raceTime,
          meetingDate: form.meetingDate || undefined,
          surface: form.surface,
          grade: form.grade || undefined,
          prize: form.prize || undefined,
        } as never,
      });
      toast({
        title: "Race added",
        description: `${form.name} at ${form.venue}`,
      });
      onClose();
    } catch {
      toast({
        title: "Error",
        description: "Failed to add race",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-card-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <h2 className="font-semibold text-foreground">Add Race</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-muted-foreground hover:text-foreground"
          >
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "Race #",
              <input
                type="number"
                min={1}
                max={20}
                value={form.raceNumber}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    raceNumber: Number(event.target.value),
                  }))
                }
                className={inputClassName}
                required
              />,
            )}
            {field(
              "Race Name",
              <input
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="e.g. Merchants Mile"
                className={inputClassName}
                required
              />,
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "Meeting Date",
              <input
                type="date"
                value={form.meetingDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    meetingDate: event.target.value,
                  }))
                }
                className={inputClassName}
              />,
            )}
            {field(
              "Race Time",
              <input
                type="time"
                value={form.raceTime}
                onChange={(event) =>
                  setForm((current) => ({ ...current, raceTime: event.target.value }))
                }
                className={inputClassName}
                required
              />,
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "Venue",
              <select
                value={form.venue}
                onChange={(event) =>
                  setForm((current) => ({ ...current, venue: event.target.value as AddRaceForm["venue"] }))
                }
                className={inputClassName}
              >
                {VENUES.map((venue) => (
                  <option key={venue} value={venue}>
                    {venue}
                  </option>
                ))}
              </select>,
            )}
            {field(
              "Surface",
              <select
                value={form.surface}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    surface: event.target.value as (typeof SURFACES)[number],
                  }))
                }
                className={inputClassName}
              >
                {SURFACES.map((surface) => (
                  <option key={surface} value={surface}>
                    {surface}
                  </option>
                ))}
              </select>,
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "Distance (m)",
              <input
                type="number"
                min={800}
                max={4000}
                step={100}
                value={form.distance}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    distance: Number(event.target.value),
                  }))
                }
                className={inputClassName}
                required
              />,
            )}
            {field(
              "Grade",
              <input
                type="text"
                value={form.grade}
                onChange={(event) =>
                  setForm((current) => ({ ...current, grade: event.target.value }))
                }
                placeholder="e.g. G1, Open"
                className={inputClassName}
              />,
            )}
          </div>

          {field(
            "Prize",
            <input
              type="text"
              value={form.prize}
              onChange={(event) =>
                setForm((current) => ({ ...current, prize: event.target.value }))
              }
              placeholder="e.g. R200,000"
              className={inputClassName}
            />,
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createRace.isPending}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {createRace.isPending ? "Adding..." : "Add Race"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Races() {
  const { data: raceResponse, isLoading } = useGetRaces();
  const races = (raceResponse ?? []) as RaceCard[];
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<RaceFilter>("all");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return races
      .filter((race) => {
        if (filter === "today" && !race.isToday) return false;
        if (filter === "week" && !race.isThisWeek) return false;
        if (filter === "upcoming" && !["upcoming", "analyzing"].includes(race.status)) return false;
        if (filter === "completed" && race.status !== "completed") return false;

        if (!term) return true;
        return [
          race.name,
          race.venue,
          race.topPrediction?.horseName ?? "",
          race.dayLabel,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
      })
      .sort((left, right) => {
        const leftMinutes = left.minutesToRace ?? Number.MAX_SAFE_INTEGER;
        const rightMinutes = right.minutesToRace ?? Number.MAX_SAFE_INTEGER;
        return leftMinutes - rightMinutes || right.prominence - left.prominence;
      });
  }, [filter, races, search]);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      {showAdd && <AddRaceModal onClose={() => setShowAdd(false)} />}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Trophy className="size-6 text-primary" />
            Races
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Weekly card view with forecast confidence, timing, and graded results
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="size-4" />
          Add Race
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search races, venues, or top picks..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-lg border border-card-border bg-card py-2.5 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <button
              key={option}
              onClick={() => setFilter(option)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                filter === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "week" ? "This week" : option}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-card-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Loaded</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{races.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Races currently stored in the weekly card</p>
        </div>
        <div className="rounded-2xl border border-card-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today</p>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {races.filter((race) => race.isToday).length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Current-day races with live forecast relevance</p>
        </div>
        <div className="rounded-2xl border border-card-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Completed</p>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {races.filter((race) => race.status === "completed").length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Races already graded back into the model</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-28 animate-pulse rounded-xl border border-card-border bg-card"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center">
          <CalendarDays className="mx-auto mb-3 size-10 text-muted-foreground" />
          <p className="font-medium text-foreground">No races match this view</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {search ? "Try a broader search term." : "Add a race or sync the weekly card to get started."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((race) => (
            <Link key={race.id} href={`/races/${race.id}`}>
              <div className="cursor-pointer rounded-xl border border-card-border bg-card px-5 py-4 transition-colors hover:border-primary/40">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        Race {race.raceNumber}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {race.dayLabel}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {formatConfidenceBand(race.forecastBand)}
                      </span>
                      {race.result && (
                        <span
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-xs font-medium",
                            race.result.topPickCorrect
                              ? "border-emerald-400/30 bg-emerald-500/15 text-emerald-300"
                              : "border-rose-400/30 bg-rose-500/15 text-rose-300",
                          )}
                        >
                          {race.result.topPickCorrect ? "Top pick hit" : "Top pick missed"}
                        </span>
                      )}
                    </div>

                    <p className="mt-2 truncate text-lg font-semibold text-foreground">{race.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {race.raceTime}
                      </span>
                      <span>{race.venue}</span>
                      <span>{race.distance}m {race.surface}</span>
                      <span>{formatMinutesToRace(race.minutesToRace)}</span>
                      {race.grade && <span className="font-medium text-foreground">{race.grade}</span>}
                    </p>

                    {race.topPredictions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {race.topPredictions.map((prediction: RacePredictionSummary) => (
                          <span
                            key={prediction.id}
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-xs",
                              prediction.resultStatus !== "pending"
                                ? getOutcomeTone(prediction.resultStatus)
                                : "border-border bg-muted/60 text-muted-foreground",
                            )}
                          >
                            #{prediction.rank} {prediction.horseName} {Math.round(prediction.confidence * 100)}%
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-3 lg:min-w-[220px] lg:justify-end">
                    <div className="min-w-0 text-left lg:text-right">
                      {race.result ? (
                        <>
                          <p className="text-sm font-semibold text-foreground">
                            Winner: {race.result.winnerHorseName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Recorded {new Date(race.result.recordedAt).toLocaleString()}
                          </p>
                        </>
                      ) : race.topPrediction ? (
                        <>
                          <p className="flex items-center gap-1 text-sm font-semibold text-primary lg:justify-end">
                            <Target className="size-3.5" />
                            {race.topPrediction.horseName}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {Math.round(race.topPrediction.confidence * 100)}% confidence
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">Forecast pending</p>
                      )}
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
