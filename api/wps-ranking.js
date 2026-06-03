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

    const meta = {
      type,
      list,
      gender,
      event,
      sportClass,
      course,
      sourceUrl: url
    };

    const rows = parseRankingHtml(html, meta);

    return res.status(200).json({
      ok: response.ok && rows.length > 0,
      source: url,
      status: response.status,
      count: rows.length,
      data: rows,
      debug: {
        htmlLength: html.length,
        hasRank: html.includes("Rank"),
        hasName: html.includes("Name"),
        hasNpc: html.includes("NPC"),
        hasTime: html.includes("Time"),
        tableCount: (html.match(/<table/gi) || []).length,
        trCount: (html.match(/<tr/gi) || []).length,
        tdCount: (html.match(/<td/gi) || []).length
      },
      message:
        rows.length > 0
          ? "Ranking leído correctamente desde la URL HTML pública de IPC Services."
          : "La API ha leído la página, pero no ha encontrado filas de ranking.",
      preview: rows.length === 0 ? html.slice(0, 2000) : undefined
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
  if (!html || typeof html !== "string") return [];

  let rows = [];

  rows = parseByTables(html, meta);

  if (rows.length === 0) {
    rows = parseBySimpleRows(html, meta);
  }

  return rows;
}

function parseByTables(html, meta) {
  const rows = [];
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];

  for (const table of tableMatches) {
    const trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    if (trMatches.length < 2) continue;

    let headers = [];

    for (let h = 0; h < Math.min(5, trMatches.length); h++) {
      const possibleHeaders = extractCells(trMatches[h]).map(cleanText);
      const joined = possibleHeaders.join(" ").toLowerCase();

      if (
        joined.includes("rank") &&
        joined.includes("name") &&
        joined.includes("npc") &&
        joined.includes("time")
      ) {
        headers = possibleHeaders;
        trMatches.splice(0, h + 1);
        break;
      }
    }

    if (!headers.length) {
      headers = ["Rank", "Name", "NPC", "Birth", "Time", "Date", "City", "Country"];
    }

    for (const tr of trMatches) {
      const cells = extractCells(tr).map(cleanText).filter(Boolean);

      if (cells.length < 5) continue;

      const normalized = normalizeFromCells(cells, meta);

      if (isValidRankingRow(normalized)) {
        rows.push(normalized);
      }
    }
  }

  return rows;
}

function parseBySimpleRows(html, meta) {
  const rows = [];
  const trMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

  for (const tr of trMatches) {
    const cells = extractCells(tr).map(cleanText).filter(Boolean);

    if (cells.length < 5) continue;

    const normalized = normalizeFromCells(cells, meta);

    if (isValidRankingRow(normalized)) {
      rows.push(normalized);
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

function normalizeFromCells(cells, meta) {
  const rank = cells[0] || "";
  const athlete = cells[1] || "";
  const npc = cells[2] || "";
  const birth = cells[3] || "";
  const time = cells[4] || "";
  const date = cells[5] || "";
  const city = cells[6] || "";
  const country = cells[7] || "";

  return {
    rank,
    athlete,
    npc: normalizeNpc(npc),
    birth,
    gender: normalizeGender(meta.gender),
    event: normalizeEvent(meta.event),
    class: normalizeClass(meta.sportClass),
    time,
    date,
    city,
    country,
    course: normalizeCourse(meta.course),
    rankingList: meta.list || "",
    rankingType: meta.type || "",
    sourceUrl: meta.sourceUrl,
    raw: {
      cells
    }
  };
}

function isValidRankingRow(row) {
  if (!row) return false;

  const rankOk = /^(\d+|=|\d+=)$/.test(String(row.rank || "").trim());
  const athleteOk =
    row.athlete &&
    row.athlete.length > 2 &&
    !/name|rank|cookie|consent|privacy/i.test(row.athlete);

  const npcOk = /^[A-Z]{3}$/.test(row.npc || "");
  const timeOk = /^\d{1,2}:\d{2}\.\d{2}$|^\d{1,2}\.\d{2}$/.test(row.time || "");

  return athleteOk && npcOk && timeOk && (rankOk || row.rank);
}

function normalizeNpc(value) {
  const upper = String(value || "").trim().toUpperCase();
  const found = upper.match(/\b[A-Z]{3}\b/);
  return found ? found[0] : upper;
}

function normalizeClass(value) {
  const compact = String(value || "").toUpperCase();

  const match = compact.match(/^(S|SB|SM)0?([1-9]|1[0-4])$/i);

  if (match) {
    return `${match[1].toUpperCase()}${Number(match[2])}`;
  }

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
