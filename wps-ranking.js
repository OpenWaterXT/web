// Para Swimming Data Lab - proxy/API for live ranking access.
// This endpoint fetches the public IPC Services ranking page server-side and
// returns JSON with CORS headers for the HTML app.

const TARGETS = [
  'https://www.ipc-services.org/sdms/public/rankings/swm',
  'https://www.ipc-services.org/sdms/web/rankings/swm'
];

function stripTags(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
function cleanHeader(h){return String(h||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function mapHeader(h){
  const x=cleanHeader(h);
  if(['rank','ranking','position','pos','place','rankposition'].includes(x)) return 'rank';
  if(['athlete','athletename','name','fullname','swimmer','competitor','participant'].includes(x)) return 'athlete';
  if(['firstname','first','givenname'].includes(x)) return 'firstName';
  if(['lastname','surname','familyname'].includes(x)) return 'lastName';
  if(['npc','country','countrycode','nation','nationality','npccode'].includes(x)) return 'npc';
  if(['gender','sex'].includes(x)) return 'gender';
  if(['event','eventname','race','discipline','distanceevent'].includes(x)) return 'event';
  if(['class','sportclass','sportclasscode','classification'].includes(x)) return 'class';
  if(['time','result','mark','performance','resulttime','besttime'].includes(x)) return 'time';
  if(['date','resultdate','competitiondate'].includes(x)) return 'date';
  if(['competition','competitionname','meet','meetname'].includes(x)) return 'competition';
  if(['points','score','wpspoints'].includes(x)) return 'points';
  return x || 'col';
}
function parseTables(html){
  const out=[];
  const tableRe=/<table[\s\S]*?<\/table>/gi;
  const rowRe=/<tr[\s\S]*?<\/tr>/gi;
  const cellRe=/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
  const tables=html.match(tableRe)||[];
  for(const table of tables){
    const rows=table.match(rowRe)||[];
    if(rows.length<2) continue;
    let header=[];
    for(let ri=0;ri<rows.length;ri++){
      const cells=[...rows[ri].matchAll(cellRe)].map(m=>stripTags(m[1]));
      if(!cells.length) continue;
      if(!header.length){ header=cells.map(mapHeader); continue; }
      const obj={}; header.forEach((h,i)=>obj[h]=cells[i]||'');
      if(Object.values(obj).some(Boolean)) out.push(obj);
    }
  }
  return out;
}
function extractJsonCandidates(html){
  const arr=[];
  const scriptRe=/<script[^>]*>([\s\S]*?)<\/script>/gi;
  for(const m of html.matchAll(scriptRe)){
    const txt=m[1].trim();
    if(!txt) continue;
    if(txt.startsWith('{') || txt.startsWith('[')) {
      try { arr.push(JSON.parse(txt)); } catch {}
    }
    const next=txt.match(/__NEXT_DATA__[^>]*>([\s\S]*)/);
    if(next){ try { arr.push(JSON.parse(next[1])); } catch{} }
  }
  return arr;
}
function findRowsInJson(x, depth=0){
  if(depth>8 || x==null) return [];
  if(Array.isArray(x)){
    const looks=x.filter(o=>o && typeof o==='object').filter(o=>{
      const keys=Object.keys(o).map(cleanHeader).join(' ');
      return /(athlete|swimmer|competitor|name)/.test(keys) && /(time|result|mark|performance)/.test(keys);
    });
    if(looks.length) return looks;
    return x.flatMap(v=>findRowsInJson(v,depth+1));
  }
  if(typeof x==='object') return Object.values(x).flatMap(v=>findRowsInJson(v,depth+1));
  return [];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const targets = req.query?.url ? [req.query.url] : TARGETS;
  try {
    let last = null;
    for (const target of targets) {
      const response = await fetch(target, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
        'Accept-Language': 'en,es;q=0.9',
        'Referer': 'https://www.ipc-services.org/'
      }
    });
    const contentType=response.headers.get('content-type')||'';
    const text=await response.text();
    let data=[];
    if(contentType.includes('json')){
      try { const js=JSON.parse(text); data=Array.isArray(js)?js:findRowsInJson(js); }
      catch {}
    } else {
      data=parseTables(text);
      if(!data.length){
        for(const js of extractJsonCandidates(text)){
          data=findRowsInJson(js);
          if(data.length) break;
        }
      }
    }
      last = { ok: response.ok, status: response.status, source: target, contentType, count: data.length, data, html: data.length ? undefined : text.slice(0, 500000) };
      if (response.ok && data.length) return res.status(200).json(last);
    }
    return res.status(200).json(last || { ok:false, error:'No target tried' });
  } catch (err) {
    res.status(500).json({ ok:false, error: String(err && err.message || err) });
  }
}
