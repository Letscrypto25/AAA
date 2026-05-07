import { logger } from "./logger";

const GC_WP_API = "https://www.goldcircle.co.za/wp-json/wp/v2";

const SA_VENUES = [
  "Turffontein",
  "Kenilworth",
  "Greyville",
  "Scottsville",
  "Fairview",
  "Vaal",
  "Durbanville",
  "Flamingo Park",
  "Port Elizabeth",
];

function formatDateForTitle(date: Date): string {
  const d = date.getDate();
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${d} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function parseRaceTime(timeStr: string): string {
  const m = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!m) return "13:00";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function venueToSurface(venue: string): string {
  const v = venue.toLowerCase();
  if (v.includes("fairview") || v.includes("vaal")) return "polytrack";
  if (v.includes("greyville")) return "turf";
  return "turf";
}

function venueDistances(venue: string): number[] {
  const v = venue.toLowerCase();
  if (v.includes("turffontein")) return [1000, 1200, 1400, 1600, 1800, 1600, 2000, 1200];
  if (v.includes("kenilworth")) return [1200, 1400, 1600, 1800, 1200, 1600, 2000, 1400];
  if (v.includes("greyville")) return [1200, 1400, 1600, 1800, 1200, 1600, 1800, 1400];
  if (v.includes("scottsville")) return [1200, 1400, 1600, 1800, 1200, 1400, 2000, 1600];
  if (v.includes("fairview")) return [1000, 1200, 1400, 1600, 1200, 1400, 1600, 1800];
  if (v.includes("vaal")) return [1000, 1200, 1400, 1600, 1200, 1400, 1600, 1800];
  if (v.includes("durbanville")) return [1100, 1200, 1400, 1600, 1200, 1400, 2000, 1600];
  return [1200, 1400, 1600, 1800, 1200, 1400, 1800, 1600];
}

export interface GCMeeting {
  venue: string;
  date: string;
  raceCount: number;
  firstRaceTime: string;
  surface: string;
  postTitle: string;
}

export interface GCRaceSlot {
  raceNumber: number;
  name: string;
  time: string;
  distance: number;
  surface: string;
  venue: string;
  meetingDate: string;
}

function parseMeetingFromTitle(title: string): GCMeeting | null {
  const decoded = title.replace(/&#8211;/g, "–").replace(/&#038;/g, "&").replace(/&amp;/g, "&");

  let venue: string | null = null;
  for (const v of SA_VENUES) {
    if (decoded.toLowerCase().includes(v.toLowerCase())) {
      venue = v;
      break;
    }
  }
  if (!venue) return null;

  const raceCountMatch = decoded.match(/(\d+)\s+Races?\s+[Cc]arded/i);
  const raceCount = raceCountMatch ? parseInt(raceCountMatch[1]) : 8;

  const timeMatch = decoded.match(/Race\s+1\s+off\s+at\s+(\d{1,2}:\d{2})/i);
  const firstRaceTime = timeMatch ? parseRaceTime(timeMatch[1]) : "13:00";

  const dateMatch = decoded.match(/(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i);
  if (!dateMatch) return null;

  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const d = new Date(
    parseInt(dateMatch[3]),
    months[dateMatch[2].toLowerCase()],
    parseInt(dateMatch[1]),
  );
  const meetingDate = d.toISOString().split("T")[0];

  return {
    venue,
    date: meetingDate,
    raceCount,
    firstRaceTime,
    surface: venueToSurface(venue),
    postTitle: decoded,
  };
}

async function fetchGCPosts(search: string): Promise<Array<{ title: { rendered: string } }>> {
  const url = `${GC_WP_API}/posts?search=${encodeURIComponent(search)}&per_page=20&orderby=date&order=desc`;
  const res = await fetch(url, {
    headers: { "User-Agent": "AAA-Bets/1.0" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Gold Circle WP API ${res.status}`);
  return res.json() as Promise<Array<{ title: { rendered: string } }>>;
}

export async function fetchMeetingsForDate(date: Date): Promise<GCMeeting[]> {
  const titleDate = formatDateForTitle(date);
  try {
    const posts = await fetchGCPosts(titleDate);
    const meetings: GCMeeting[] = [];
    const seenVenues = new Set<string>();

    for (const post of posts) {
      const m = parseMeetingFromTitle(post.title.rendered);
      if (!m || m.date !== date.toISOString().split("T")[0]) continue;
      if (seenVenues.has(m.venue)) continue;
      seenVenues.add(m.venue);
      meetings.push(m);
    }

    return meetings;
  } catch (err) {
    logger.warn({ err, date: titleDate }, "Failed to fetch Gold Circle meetings");
    return [];
  }
}

export function meetingToRaceSlots(meeting: GCMeeting): GCRaceSlot[] {
  const distances = venueDistances(meeting.venue);
  const slots: GCRaceSlot[] = [];

  for (let i = 0; i < meeting.raceCount; i++) {
    const raceNumber = i + 1;
    const time = addMinutes(meeting.firstRaceTime, i * 30);
    const distance = distances[i] ?? 1400;
    slots.push({
      raceNumber,
      name: `${meeting.venue} Race ${raceNumber}`,
      time,
      distance,
      surface: meeting.surface,
      venue: meeting.venue,
      meetingDate: meeting.date,
    });
  }
  return slots;
}
