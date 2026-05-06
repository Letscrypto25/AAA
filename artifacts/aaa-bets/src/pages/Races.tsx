import { useState } from "react";
import { useGetRaces, useCreateRace } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, Trophy, ChevronRight, Search, Clock, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const VENUES = [
  "Kenilworth", "Turffontein", "Greyville", "Borrowdale", "Scottsville",
  "Flamingo Park", "Fairview", "Vaal", "Hollywoodbets Greyville",
];
const SURFACES = ["turf", "polytrack", "dirt"];

function AddRaceModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const createRace = useCreateRace();
  const [form, setForm] = useState({
    raceNumber: 1,
    name: "",
    venue: VENUES[0],
    distance: 1200,
    raceTime: "13:00",
    surface: "turf",
    grade: "",
    prize: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createRace.mutateAsync({
        data: {
          ...form,
          grade: form.grade || undefined,
          prize: form.prize || undefined,
        },
      });
      toast({ title: "Race added", description: `${form.name} at ${form.venue}` });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to add race", variant: "destructive" });
    }
  };

  const field = (label: string, children: React.ReactNode) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );

  const inp = "w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-card-border">
          <h2 className="font-semibold text-foreground">Add New Race</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {field("Race #",
              <input type="number" min={1} max={20} value={form.raceNumber}
                onChange={(e) => setForm({ ...form, raceNumber: Number(e.target.value) })}
                className={inp} required />
            )}
            {field("Race Name",
              <input type="text" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Merchants Mile" className={inp} required />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("Venue",
              <select value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} className={inp}>
                {VENUES.map((v) => <option key={v}>{v}</option>)}
                <option value="Other">Other</option>
              </select>
            )}
            {field("Surface",
              <select value={form.surface} onChange={(e) => setForm({ ...form, surface: e.target.value })} className={inp}>
                {SURFACES.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("Distance (m)",
              <input type="number" min={800} max={4000} step={100} value={form.distance}
                onChange={(e) => setForm({ ...form, distance: Number(e.target.value) })}
                className={inp} required />
            )}
            {field("Race Time",
              <input type="time" value={form.raceTime}
                onChange={(e) => setForm({ ...form, raceTime: e.target.value })}
                className={inp} required />
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            {field("Grade (optional)",
              <input type="text" value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value })}
                placeholder="e.g. G1, Open" className={inp} />
            )}
            {field("Prize Money (optional)",
              <input type="text" value={form.prize}
                onChange={(e) => setForm({ ...form, prize: e.target.value })}
                placeholder="e.g. R200,000" className={inp} />
            )}
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={createRace.isPending}
              className="px-5 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
              {createRace.isPending ? "Adding..." : "Add Race"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Races() {
  const { data: races, isLoading } = useGetRaces();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = (races ?? []).filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.venue.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {showAdd && <AddRaceModal onClose={() => setShowAdd(false)} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Trophy className="size-6 text-primary" />
            Races
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{races?.length ?? 0} races loaded</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="size-4" />
          Add Race
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <input
          type="search"
          placeholder="Search races or venues..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-card border border-card-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-card-border rounded-xl p-12 text-center">
          <Trophy className="size-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-foreground">No races found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? "Try a different search." : "Add your first race to get started."}
          </p>
          {!search && (
            <button onClick={() => setShowAdd(true)}
              className="mt-4 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
              Add Race
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((race) => (
            <Link key={race.id} href={`/races/${race.id}`}>
              <div className="bg-card border border-card-border rounded-xl px-5 py-4 hover:border-primary/40 transition-colors cursor-pointer flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="size-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <span className="text-primary font-bold text-sm">R{race.raceNumber}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{race.name}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" /> {race.raceTime}
                      </span>
                      <span>{race.venue}</span>
                      <span>{race.distance}m {race.surface}</span>
                      {race.grade && <span className="font-medium text-foreground">{race.grade}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right hidden sm:block">
                    <span className="text-xs text-muted-foreground">{(race as any).horseCount ?? 0} horses</span>
                    <div className={cn(
                      "text-xs mt-0.5 font-medium",
                      race.lastAnalyzedAt ? "text-accent" : "text-muted-foreground"
                    )}>
                      {race.lastAnalyzedAt ? "Analyzed" : "Not analyzed"}
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
