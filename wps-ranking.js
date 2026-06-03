import * as XLSX from 'xlsx';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const type = safe(q.type || 'world');
  const list = safe(q.list || '1161');
  const gender = safe(q.gender || 'm');
  const event = safe(q.event || q.evt || '50mfr--');
  const sportClass = safe(q.class || q.sportClass || 's09');
  const course = safe(q.course || 'lc');

  const base = 'https://www.ipc-services.org/sdms/public/rankings/swm';
  const suffix = `/type/${type}/list/${list}/gender/${gender}/evt/${event}/class/${sportClass}/course/${course}`;

  const targets = [
    `${base}/excel${suffix}`,
    `${base}/xlsx${suffix}`,
    `${base}/xls${suffix}`,
    `${base}/xml${suffix}`,
    `${base}/html${suffix}`
  ];

  const attempts = [];

  for (const url of targets) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
          'Accept': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/xml,text/xml,text/html,*/*',
          'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
          'Cache-Control': 'no-cache',
          'Cookie': 'SDMS_COOKIE_CONSENT=true; SDMS_COOKIE_CONSENT=1',
          'Referer': 'https://www.ipc-services.org/sdms/public/rankings/swm'
        }
      });

      const contentType = response.headers.get('content-type') || '';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      let rows = [];
      let mode = '';

      if (looksLikeXlsx(buffer, contentType, url)) {
        mode = 'xlsx';
        rows = parseXlsx(buffer, { type, list, gender, event, sportClass, course, sourceUrl: url });
      } else {
        const text = buffer.toString('utf8');
        if (looksLikeXml(text, contentType, url)) {
          mode = 'xml';
          rows = parseXml(text, { type, list, gender, event, sportClass, course, sourceUrl: url });
        } else {
          mode = 'html';
          rows = parseHtmlTable(text, { type, list, gender, event, sportClass, course, sourceUrl: url });
        }
      }

      attempts.push({ url, status: response.status, contentType, bytes: buffer.length, mode, count: rows.length });

      if (response.ok && rows.length > 0) {
        return res.status(200).json({
          ok: true,
          source: url,
          status: response.status,
          count: rows.length,
          data: rows,
          attempts,
          message: `Ranking leído correctamente desde exportación ${mode.toUpperCase()} de IPC Services.`
        });
      }
    } catch (error) {
      attempts.push({ url, error: error.message || String(error) });
    }
  }

  return res.status(200).json({
    ok: false,
    count: 0,
    data: [],
    attempts,
    message: 'La API funciona, pero no ha encontrado filas reales en Excel/XML/HTML. Revisa cuál es la URL exacta del botón as Excel/as XML.'
  });
}

function safe(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').trim();
}

function looksLikeXlsx(buffer, contentType, url) {
  const start = buffer.slice(0, 4).toString('binary');
  return contentType.includes('spreadsheet') || contentType.includes('excel') || /xlsx|xls|excel/i.test(url) || start.startsWith('PK');
}

function looksLikeXml(text, contentType, url) {
  return contentType.includes('xml') || /xml/i.test(url) || /^\s*</.test(text) && /<\?xml|<Workbook|<row|<ranking/i.test(text);
}

function parseXlsx(buffer, meta) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  return rowsFromMatrix(matrix, meta);
}

function rowsFromMatrix(matrix, meta) {
  let headerIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const row = matrix[i].map(clean);
    const joined = row.join(' ').toLowerCase();
    if (joined.includes('event code') && joined.includes('family name') && joined.includes('given name') && joined.includes('time')) {
      headerIndex = i;
      break;
    }
    if (joined.includes('rank') && joined.includes('name') && joined.includes('npc') && joined.includes('time')) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) return [];

  const headers = matrix[headerIndex].map(h => normalizeHeader(h));
  const out = [];

  for (let r = headerIndex + 1; r < matrix.length; r++) {
    const vals = matrix[r] || [];
    if (!vals.some(v => String(v || '').trim())) continue;
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = clean(vals[i]); });
    const row = normalizeRow(obj, meta);
    if (isRealRow(row)) out.push(row);
  }
  return out;
}

function normalizeHeader(h) {
  const x = clean(h).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  if (x === 'rank' || x.includes('ranking')) return 'rank';
  if (x === 'name' || x.includes('athlete') || x.includes('swimmer')) return 'athlete';
  if (x.includes('family name') || x === 'family') return 'familyName';
  if (x.includes('given name') || x === 'given') return 'givenName';
  if (x === 'npc' || x.includes('nation')) return 'npc';
  if (x === 'birth' || x.includes('year')) return 'birth';
  if (x === 'gender' || x === 'sex') return 'gender';
  if (x === 'event' || x.includes('event type')) return 'event';
  if (x.includes('event code')) return 'eventCode';
  if (x === 'class' || x.includes('eligible class') || x.includes('sport class')) return 'class';
  if (x === 'time' || x.includes('result') || x.includes('mark')) return 'time';
  if (x === 'date') return 'date';
  if (x === 'city') return 'city';
  if (x === 'country') return 'country';
  if (x.includes('athlete id')) return 'athleteId';
  return x.replace(/\s+/g, '_');
}

function normalizeRow(obj, meta) {
  const athlete = obj.athlete || [obj.familyName, obj.givenName].filter(Boolean).join(' ');
  const eventText = obj.event || normalizeEvent(meta.event);
  return {
    rank: obj.rank || '',
    athleteId: obj.athleteId || '',
    athlete: cleanName(athlete),
    familyName: obj.familyName || '',
    givenName: obj.givenName || '',
    npc: normalizeNpc(obj.npc || ''),
    birth: obj.birth || '',
    gender: normalizeGender(obj.gender || meta.gender),
    event: clean(eventText),
    class: normalizeClass(obj.class || meta.sportClass || detectClass(eventText)),
    time: obj.time || '',
    date: normalizeDate(obj.date || ''),
    city: obj.city || '',
    country: obj.country || '',
    course: normalizeCourse(meta.course),
    rankingList: meta.list || '',
    rankingType: meta.type || '',
    sourceUrl: meta.sourceUrl,
    raw: obj
  };
}

function isRealRow(row) {
  if (!row) return false;
  if (!row.athlete || row.athlete.length < 3) return false;
  if (/cookie|consent|privacy|name/i.test(row.athlete)) return false;
  if (!/^[A-Z]{3}$/.test(row.npc || '')) return false;
  if (!/^\d{1,2}:\d{2}\.\d{2}$|^\d{1,2}\.\d{2}$/.test(row.time || '')) return false;
  return true;
}

function parseHtmlTable(html, meta) {
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  const rowRe = /<tr[\s\S]*?<\/tr>/gi;
  const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  const tables = html.match(tableRe) || [];
  for (const table of tables) {
    const matrix = [];
    const rows = table.match(rowRe) || [];
    for (const row of rows) matrix.push([...row.matchAll(cellRe)].map(m => stripTags(m[1])));
    const parsed = rowsFromMatrix(matrix, meta);
    if (parsed.length) return parsed;
  }
  return [];
}

function parseXml(xml, meta) {
  // Try spreadsheet XML first by stripping tags into a loose matrix.
  return parseHtmlTable(xml, meta);
}

function stripTags(s) {
  return clean(String(s || '').replace(/<[^>]+>/g, ' '));
}

function clean(value) {
  return String(value ?? '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(name) {
  return clean(name).replace(/\s*,\s*/g, ' ');
}

