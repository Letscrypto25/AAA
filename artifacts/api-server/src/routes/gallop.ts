import { Router } from "express";

const router = Router();

const GALLOP_GRAPHQL = "https://backend.gallop.co.za/graphql";

async function gqlFetch(query: string): Promise<unknown> {
  const res = await fetch(GALLOP_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Gallop GraphQL ${res.status}`);
  return res.json();
}

router.get("/gallop/links", async (req, res): Promise<void> => {
  try {
    const data = (await gqlFetch(`{
      iframe {
        fixtureIframeLink
        racingStatsLink
        programmeLink
        bettingTabGold
        bettingTracknBall
        SAhorseRacing
        galloptvLink
        affiliatedGoldCircleLink
        affiliatedNhraLink
        simdraw
      }
    }`)) as { data?: { iframe?: Record<string, string | null> } };

    res.json(data?.data?.iframe ?? {});
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch Gallop links");
    res.json({
      fixtureIframeLink: "https://www.sahorseform.co.za/v4.html",
      racingStatsLink: "https://www.nhra.co.za/index.php/statistics/racing",
      programmeLink: "https://sahorseracing.co.za/sahr/public.html",
      bettingTabGold: "https://www.tote.co.za",
      SAhorseRacing: "https://sahorseracing.co.za/sahr/public.html",
      galloptvLink: "https://galloptv-free.vercel.app/",
      affiliatedGoldCircleLink: "https://www.goldcircle.co.za",
      affiliatedNhraLink: "https://www.nhra.co.za",
    });
  }
});

router.get("/gallop/venues", async (req, res): Promise<void> => {
  try {
    const data = (await gqlFetch(`{
      getStripeReports {
        id
        date
        venue
      }
    }`)) as { data?: { getStripeReports?: Array<{ id: string; date: string; venue: string }> } };

    const reports = data?.data?.getStripeReports ?? [];

    const today = new Date().toISOString().split("T")[0];
    const upcoming = reports.filter((r) => r.date >= today).slice(0, 10);
    const recent = reports.filter((r) => r.date < today).slice(0, 20);

    res.json({ upcoming, recent });
  } catch (err) {
    req.log.warn({ err }, "Failed to fetch Gallop venues");
    res.status(502).json({ error: "Could not fetch venue data" });
  }
});

export default router;
