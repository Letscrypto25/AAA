export function formatConfidenceBand(band?: string | null): string {
  switch (band) {
    case "jump":
      return "Final market";
    case "late-market":
      return "Late market";
    case "today":
      return "Today";
    case "tomorrow":
      return "Tomorrow edge";
    case "building":
      return "Building";
    case "early":
      return "Early read";
    case "post-race":
      return "Result pending";
    default:
      return "Forecast";
  }
}

export function formatMinutesToRace(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return "Timing pending";
  if (minutes <= 0) return "Race due or gone";
  if (minutes < 60) return `${minutes}m away`;
  if (minutes < 24 * 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest > 0 ? `${hours}h ${rest}m away` : `${hours}h away`;
  }
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  return hours > 0 ? `${days}d ${hours}h away` : `${days}d away`;
}

export function formatOutcomeLabel(status?: string | null, finishPosition?: number | null): string | null {
  if (status === "winner") return "Winner";
  if (status === "placed") return finishPosition ? `Placed ${finishPosition}` : "Placed";
  if (status === "unplaced") return "Missed";
  return null;
}

export function getOutcomeTone(status?: string | null): string {
  if (status === "winner") return "bg-emerald-500/15 text-emerald-300 border-emerald-400/30";
  if (status === "placed") return "bg-amber-500/15 text-amber-300 border-amber-400/30";
  if (status === "unplaced") return "bg-rose-500/15 text-rose-300 border-rose-400/30";
  return "bg-muted text-muted-foreground border-border";
}
