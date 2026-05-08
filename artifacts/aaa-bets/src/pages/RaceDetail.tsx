import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetRaceHorsesQueryKey,
  getGetRacePredictionsQueryKey,
  getGetRaceQueryKey,
  getGetRacesQueryKey,
  useAddHorse,
  useAnalyzeRace,
  useGetRace,
  useGetRaceHorses,
  useGetRacePredictions,
  useRecordRaceResult,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Clock,
  Flag,
  Minus,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wifi,
  XCircle,
  Zap,
} from "lucide-react";
import { Link, useParams } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { formatConfidenceBand, formatMinutesToRace, formatOutcomeLabel, getOutcomeTone } from "@/lib/forecast";
import { cn } from "@/lib/utils";

type RaceHorse = {
  id: number;
  name: string;
  number: number;
  jockey: string;
  trainer: string;
  form?: string;
  currentOdds: number;
  oddsMovement: string;
  courseRecord?: boolean;
  distanceRecord?: boolean;
  scratched?: boolean;
  scratchReason?: string | null;
};

function OddsChip({ movement }: { movement: string }) {
  if (movement === "shortening") {
    return <span className="flex items-center gap-1 text-xs font-medium text-accent"><TrendingDown className="size-3" />Shortening</span>;
  }
  if (movement === "drifting") {
    return <span className="flex items-center gap-1 text-xs font-medium text-destructive"><TrendingUp className="size-3" />Drifting</span>;
  }
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><Minus className="size-3" />Stable</span>;
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  );
}

