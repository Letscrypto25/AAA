import { useState } from "react";
import { useParams, Link } from "wouter";
import {
  useGetRace,
  useGetRacePredictions,
  useGetRaceHorses,
  useAnalyzeRace,
  useAddHorse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetRaceQueryKey,
  getGetRacePredictionsQueryKey,
  getGetRaceHorsesQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Zap, Plus, Clock, TrendingDown, TrendingUp, Minus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function OddsChip({ movement }: { movement: string }) {
  if (movement === "shortening") return (
    <span className="flex items-center gap-1 text-xs text-accent font-medium">
      <TrendingDown className="size-3" /> Shortening
    </span>
  );
  if (movement === "drifting") return (
    <span className="flex items-center gap-1 text-xs text-destructive font-medium">
      <TrendingUp className="size-3" /> Drifting
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Minus className="size-3" /> Stable
    </span>
  );
}

function ScoreBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{(value * 100).toFixed(0)}%</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${value * 100}%` }}
        />
      </div>
    </div>
  );
}

function AddHorseModal({ raceId, onClose }: { raceId: number; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const addHorse = useAddHorse();
  const [form, setForm] = useState({
    name: "", number: 1, jockey: "", trainer: "",
    form: "", weight: "", currentOdds: "", openingOdds: "",
    courseRecord: false, distanceRecord: false, trainerJockeyRecord: "", notes: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      await qc.invalidateQueries({ queryKey: getGetRaceHorsesQueryKey(raceId) });
      await qc.invalidateQueries({ queryKey: getGetRaceQueryKey(raceId) });
      toast({ title: "Horse added", description: form.name });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to add horse", variant: "destructive" });
    }
  };

  const inp = "w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
  const f = (label: string, children: React.ReactNode) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-lg my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border">
          <h2 className="font-semibold text-foreground">Add Horse</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            {f("Number", <input type="number" min={1} max={30} value={form.number} onChange={(e) => setForm({ ...form, number: Number(e.target.value) })} className={inp} required />)}
            {f("Horse Name", <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Silvano Spirit" className={inp} required />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {f("Jockey", <input type="text" value={form.jockey} onChange={(e) => setForm({ ...form, jockey: e.target.value })} placeholder="e.g. C. Orffer" className={inp} required />)}
            {f("Trainer", <input type="text" value={form.trainer} onChange={(e) => setForm({ ...form, trainer: e.target.value })} placeholder="e.g. M. de Kock" className={inp} required />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {f("Current Odds", <input type="number" step="0.1" min="1" value={form.currentOdds} onChange={(e) => setForm({ ...form, currentOdds: e.target.value })} placeholder="e.g. 3.5" className={inp} required />)}
            {f("Opening Odds", <input type="number" step="0.1" min="1" value={form.openingOdds} onChange={(e) => setForm({ ...form, openingOdds: e.target.value })} placeholder="Optional" className={inp} />)}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {f("Form", <input type="text" value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })} placeholder="e.g. 1-2-1-3" className={inp} />)}
            {f("Weight (kg)", <input type="number" step="0.1" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} placeholder="Optional" className={inp} />)}
          </div>
          {f("Trainer/Jockey Partnership Record", <input type="text" value={form.trainerJockeyRecord} onChange={(e) => setForm({ ...form, trainerJockeyRecord: e.target.value })} placeholder="e.g. 3 wins from 8 runs together" className={inp} />)}
          {f("Notes", <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes..." className={cn(inp, "resize-none")} rows={2} />)}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.courseRecord} onChange={(e) => setForm({ ...form, courseRecord: e.target.checked })} className="rounded" />
              Course Record
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.distanceRecord} onChange={(e) => setForm({ ...form, distanceRecord: e.target.checked })} className="rounded" />
              Distance Record
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={addHorse.isPending} className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50">
              {addHorse.isPending ? "Adding..." : "Add Horse"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RaceDetail() {
  const params = useParams<{ id: string }>();
  const raceId = Number(params.id ?? "0");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAddHorse, setShowAddHorse] = useState(false);

  const { data: race, isLoading } = useGetRace(raceId);
  const { data: horses } = useGetRaceHorses(raceId);
  const { data: predictions } = useGetRacePredictions(raceId);
  const analyzeRace = useAnalyzeRace();

  const handleAnalyze = async () => {
    try {
      await analyzeRace.mutateAsync({ raceId });
      await qc.invalidateQueries({ queryKey: getGetRaceQueryKey(raceId) });
      await qc.invalidateQueries({ queryKey: getGetRacePredictionsQueryKey(raceId) });
      toast({ title: "Analysis complete", description: "Predictions updated by AI" });
    } catch {
      toast({ title: "Analysis failed", description: "Check your GROQ_API_KEY", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="h-8 bg-muted rounded w-48 animate-pulse mb-4" />
        <div className="h-40 bg-card border border-card-border rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!race) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Race not found</p>
        <Link href="/races"><span className="text-primary hover:underline cursor-pointer text-sm mt-2 block">Back to races</span></Link>
      </div>
    );
  }

  const sortedPreds = [...(predictions ?? [])].sort((a, b) => a.rank - b.rank);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {showAddHorse && <AddHorseModal raceId={raceId} onClose={() => setShowAddHorse(false)} />}

      <div className="flex items-center gap-3">
        <Link href="/races">
          <div className="p-2 rounded-lg hover:bg-muted cursor-pointer transition-colors">
            <ArrowLeft className="size-4 text-muted-foreground" />
          </div>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-foreground">{race.name}</h1>
            {race.grade && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">{race.grade}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1"><Clock className="size-3" />{race.raceTime}</span>
            <span>{race.venue}</span>
            <span>{race.distance}m {race.surface}</span>
            {race.prize && <span className="text-primary font-medium">{race.prize}</span>}
          </div>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={analyzeRace.isPending || (horses ?? []).length === 0}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {analyzeRace.isPending ? (
            <RefreshCw className="size-4 animate-spin" />
          ) : (
            <Zap className="size-4" />
          )}
          {analyzeRace.isPending ? "Analyzing..." : "Analyze"}
        </button>
      </div>

      {sortedPreds.length > 0 && (
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-card-border">
            <h2 className="font-semibold text-foreground">AI Predictions</h2>
            {race.lastAnalyzedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Last analyzed {new Date(race.lastAnalyzedAt).toLocaleString()}
                {race.nextUpdateAt && ` · Next update ${new Date(race.nextUpdateAt).toLocaleTimeString()}`}
              </p>
            )}
          </div>
          <div className="divide-y divide-border">
            {sortedPreds.map((pred, i) => {
              const horse = (horses ?? []).find((h) => h.id === pred.horseId);
              const factors = pred.factors as unknown as Record<string, number>;
              return (
                <div key={pred.id} className={cn("px-5 py-4", i === 0 && "bg-primary/5")}>
                  <div className="flex items-start gap-4">
                    <div className={cn(
                      "size-9 rounded-full flex items-center justify-center font-bold text-sm shrink-0",
                      i === 0 && "bg-primary text-primary-foreground",
                      i === 1 && "bg-muted-foreground/20 text-foreground",
                      i === 2 && "bg-amber-900/30 text-amber-400",
                      i > 2 && "bg-muted text-muted-foreground text-xs",
                    )}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${pred.rank}`}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-semibold text-foreground">{pred.horseName || horse?.name}</p>
                          {horse && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              #{horse.number} · {horse.jockey} / {horse.trainer} · {horse.currentOdds}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-primary">{(pred.score * 100).toFixed(0)}pts</p>
                          <p className="text-xs text-muted-foreground">
                            {(pred.confidence * 100).toFixed(0)}% confidence
                          </p>
                        </div>
                      </div>
                      {pred.aiSummary && (
                        <p className="text-sm text-muted-foreground mt-2 italic">{pred.aiSummary}</p>
                      )}
                      {factors && Object.keys(factors).length > 0 && (
                        <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                          {Object.entries(factors)
                            .filter(([k]) => k !== "overall")
                            .map(([key, val]) => (
                              <ScoreBar
                                key={key}
                                label={key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}
                                value={val}
                              />
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-card-border">
          <h2 className="font-semibold text-foreground">Runners ({horses?.length ?? 0})</h2>
          <button
            onClick={() => setShowAddHorse(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-sm font-medium transition-colors"
          >
            <Plus className="size-3.5" /> Add Horse
          </button>
        </div>
        {(horses ?? []).length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground text-sm">No horses added yet.</p>
            <button onClick={() => setShowAddHorse(true)}
              className="mt-3 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              Add First Horse
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {[...(horses ?? [])].sort((a, b) => a.number - b.number).map((horse) => (
              <div key={horse.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xs font-bold text-muted-foreground">#{horse.number}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm text-foreground">{horse.name}</p>
                    {horse.courseRecord && <span className="text-xs bg-accent/15 text-accent px-1.5 py-0.5 rounded">Course</span>}
                    {horse.distanceRecord && <span className="text-xs bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded">Distance</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {horse.jockey} / {horse.trainer}
                    {horse.form && ` · Form: ${horse.form}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-sm text-foreground">{horse.currentOdds}</p>
                  <OddsChip movement={horse.oddsMovement} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
