export default async function handler(req, res) {
  // CORS básico para que el HTML pueda llamar a esta API
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const targets = [
    "https://www.ipc-services.org/sdms/public/rankings/swm",
    "https://www.ipc-services.org/sdms/web/rankings/swm",
    "https://www.ipc-services.org/sdms/web/ranking/sw/"
  ];

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    "Cache-Control": "no-cache"
  };

  let lastError = null;
  let lastStatus = null;
  let lastUrl = null;
  let html = "";

  for (const url of targets) {
    try {
      lastUrl = url;

      const response = await fetch(url, {
        method: "GET",
        headers
      });

      lastStatus = response.status;
      const text = await response.text();

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }

      html = text;

      const parsedRows = parseRankingHtml(text);

      return res.status(200).json({
        ok: true,
        source: url,
        status: response.status,
        count: parsedRows.length,
        data: parsedRows,
        note:
          parsedRows.length > 0
            ? "Ranking leído y parseado."
            : "Se pudo leer la página, pero no se encontraron filas de ranking. Es posible que IPC Services cargue los datos por JavaScript."
      });
    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  return res.status(502).json({
    ok: false,
    error: "No se pudo leer IPC Services desde el servidor.",
    lastUrl,
    lastStatus,
    lastError,
    hint:
      "Si aparece 403, IPC Services está bloqueando la lectura desde servidor. Si aparece count 0, probablemente los datos se cargan con JavaScript y habrá que usar un extractor más avanzado.",
    preview: html ? html.slice(0, 800) : null
  });
}

function parseRankingHtml(html) {
  const rows = [];

  if (!html || typeof html !== "string") {
    return rows;
  }

  // Intento 1: buscar tablas HTML normales
  const tableMatches = html.match(/<table[\s\S]*?<\/table>/gi) || [];

  for (const table of tableMatches) {
    const trMatches = table.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    if (trMatches.length < 2) continue;

    const headerCells = extractCells(trMatches[0]).map(cleanText);
    if (!headerCells.length) continue;

    for (let i = 1; i < trMatches.length; i++) {
      const cells = extractCells(trMatches[i]).map(cleanText);
      if (!cells.length) continue;

      const rowObject = rowFromCells(headerCells, cells);

      if (hasUsefulRankingData(rowObject)) {
        rows.push(normalizeRow(rowObject));
      }
    }
  }

  // Intento 2: buscar JSON embebido en la página
  if (rows.length === 0) {
    const jsonRows = parseEmbeddedJson(html);
    rows.push(...jsonRows);
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

function rowFromCells(headers, cells) {
  const row = {};

  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    row[key || `col_${index}`] = cells[index] || "";
  });

  return row;
}

function normalizeHeader(header) {
  const h = String(header || "").toLowerCase().trim();

  if (/rank|position|pos/.test(h)) return "rank";
  if (/athlete|name|competitor|swimmer/.test(h)) return "athlete";
  if (/npc|country|nation|federation/.test(h)) return "npc";
  if (/gender|sex/.test(h)) return "gender";
  if (/event|discipline|race|stroke/.test(h)) return "event";
  if (/class|sport class|classification/.test(h)) return "class";
  if (/time|result|mark|performance/.test(h)) return "time";
  if (/points|score/.test(h)) return "points";
  if (/date/.test(h)) return "date";
  if (/competition|meet|championship|event name/.test(h)) return "competition";
  if (/city|location|venue/.test(h)) return "location";

  return h.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function hasUsefulRankingData(row) {
  const values = Object.values(row).join(" ");
  return (
    /S\d{1,2}|SB\d{1,2}|SM\d{1,2}/i.test(values) ||
    /\d{1,2}:\d{2}\.\d{2}|\d{1,2}\.\d{2}/.test(values) ||
    row.athlete ||
    row.event
  );
}

function normalizeRow(row) {
  const raw = { ...row };

  const eventText = raw.event || "";
  const classText = raw.class || eventText || Object.values(raw).join(" ");
  const detectedClass = detectClass(classText);

  return {
    rank: raw.rank || "",
    athlete: raw.athlete || raw.name || "",
    npc: normalizeNpc(raw.npc || raw.country || ""),
    gender: normalizeGender(raw.gender || ""),
    event: cleanEvent(eventText),
    class: detectedClass || "",
    time: raw.time || raw.result || raw.mark || "",
    points: raw.points || "",
    date: raw.date || "",
    competition: raw.competition || "",
    location: raw.location || "",
    raw
  };
}

function detectClass(text) {
  const t = String(text || "").toUpperCase();

  // Primero clases largas para evitar confundir S con SM/SB
  const match = t.match(/\b(SB|SM|S)\s*(1[0-4]|[1-9])\b/);

  if (!match) return "";

  return `${match[1]}${match[2]}`;
}

function cleanEvent(event) {
  return String(event || "")
    .replace(/\b(SB|SM|S)\s*(1[0-4]|[1-9])\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeGender(value) {
  const v = String(value || "").toLowerCase().trim();

  if (["m", "male", "men", "man", "masculino"].includes(v)) return "Men";
  if (["f", "female", "women", "woman", "femenino"].includes(v)) return "Women";

  return value || "";
}

function normalizeNpc(value) {
  const v = String(value || "").trim();
  const upper = v.toUpperCase();

  if (/^[A-Z]{3}$/.test(upper)) return upper;

  const map = {
    SPAIN: "ESP",
    ESPAÑA: "ESP",
    ESPANA: "ESP",
    FRANCE: "FRA",
    ITALY: "ITA",
    GERMANY: "GER",
    GREAT_BRITAIN: "GBR",
    "GREAT BRITAIN": "GBR",
    UNITED_KINGDOM: "GBR",
    "UNITED KINGDOM": "GBR",
    USA: "USA",
    "UNITED STATES": "USA",
    "UNITED STATES OF AMERICA": "USA",
    BRAZIL: "BRA",
    PORTUGAL: "POR",
    NETHERLANDS: "NED",
    AUSTRALIA: "AUS",
    CANADA: "CAN",
    JAPAN: "JPN",
    CHINA: "CHN",
    MEXICO: "MEX",
    ARGENTINA: "ARG",
    COLOMBIA: "COL",
    CHILE: "CHI"
  };

  const key = upper.replace(/\s+/g, "_");

  if (map[key]) return map[key];
  if (map[upper]) return map[upper];

  const embedded = upper.match(/\b[A-Z]{3}\b/);
  if (embedded) return embedded[0];

  return v;
}

function parseEmbeddedJson(html) {
  const rows = [];

  // Busca arrays u objetos grandes que puedan estar embebidos
  const scriptMatches = html.match(/<script[\s\S]*?<\/script>/gi) || [];

  for (const script of scriptMatches) {
    const text = script.replace(/<script[^>]*>/i, "").replace(/<\/script>/i, "");

    if (!/rank|athlete|swimmer|result|time|sportClass|classification/i.test(text)) {
      continue;
    }

    const objectMatches = text.match(/\{[\s\S]*?\}/g) || [];

    for (const objText of objectMatches) {
      try {
        const obj = JSON.parse(objText);

        const flat = flattenObject(obj);

        if (hasUsefulRankingData(flat)) {
          rows.push(normalizeRow(flat));
        }
      } catch {
        // Ignorar objetos no válidos
      }
    }
  }

  return rows;
}

function flattenObject(obj, prefix = "", out = {}) {
  if (!obj || typeof obj !== "object") return out;

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}_${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenObject(value, newKey, out);
    } else if (!Array.isArray(value)) {
      out[normalizeHeader(key)] = String(value ?? "");
    }
  }

  return out;
}
