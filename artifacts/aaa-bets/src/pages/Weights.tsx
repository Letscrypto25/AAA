import { useState, useEffect } from "react";
import { useGetWeights, useUpdateWeights } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetWeightsQueryKey } from "@workspace/api-client-react";
import { SlidersHorizontal, Save, RotateCcw, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const FACTORS = [
  {
    key: "courseForm" as const,
    label: "Course Form",
    description: "How well the horse performs at this specific venue",
    color: "bg-chart-1",
  },
  {
    key: "formDistance" as const,
    label: "Form & Distance",
    description: "Recent form + suitability for today's race distance",
    color: "bg-chart-2",
  },
  {
    key: "jockeyTrainer" as const,
    label: "Jockey & Trainer",
    description: "Quality of the booking and trainer/jockey partnership",
    color: "bg-chart-3",
  },
  {
    key: "oddsMovement" as const,
    label: "Odds Movement",
    description: "Market intelligence — shortening odds = market confidence",
    color: "bg-chart-4",
  },
  {
    key: "history" as const,
    label: "History",
    description: "Overall historical performance at this level",
    color: "bg-chart-5",
  },
];

const DEFAULTS = {
  courseForm: 0.25,
  formDistance: 0.25,
  jockeyTrainer: 0.20,
  oddsMovement: 0.15,
  history: 0.15,
};

type WeightKey = keyof typeof DEFAULTS;

export default function Weights() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: weights, isLoading } = useGetWeights();
  const updateWeights = useUpdateWeights();

  const [local, setLocal] = useState(DEFAULTS);

  useEffect(() => {
    if (weights) {
      setLocal({
        courseForm: weights.courseForm,
        formDistance: weights.formDistance,
        jockeyTrainer: weights.jockeyTrainer,
        oddsMovement: weights.oddsMovement,
        history: weights.history,
      });
    }
  }, [weights]);

  const total = Object.values(local).reduce((a, b) => a + b, 0);
  const isValid = Math.abs(total - 1.0) < 0.01;

  const handleChange = (key: WeightKey, value: number) => {
    setLocal((prev) => ({ ...prev, [key]: Math.max(0, Math.min(1, value)) }));
  };

  const handleSave = async () => {
    if (!isValid) {
      toast({ title: "Invalid weights", description: "Weights must sum to 100%", variant: "destructive" });
      return;
    }
    try {
      await updateWeights.mutateAsync({ data: local });
      await qc.invalidateQueries({ queryKey: getGetWeightsQueryKey() });
      toast({ title: "Weights saved", description: "Future analyses will use the new weights" });
    } catch {
      toast({ title: "Error", description: "Failed to save weights", variant: "destructive" });
    }
  };

  const handleReset = () => {
    setLocal(DEFAULTS);
  };

  const normalize = () => {
    const t = Object.values(local).reduce((a, b) => a + b, 0);
    if (t === 0) return;
    setLocal((prev) =>
      Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, v / t])) as typeof prev,
    );
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <SlidersHorizontal className="size-6 text-primary" />
            Prediction Weights
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Adjust how much each factor influences the AI prediction score
          </p>
        </div>
      </div>

      <div
        className={cn(
          "rounded-xl p-4 flex items-center justify-between",
          isValid ? "bg-accent/10 border border-accent/30" : "bg-destructive/10 border border-destructive/30",
        )}
      >
        <div className="flex items-center gap-2">
          <Info className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Total:{" "}
            <span className={cn("font-bold", isValid ? "text-accent" : "text-destructive")}>
              {(total * 100).toFixed(0)}%
            </span>
          </span>
          {!isValid && (
            <button onClick={normalize} className="text-xs text-primary hover:underline ml-2">
              Auto-normalize
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">Must equal 100%</div>
      </div>

      <div className="h-3 bg-muted rounded-full overflow-hidden flex">
        {FACTORS.map((f) => (
          <div
            key={f.key}
            className={cn("h-full transition-all duration-300", f.color)}
            style={{ width: `${(local[f.key] / Math.max(total, 0.001)) * 100}%` }}
          />
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 bg-card border border-card-border rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {FACTORS.map((factor) => (
            <div key={factor.key} className="bg-card border border-card-border rounded-xl p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex items-center gap-3">
                  <div className={cn("size-3 rounded-full shrink-0", factor.color)} />
                  <div>
                    <p className="font-semibold text-foreground text-sm">{factor.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{factor.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(local[factor.key] * 100)}
                    onChange={(e) => handleChange(factor.key, Number(e.target.value) / 100)}
                    className="w-16 text-center bg-input border border-border rounded-lg px-2 py-1 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground font-medium">%</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(local[factor.key] * 100)}
                onChange={(e) => handleChange(factor.key, Number(e.target.value) / 100)}
                className="w-full h-2 rounded-full appearance-none cursor-pointer bg-muted accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleReset}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <RotateCcw className="size-4" /> Reset to defaults
        </button>
        <button
          onClick={handleSave}
          disabled={!isValid || updateWeights.isPending}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          <Save className="size-4" />
          {updateWeights.isPending ? "Saving..." : "Save Weights"}
        </button>
      </div>

      <div className="bg-muted/50 rounded-xl p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">Tip</p>
        <p>
          You can also ask the AI Chat to adjust weights for you. For example: "Give more weight to
          odds movement" and the AI will suggest new values automatically.
        </p>
      </div>
    </div>
  );
}