function normalizeNpc(value) {
  const upper = clean(value).toUpperCase();
  const found = upper.match(/\b[A-Z]{3}\b/);
  return found ? found[0] : upper;
}

function normalizeClass(value) {
  const compact = clean(value).toUpperCase().replace(/\s+/g, '');
  const match = compact.match(/^(S|SB|SM)0?([1-9]|1[0-4])$/i);
  if (match) return `${match[1].toUpperCase()}${Number(match[2])}`;
  const embedded = compact.match(/\b(SB|SM|S)0?([1-9]|1[0-4])\b/i);
  if (embedded) return `${embedded[1].toUpperCase()}${Number(embedded[2])}`;
  return compact;
}

function detectClass(text) {
  const m = clean(text).toUpperCase().match(/\b(SB|SM|S)\s*0?([1-9]|1[0-4])\b/);
  return m ? `${m[1]}${Number(m[2])}` : '';
}

function normalizeGender(value) {
  const v = clean(value).toLowerCase();
  if (v === 'm' || v === 'men' || v === 'male') return 'Men';
  if (v === 'f' || v === 'women' || v === 'female') return 'Women';
  if (v === 'x' || v === 'e' || v === 'either') return 'Either';
  return value || '';
}

function normalizeCourse(value) {
  const v = clean(value).toLowerCase();
  if (v === 'lc') return 'Long Course';
  if (v === 'sc') return 'Short Course';
  if (v === 'ow') return 'Open Water';
  return value || '';
}

function normalizeEvent(value) {
  const v = clean(value).toLowerCase();
  const map = {
    '50mfr--': '50 m Freestyle',
    '100mfr-': '100 m Freestyle',
    '200mfr-': '200 m Freestyle',
    '400mfr-': '400 m Freestyle',
    '50mba--': '50 m Backstroke',
    '100mba-': '100 m Backstroke',
    '50mbr--': '50 m Breaststroke',
    '100mbr-': '100 m Breaststroke',
    '50mbu--': '50 m Butterfly',
    '100mbu-': '100 m Butterfly',
    '150mim-': '150 m Individual Medley',
    '200mim-': '200 m Individual Medley'
  };
  return map[v] || value || '';
}

function normalizeDate(value) {
  return clean(value);
}