function AddHorseModal({ raceId, onClose }: { raceId: number; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const addHorse = useAddHorse();
  const [form, setForm] = useState({
    name: "",
    number: 1,
    jockey: "",
    trainer: "",
    form: "",
    weight: "",
    currentOdds: "",
    openingOdds: "",
    courseRecord: false,
    distanceRecord: false,
    trainerJockeyRecord: "",
    notes: "",
  });
  const inputClassName = "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const field = (label: string, children: React.ReactNode) => <div className="space-y-1"><label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>{children}</div>;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await addHorse.mutateAsync({
        raceId,
        data: {
          name: form.name,
          number: form.number,
          jockey: form.jockey,
          trainer: form.trainer,
          form: form.form || "",
          weight: form.weight ? Number(form.weight) : undefined,
          currentOdds: Number(form.currentOdds),
          openingOdds: form.openingOdds ? Number(form.openingOdds) : undefined,
          courseRecord: form.courseRecord,
          distanceRecord: form.distanceRecord,
          trainerJockeyRecord: form.trainerJockeyRecord || undefined,
          notes: form.notes || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetRaceHorsesQueryKey(raceId) });
      await queryClient.invalidateQueries({ queryKey: getGetRaceQueryKey(raceId) });
      await queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey() });
      toast({ title: "Horse added", description: form.name });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to add horse", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-4 w-full max-w-lg rounded-xl border border-card-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <h2 className="font-semibold text-foreground">Add Horse</h2>
          <button onClick={onClose} className="text-xl text-muted-foreground hover:text-foreground">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            {field("Number", <input type="number" min={1} max={30} value={form.number} onChange={(event) => setForm((current) => ({ ...current, number: Number(event.target.value) }))} className={inputClassName} required />)}
            {field("Horse Name", <input type="text" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Silvano Spirit" className={inputClassName} required />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("Jockey", <input type="text" value={form.jockey} onChange={(event) => setForm((current) => ({ ...current, jockey: event.target.value }))} className={inputClassName} required />)}
            {field("Trainer", <input type="text" value={form.trainer} onChange={(event) => setForm((current) => ({ ...current, trainer: event.target.value }))} className={inputClassName} required />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("Current Odds", <input type="number" step="0.1" min="1" value={form.currentOdds} onChange={(event) => setForm((current) => ({ ...current, currentOdds: event.target.value }))} className={inputClassName} required />)}
            {field("Opening Odds", <input type="number" step="0.1" min="1" value={form.openingOdds} onChange={(event) => setForm((current) => ({ ...current, openingOdds: event.target.value }))} className={inputClassName} />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("Form", <input type="text" value={form.form} onChange={(event) => setForm((current) => ({ ...current, form: event.target.value }))} className={inputClassName} />)}
            {field("Weight (kg)", <input type="number" step="0.1" value={form.weight} onChange={(event) => setForm((current) => ({ ...current, weight: event.target.value }))} className={inputClassName} />)}
          </div>
          {field("Trainer/Jockey Partnership Record", <input type="text" value={form.trainerJockeyRecord} onChange={(event) => setForm((current) => ({ ...current, trainerJockeyRecord: event.target.value }))} className={inputClassName} />)}
          {field("Notes", <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} className={cn(inputClassName, "resize-none")} rows={2} />)}
          <div className="flex gap-6">
            <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={form.courseRecord} onChange={(event) => setForm((current) => ({ ...current, courseRecord: event.target.checked }))} className="rounded" />Course Record</label>
            <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={form.distanceRecord} onChange={(event) => setForm((current) => ({ ...current, distanceRecord: event.target.checked }))} className="rounded" />Distance Record</label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={addHorse.isPending} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{addHorse.isPending ? "Adding..." : "Add Horse"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RecordResultModal({ raceId, horses, onClose }: { raceId: number; horses: Array<{ id: number; name: string; number: number; scratched?: boolean }>; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const recordRaceResult = useRecordRaceResult();
  const availableHorses = horses.filter((horse) => !horse.scratched).sort((left, right) => left.number - right.number);
  const [winnerHorseId, setWinnerHorseId] = useState<number | undefined>(availableHorses[0]?.id);
  const [runnerUpHorseId, setRunnerUpHorseId] = useState<number | undefined>();
  const [thirdHorseId, setThirdHorseId] = useState<number | undefined>();
  const [notes, setNotes] = useState("");
  const inputClassName = "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!winnerHorseId) {
      toast({ title: "Winner required", description: "Select the winner before saving.", variant: "destructive" });
      return;
    }
    const selections = [winnerHorseId, runnerUpHorseId, thirdHorseId].filter((value): value is number => typeof value === "number");
    if (new Set(selections).size !== selections.length) {
      toast({ title: "Duplicate placing", description: "Placings must be different horses.", variant: "destructive" });
      return;
    }
    try {
      await recordRaceResult.mutateAsync({
        raceId,
        data: {
          winnerHorseId,
          runnerUpHorseId: runnerUpHorseId ?? undefined,
          thirdHorseId: thirdHorseId ?? undefined,
          notes: notes || undefined,
        },
      });
      await queryClient.invalidateQueries({ queryKey: getGetRaceQueryKey(raceId) });
      await queryClient.invalidateQueries({ queryKey: getGetRacePredictionsQueryKey(raceId) });
      await queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({ title: "Result recorded", description: "The race has been graded back into the model." });
      onClose();
    } catch {
      toast({ title: "Result not saved", description: "Unable to record the official result.", variant: "destructive" });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-card-border bg-card shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-card-border px-6 py-4">
          <div>
            <h2 className="font-semibold text-foreground">Record Official Result</h2>
            <p className="mt-1 text-xs text-muted-foreground">Save placings and grade the latest forecast.</p>
          </div>
          <button onClick={onClose} className="text-xl text-muted-foreground hover:text-foreground">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <select value={winnerHorseId ?? ""} onChange={(event) => setWinnerHorseId(event.target.value ? Number(event.target.value) : undefined)} className={inputClassName} required>
            {availableHorses.map((horse) => <option key={`winner-${horse.id}`} value={horse.id}>#{horse.number} {horse.name}</option>)}
          </select>
          <div className="grid gap-4 sm:grid-cols-2">
            <select value={runnerUpHorseId ?? ""} onChange={(event) => setRunnerUpHorseId(event.target.value ? Number(event.target.value) : undefined)} className={inputClassName}>
              <option value="">Runner-up (optional)</option>
              {availableHorses.map((horse) => <option key={`runner-${horse.id}`} value={horse.id}>#{horse.number} {horse.name}</option>)}
            </select>
            <select value={thirdHorseId ?? ""} onChange={(event) => setThirdHorseId(event.target.value ? Number(event.target.value) : undefined)} className={inputClassName}>
              <option value="">Third (optional)</option>
              {availableHorses.map((horse) => <option key={`third-${horse.id}`} value={horse.id}>#{horse.number} {horse.name}</option>)}
            </select>
          </div>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes" className={cn(inputClassName, "resize-none")} rows={3} />
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={recordRaceResult.isPending} className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{recordRaceResult.isPending ? "Saving..." : "Save Result"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RaceDetail() {
  const params = useParams<{ id: string }>();
  const raceId = Number(params.id ?? "0");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddHorse, setShowAddHorse] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const { data: race, isLoading } = useGetRace(raceId);
  const { data: horseResponse } = useGetRaceHorses(raceId);
  const horses = ((horseResponse ?? []) as RaceHorse[]);
  const { data: predictions } = useGetRacePredictions(raceId);
  const analyzeRace = useAnalyzeRace();
  const activeHorses = horses.filter((horse) => !horse.scratched);
  const scratchedHorses = horses.filter((horse) => horse.scratched);
  const sortedPredictions = [...(predictions ?? [])].sort((left, right) => left.rank - right.rank);

  const handleAnalyze = async () => {
    try {
      await analyzeRace.mutateAsync({ raceId });
      await queryClient.invalidateQueries({ queryKey: getGetRaceQueryKey(raceId) });
      await queryClient.invalidateQueries({ queryKey: getGetRacePredictionsQueryKey(raceId) });
      await queryClient.invalidateQueries({ queryKey: getGetRacesQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      toast({ title: "Forecast updated", description: "Predictions have been refreshed for this race." });
    } catch {
      toast({ title: "Analysis failed", description: "Check your GROQ_API_KEY and try again.", variant: "destructive" });
    }
  };

  if (isLoading) {
    return <div className="mx-auto max-w-4xl p-6"><div className="mb-4 h-8 w-48 animate-pulse rounded bg-muted" /><div className="h-40 animate-pulse rounded-xl border border-card-border bg-card" /></div>;
  }

  if (!race) {
    return <div className="p-6 text-center"><p className="text-muted-foreground">Race not found</p><Link href="/races"><span className="mt-2 block cursor-pointer text-sm text-primary hover:underline">Back to races</span></Link></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      {showAddHorse && <AddHorseModal raceId={raceId} onClose={() => setShowAddHorse(false)} />}
      {showResultModal && <RecordResultModal raceId={raceId} horses={horses} onClose={() => setShowResultModal(false)} />}

      <div className="flex items-start gap-3">
        <Link href="/races"><div className="cursor-pointer rounded-lg p-2 hover:bg-muted"><ArrowLeft className="size-4 text-muted-foreground" /></div></Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{race.name}</h1>
            {race.grade && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">{race.grade}</span>}
            {race.syncedFrom === "goldcircle" && <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400"><Wifi className="size-3" />Auto-synced</span>}
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{race.dayLabel}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{formatConfidenceBand(race.forecastBand)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Clock className="size-3" />{race.raceTime}</span>
            <span>{race.venue}</span>
            <span>{race.distance}m {race.surface}</span>
            <span>{formatMinutesToRace(race.minutesToRace)}</span>
            {race.prize && <span className="font-medium text-primary">{race.prize}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!race.result && <button onClick={() => setShowResultModal(true)} disabled={activeHorses.length === 0} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"><Flag className="size-4" />Record Result</button>}
          <button onClick={handleAnalyze} disabled={analyzeRace.isPending || activeHorses.length === 0} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {analyzeRace.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Zap className="size-4" />}
            {analyzeRace.isPending ? "Analyzing..." : "Analyze"}
          </button>
        </div>
      </div>

      {race.result && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Official Result</h2>
              <p className="mt-1 text-xs text-muted-foreground">Recorded {new Date(race.result.recordedAt).toLocaleString()}</p>
            </div>
            {race.result.topPickCorrect !== null && <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", race.result.topPickCorrect ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300")}>{race.result.topPickCorrect ? "Top pick hit" : "Top pick missed"}</span>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Winner</p><p className="mt-1 font-semibold text-foreground">{race.result.winnerHorseName}</p></div>
            <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Runner-up</p><p className="mt-1 font-semibold text-foreground">{race.result.runnerUpHorseName ?? "-"}</p></div>
            <div className="rounded-xl bg-muted/60 p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Third</p><p className="mt-1 font-semibold text-foreground">{race.result.thirdHorseName ?? "-"}</p></div>
          </div>
          {race.result.notes && <div className="mt-3 rounded-xl border border-border bg-background/70 px-3 py-2.5 text-sm text-muted-foreground">{race.result.notes}</div>}
        </div>
      )}

      {sortedPredictions.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-card-border bg-card">
          <div className="border-b border-card-border px-5 py-4">
            <h2 className="font-semibold text-foreground">Forecast Rankings</h2>
            {race.lastAnalyzedAt && <p className="mt-0.5 text-xs text-muted-foreground">Last analyzed {new Date(race.lastAnalyzedAt).toLocaleString()}{race.nextUpdateAt && ` | Next update ${new Date(race.nextUpdateAt).toLocaleTimeString()}`}</p>}
          </div>
          <div className="divide-y divide-border">
            {sortedPredictions.map((prediction, index) => {
              const horse = horses.find((currentHorse) => currentHorse.id === prediction.horseId);
              const factors = prediction.factors as unknown as Record<string, number>;
              const outcomeLabel = formatOutcomeLabel(prediction.resultStatus, prediction.finishPosition);
              return (
                <div key={prediction.id} className={cn("px-5 py-4", index === 0 && "bg-primary/5")}>
                  <div className="flex items-start gap-4">
                    <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold", index === 0 && "bg-primary text-primary-foreground", index === 1 && "bg-muted-foreground/20 text-foreground", index === 2 && "bg-amber-900/30 text-amber-400", index > 2 && "bg-muted text-muted-foreground")}>{index + 1}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-foreground">{prediction.horseName || horse?.name}</p>
                            {index === 0 && <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"><Trophy className="size-3" />Top pick</span>}
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{formatConfidenceBand(prediction.confidenceBand)}</span>
                            {outcomeLabel && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", getOutcomeTone(prediction.resultStatus))}>{outcomeLabel}</span>}
                          </div>
                          {horse && <p className="mt-0.5 text-xs text-muted-foreground">#{horse.number} | {horse.jockey} / {horse.trainer} | Odds {horse.currentOdds}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary">{(prediction.score * 100).toFixed(0)}pts</p>
                          <p className="text-xs text-muted-foreground">{(prediction.confidence * 100).toFixed(0)}% confidence{prediction.confidenceDelta !== 0 && ` | ${prediction.confidenceDelta > 0 ? "+" : ""}${(prediction.confidenceDelta * 100).toFixed(0)} delta`}</p>
                        </div>
                      </div>
                      {prediction.aiSummary && <p className="mt-2 text-sm italic text-muted-foreground">{prediction.aiSummary}</p>}
                      {factors && Object.keys(factors).length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">{Object.entries(factors).filter(([key]) => key !== "overall").map(([key, value]) => <ScoreBar key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())} value={value} />)}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-card-border bg-card">
        <div className="flex items-center justify-between border-b border-card-border px-5 py-4">
          <h2 className="font-semibold text-foreground">Runners ({activeHorses.length}){scratchedHorses.length > 0 && <span className="ml-2 text-destructive">| {scratchedHorses.length} scratched</span>}</h2>
          <button onClick={() => setShowAddHorse(true)} className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-sm font-medium hover:bg-muted/70"><Plus className="size-3.5" />Add Horse</button>
        </div>
        {horses.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted-foreground">No horses added yet.</p>
            <button onClick={() => setShowAddHorse(true)} className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Add First Horse</button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {[...horses].sort((left, right) => left.number - right.number).map((horse) => (
              <div key={horse.id} className={cn("flex items-center gap-4 px-5 py-3.5", horse.scratched && "opacity-50")}>
                <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", horse.scratched ? "bg-destructive/15" : "bg-muted")}>
                  {horse.scratched ? <XCircle className="size-4 text-destructive" /> : <span className="text-xs font-bold text-muted-foreground">#{horse.number}</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={cn("text-sm font-medium", horse.scratched ? "line-through text-muted-foreground" : "text-foreground")}>{horse.name}</p>
                    {horse.scratched && <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs font-medium text-destructive">SCRATCHED</span>}
                    {!horse.scratched && horse.courseRecord && <span className="rounded bg-accent/15 px-1.5 py-0.5 text-xs text-accent">Course</span>}
                    {!horse.scratched && horse.distanceRecord && <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-400">Distance</span>}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{horse.jockey} / {horse.trainer}{horse.form && ` | Form: ${horse.form}`}{horse.scratched && horse.scratchReason && ` | ${horse.scratchReason}`}</p>
                </div>
                {!horse.scratched && <div className="shrink-0 text-right"><p className="text-sm font-semibold text-foreground">{horse.currentOdds}</p><OddsChip movement={horse.oddsMovement} /></div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
