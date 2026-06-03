export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const query = req.query || {};

  const type = safe(query.type || "world");
  const list = safe(query.list || "1161");
  const gender = safe(query.gender || "m");
  const event = safe(query.event || "50mfr--");
  const sportClass = safe(query.class || "s09");
  const course = safe(query.course || "lc");

  const url =
    `https://www.ipc-services.org/sdms/public/rankings/swm/html` +
    `/type/${type}` +
    `/list/${list}` +
    `/gender/${gender}` +
    `/evt/${event}` +
    `/class/${sportClass}` +
    `/course/${course}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
        "Cache-Control": "no-cache",
        "Cookie": "SDMS_COOKIE_CONSENT=true; SDMS_COOKIE_CONSENT=1"
      }
    });

    const html = await response.text();
    const rows = parseRankingHtml(html, {
      type,
      list,
      gender,
      event,
      sportClass,
      course,
      sourceUrl: url
    });

    return res.status(200).json({
      ok: response.ok && rows.length > 0,
      source: url,
      status: response.status,
      count: rows.length,
      data: rows,
      message:
        rows.length > 0
          ? "Ranking leído correctamente desde la URL HTML pública de IPC Services."
          : "La API ha leído la página, pero no ha encontrado filas de ranking.",
      preview: rows.length === 0 ? html.slice(0, 1000) : undefined
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || String(error),
      source: url
    });
  }
}

function safe(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .trim();
}

function parseRankingHtml(html, meta) {
  const rows = [];

  if (!html || typeof html !== "string") return rows;

  const titleMatch = html.match(/<h[1-6][^>]*>\s*([^<]*Rankings[^<]*)\s*<\/h[1-6]>/i);
  const pageTitle = titleMatch ? cleanText(titleMatch[1]) : "";

  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];

  for (const table of tableMatches) {
    const trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    if (trMatches.length < 2) continue;

    const headers = extractCells(trMatches[0]).map(cleanText);
    const headerText = headers.join(" ").toLowerCase();

    const looksLikeRankingTable =
      headerText.includes("rank") &&
      headerText.includes("name") &&
      headerText.includes("npc") &&
      headerText.includes("time");

    if (!looksLikeRankingTable) continue;

    for (let i = 1; i < trMatches.length; i++) {
      const cells = extractCells(trMatches[i]).map(cleanText);

      if (cells.length < 5) continue;

      const rawRow = {};
      headers.forEach((header, index) => {
        rawRow[normalizeHeader(header)] = cells[index] || "";
      });

      const normalized = normalizeRankingRow(rawRow, meta, pageTitle);

      if (normalized.athlete && normalized.time) {
        rows.push(normalized);
      }
    }
  }

  return rows;
}

function extractCells(trHtml) {
  const matches = trHtml.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || [];

  return matches.map((cell) =>
    cell
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  );
}

function cleanText(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(header) {
  const h = String(header || "").toLowerCase().trim();

  if (h === "rank") return "rank";
  if (h === "name" || h.includes("athlete") || h.includes("swimmer")) return "athlete";
  if (h === "npc" || h.includes("country code")) return "npc";
  if (h === "birth" || h.includes("year")) return "birth";
  if (h === "time" || h.includes("result")) return "time";
  if (h === "date") return "date";
  if (h === "city") return "city";
  if (h === "country") return "country";

  return h.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeRankingRow(row, meta, pageTitle) {
  const classCode = normalizeClass(meta.sportClass);
  const genderLabel = normalizeGender(meta.gender);
  const eventLabel = normalizeEvent(meta.event);

  return {
    rank: row.rank || "",
    athlete: normalizeName(row.athlete || ""),
    npc: normalizeNpc(row.npc || ""),
    birth: row.birth || "",
    gender: genderLabel,
    event: eventLabel,
    class: classCode,
    time: row.time || "",
    date: row.date || "",
    city: row.city || "",
    country: row.country || "",
    course: normalizeCourse(meta.course),
    rankingList: meta.list || "",
    rankingType: meta.type || "",
    pageTitle,
    sourceUrl: meta.sourceUrl,
    raw: row
  };
}

function normalizeName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNpc(value) {
  const upper = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : upper;
}

function normalizeClass(value) {
  const v = String(value || "").toUpperCase().replace(/^0+/, "");

  const match = v.match(/^(S|SB|SM)0?([1-9]|1[0-4])$/i);
  if (match) return `${match[1].toUpperCase()}${Number(match[2])}`;

  const compact = String(value || "").toUpperCase();
  if (compact.startsWith("S09")) return "S9";
  if (compact.startsWith("S10")) return "S10";
  if (compact.startsWith("S11")) return "S11";
  if (compact.startsWith("S12")) return "S12";
  if (compact.startsWith("S13")) return "S13";
  if (compact.startsWith("S14")) return "S14";

  return compact;
}

function normalizeGender(value) {
  const v = String(value || "").toLowerCase();

  if (v === "m") return "Men";
  if (v === "f") return "Women";
  if (v === "x" || v === "e") return "Either";

  return value || "";
}

function normalizeCourse(value) {
  const v = String(value || "").toLowerCase();

  if (v === "lc") return "Long Course";
  if (v === "sc") return "Short Course";
  if (v === "ow") return "Open Water";

  return value || "";
}

function normalizeEvent(value) {
  const v = String(value || "").toLowerCase();

  const map = {
    "50mfr--": "50 m Freestyle",
    "100mfr-": "100 m Freestyle",
    "200mfr-": "200 m Freestyle",
    "400mfr-": "400 m Freestyle",
    "50mba--": "50 m Backstroke",
    "100mba-": "100 m Backstroke",
    "50mbr--": "50 m Breaststroke",
    "100mbr-": "100 m Breaststroke",
    "50mbu--": "50 m Butterfly",
    "100mbu-": "100 m Butterfly",
    "150mim-": "150 m Individual Medley",
    "200mim-": "200 m Individual Medley"
  };

  return map[v] || value || "";
}
