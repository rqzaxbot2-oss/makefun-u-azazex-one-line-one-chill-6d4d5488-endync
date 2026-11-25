import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

type CriterionKey = "fright" | "vividness" | "originality" | "craft";
type CriterionScores = Record<CriterionKey, number>;

interface Candidate {
  id: string;
  label: string;
  line: string;
  scores: CriterionScores;
  anatomy: { opening: string; hinge: string; payoff: string };
}

interface LineMetrics {
  char_count: number;
  max_chars: number;
  under_200: boolean;
  word_count: number;
  sentence_count: number;
  single_sentence: boolean;
  breath_seconds: number;
  sha256: string;
}

interface RankedCandidate {
  id: string;
  label: string;
  line: string;
  weighted_score: number;
  pairwise_wins: number;
  pairwise_losses: number;
  win_rate: number;
  scores: CriterionScores;
  metrics: LineMetrics;
  anatomy: Candidate["anatomy"];
}

interface Matchup {
  a: string;
  b: string;
  winner: string;
  margin: number;
  deciding_criterion: CriterionKey;
}

const BOUNTY_ID = "u-azazex-one-line-one-chill-6d4d5488";
const BOUNTY_NAME = "One Line, One Chill";
const MAX_CHARS = 199;
const CRITERIA_ORDER: readonly CriterionKey[] = [
  "fright",
  "vividness",
  "originality",
  "craft",
];
const WEIGHTS: Readonly<CriterionScores> = {
  fright: 0.4,
  vividness: 0.25,
  originality: 0.2,
  craft: 0.15,
};

const CANDIDATES: readonly Candidate[] = [
  {
    id: "hair-behind-eyes",
    label: "Taut Filament",
    line: "I pulled a stray black hair from between my back teeth until it went taut, and felt something wet and coiled behind my eyes tug back.",
    scores: { fright: 9.7, vividness: 9.6, originality: 9.5, craft: 9.6 },
    anatomy: {
      opening: "I pulled a stray black hair from between my back teeth",
      hinge: "until it went taut,",
      payoff: "and felt something wet and coiled behind my eyes tug back.",
    },
  },
  {
    id: "mother-glove",
    label: "Loose Sleeve",
    line: "When I folded my dead mother's cold fingers over her chest, the pale skin slid loose like a wet glove and something much thinner gripped my thumb from inside.",
    scores: { fright: 9.2, vividness: 9.4, originality: 8.8, craft: 9.0 },
    anatomy: {
      opening: "When I folded my dead mother's cold fingers over her chest,",
      hinge: "the pale skin slid loose like a wet glove",
      payoff: "and something much thinner gripped my thumb from inside.",
    },
  },
  {
    id: "plaster-slit",
    label: "Drywall Seam",
    line: "While I scraped damp plaster from the crack above my pillow, the narrow seam widened into a wet, blinking slit that focused straight down at my throat.",
    scores: { fright: 8.9, vividness: 9.2, originality: 8.9, craft: 8.8 },
    anatomy: {
      opening: "While I scraped damp plaster from the crack above my pillow,",
      hinge: "the narrow seam widened into a wet, blinking slit",
      payoff: "that focused straight down at my throat.",
    },
  },
  {
    id: "mattress-nails",
    label: "Foam Underlay",
    line: "My son begged me to check the scratching inside his mattress, so I slit the seam and found bitten-off fingernails pressed neatly into the foam from underneath.",
    scores: { fright: 8.7, vividness: 8.9, originality: 8.7, craft: 8.6 },
    anatomy: {
      opening: "My son begged me to check the scratching inside his mattress,",
      hinge: "so I slit the seam",
      payoff: "and found bitten-off fingernails pressed neatly into the foam from underneath.",
    },
  },
  {
    id: "crib-breath",
    label: "Nursery Wall",
    line: "Listening through the nursery wall for my newborn's breathing, I froze when the slow exhale brushed warm across the back of my own ear.",
    scores: { fright: 8.5, vividness: 8.4, originality: 8.0, craft: 8.9 },
    anatomy: {
      opening: "Listening through the nursery wall for my newborn's breathing,",
      hinge: "I froze when",
      payoff: "the slow exhale brushed warm across the back of my own ear.",
    },
  },
];

function round4(n: number): number {
  return Number(n.toFixed(4));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function weightedScore(s: CriterionScores): number {
  let sum = 0;
  for (const k of CRITERIA_ORDER) sum += s[k] * WEIGHTS[k];
  return round4(sum);
}

function analyzeLine(line: string): LineMetrics {
  const trimmed = line.trim();
  const words = trimmed ? trimmed.split(/\s+/) : [];
  const sentences = trimmed.match(/[^.!?]+[.!?]+(?:["'”’])?/g) ?? [];
  const hasControlOrBreak = /[\x00-\x1f\x7f]/.test(trimmed);
  const endsWithStop = /[.!?]["'”’]?$/.test(trimmed);
  const sha256 = crypto.createHash("sha256").update(trimmed, "utf8").digest("hex");
  return {
    char_count: trimmed.length,
    max_chars: MAX_CHARS,
    under_200: trimmed.length > 0 && trimmed.length <= MAX_CHARS,
    word_count: words.length,
    sentence_count: sentences.length,
    single_sentence:
      trimmed.length > 0 && !hasControlOrBreak && endsWithStop && sentences.length === 1,
    breath_seconds: round4(words.length / 3.4),
    sha256,
  };
}

function validateCandidates(candidates: readonly Candidate[]): void {
  if (candidates.length === 0) throw new Error("No candidates configured.");
  const weightSum = CRITERIA_ORDER.reduce((acc, k) => acc + WEIGHTS[k], 0);
  if (Math.abs(weightSum - 1) > 1e-9) {
    throw new Error(`Criteria weights must sum to 1 (got ${weightSum}).`);
  }
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c.id.trim()) throw new Error("Candidate id must be non-empty.");
    if (seen.has(c.id)) throw new Error(`Duplicate candidate id: ${c.id}`);
    seen.add(c.id);
    if (!c.line.trim()) throw new Error(`Candidate ${c.id} has an empty line.`);
    for (const k of CRITERIA_ORDER) {
      const v = c.scores[k];
      if (!Number.isFinite(v) || v < 0 || v > 10) {
        throw new Error(`Invalid score for ${c.id}.${k}: ${v}`);
      }
    }
  }
}

function comparePair(a: Candidate, b: Candidate): [Candidate, Candidate, number] {
  const scoreA = weightedScore(a.scores);
  const scoreB = weightedScore(b.scores);
  if (scoreA !== scoreB) {
    return scoreA > scoreB
      ? [a, b, round4(scoreA - scoreB)]
      : [b, a, round4(scoreB - scoreA)];
  }
  for (const k of CRITERIA_ORDER) {
    if (a.scores[k] !== b.scores[k]) {
      return a.scores[k] > b.scores[k] ? [a, b, 0] : [b, a, 0];
    }
  }
  return a.id.localeCompare(b.id) <= 0 ? [a, b, 0] : [b, a, 0];
}

function runTournament(candidates: readonly Candidate[]): {
  ranked: RankedCandidate[];
  matchups: Matchup[];
} {
  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const c of candidates) {
    wins.set(c.id, 0);
    losses.set(c.id, 0);
  }

  const matchups: Matchup[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const [winner, loser, margin] = comparePair(a, b);
      wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
      losses.set(loser.id, (losses.get(loser.id) ?? 0) + 1);

      let deciding: CriterionKey = "fright";
      let bestEdge = -Infinity;
      for (const k of CRITERIA_ORDER) {
        const edge = (winner.scores[k] - loser.scores[k]) * WEIGHTS[k];
        if (edge > bestEdge) {
          bestEdge = edge;
          deciding = k;
        }
      }

      matchups.push({
        a: a.id,
        b: b.id,
        winner: winner.id,
        margin,
        deciding_criterion: deciding,
      });
    }
  }

  const ranked: RankedCandidate[] = candidates
    .map((c) => {
      const w = wins.get(c.id) ?? 0;
      const l = losses.get(c.id) ?? 0;
      const total = w + l;
      const line = c.line.trim();
      return {
        id: c.id,
        label: c.label,
        line,
        weighted_score: weightedScore(c.scores),
        pairwise_wins: w,
        pairwise_losses: l,
        win_rate: total > 0 ? round4(w / total) : 0,
        scores: c.scores,
        metrics: analyzeLine(line),
        anatomy: c.anatomy,
      };
    })
    .sort((x, y) => {
      if (y.pairwise_wins !== x.pairwise_wins) return y.pairwise_wins - x.pairwise_wins;
      if (y.weighted_score !== x.weighted_score) return y.weighted_score - x.weighted_score;
      for (const k of CRITERIA_ORDER) {
        if (y.scores[k] !== x.scores[k]) return y.scores[k] - x.scores[k];
      }
      return x.id.localeCompare(y.id);
    });

  return { ranked, matchups };
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function buildCardPng(winner: RankedCandidate): Buffer {
  const width = 480;
  const height = 270;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);

  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = y * stride + 1 + x * 3;
    raw[idx] = r;
    raw[idx + 1] = g;
    raw[idx + 2] = b;
  };

  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    const dy = (y - height / 2) / (height / 2);
    for (let x = 0; x < width; x++) {
      const dx = (x - width / 2) / (width / 2);
      const dist = Math.min(1, Math.hypot(dx, dy));
      const base = Math.round(16 - dist * 10);
      setPx(x, y, base + 4, base, base + 2);
    }
  }

  for (let x = 18; x < width - 18; x++) {
    setPx(x, 18, 165, 24, 38);
    setPx(x, height - 19, 165, 24, 38);
  }
  for (let y = 18; y < height - 18; y++) {
    setPx(18, y, 165, 24, 38);
    setPx(width - 19, y, 165, 24, 38);
  }

  const palette: readonly [number, number, number][] = [
    [210, 32, 48],
    [184, 52, 62],
    [152, 72, 86],
    [126, 94, 112],
  ];
  CRITERIA_ORDER.forEach((key, idx) => {
    const [r, g, b] = palette[idx];
    const y0 = 152 + idx * 22;
    const barW = 380;
    const fillW = Math.round(barW * clamp01(winner.scores[key] / 10));
    for (let y = y0; y < y0 + 10; y++) {
      for (let x = 50; x < 50 + barW; x++) {
        if (x < 50 + fillW) setPx(x, y, r, g, b);
        else setPx(x, y, 36, 26, 30);
      }
    }
  });

  for (let x = 44; x < width - 44; x++) {
    const t = (x - 44) / (width - 88);
    const pulse =
      Math.exp(-Math.pow((t - 0.52) * 18, 2)) * -38 +
      Math.exp(-Math.pow((t - 0.56) * 24, 2)) * 24 +
      Math.sin(t * Math.PI * 10) * 3;
    const cy = Math.round(86 + pulse);
    for (let dy = -1; dy <= 1; dy++) setPx(x, cy + dy, 224, 48, 62);
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxLen: number): string[] {
  const limit = Math.max(1, maxLen);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) current = w;
    else if (current.length + 1 + w.length <= limit) current += " " + w;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function buildCardSvg(winner: RankedCandidate): string {
  const wrapped = wrapText(winner.line, 44);
  const fontSize = wrapped.length > 4 ? 30 : 38;
  const stepY = wrapped.length > 4 ? 42 : 54;
  const textEls = wrapped
    .map(
      (ln, idx) =>
        `  <text x="80" y="${210 + idx * stepY}" fill="#f4ece8" font-size="${fontSize}" font-family="Georgia, serif">${escapeXml(ln)}</text>`
    )
    .join("\n");

  const barEls = CRITERIA_ORDER.map((key, i) => {
    const val = winner.scores[key];
    const y = 435 + i * 36;
    const w = Math.round(clamp01(val / 10) * 680);
    return [
      `  <text x="80" y="${y + 14}" fill="#b79f9a" font-size="14" font-family="monospace">${key.toUpperCase()}</text>`,
      `  <rect x="230" y="${y}" width="680" height="16" rx="3" fill="#23191d" />`,
      `  <rect x="230" y="${y}" width="${w}" height="16" rx="3" fill="#c92a3a" />`,
      `  <text x="930" y="${y + 14}" fill="#f4ece8" font-size="14" font-family="monospace">${val.toFixed(1)}/10</text>`,
    ].join("\n");
  }).join("\n");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`,
    `  <rect width="1200" height="630" fill="#0d090b" />`,
    `  <rect x="32" y="32" width="1136" height="566" fill="none" stroke="#8a1c28" stroke-width="2" />`,
    `  <text x="80" y="96" fill="#d93848" font-size="18" letter-spacing="4" font-family="monospace">ONE LINE, ONE CHILL // ENTRY CARD</text>`,
    `  <text x="80" y="132" fill="#8f7a76" font-size="15" font-family="monospace">${winner.metrics.char_count} / 200 CHARS · 1 SENTENCE · SCORE ${winner.weighted_score.toFixed(2)}</text>`,
    textEls,
    barEls,
    `</svg>`,
    "",
  ].join("\n");
}

function buildDashboardCss(): string {
  return [
    `:root{--bg:#0c090a;--panel:#161013;--line:#2d1d22;--accent:#d42f3f;--text:#f3ece9;--muted:#9f8b87}`,
    `*{box-sizing:border-box}`,
    `body{margin:0;background:var(--bg);color:var(--text);font-family:Georgia,serif;line-height:1.5}`,
    `main{max-width:960px;margin:0 auto;padding:48px 24px 72px}`,
    `.kicker{font-family:monospace;font-size:12px;letter-spacing:.18em;color:var(--accent);text-transform:uppercase}`,
    `blockquote{margin:20px 0 28px;padding:28px 32px;background:var(--panel);border-left:4px solid var(--accent);font-size:30px;line-height:1.35}`,
    `.pills{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:32px}`,
    `.pill{font-family:monospace;font-size:12px;padding:6px 10px;background:var(--panel);border:1px solid var(--line);color:var(--muted)}`,
    `.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-bottom:32px}`,
    `.card{background:var(--panel);border:1px solid var(--line);padding:18px 20px}`,
    `.card h2{margin:0 0 12px;font-family:monospace;font-size:13px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase}`,
    `.bar-row{display:grid;grid-template-columns:105px 1fr 48px;align-items:center;gap:10px;margin:8px 0;font-family:monospace;font-size:12px}`,
    `.track{height:8px;background:#261b1f;overflow:hidden}`,
    `.fill{height:100%;background:var(--accent)}`,
    `table{width:100%;border-collapse:collapse;font-size:14px;background:var(--panel);border:1px solid var(--line)}`,
    `th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}`,
    `th{font-family:monospace;font-size:12px;color:var(--muted);text-transform:uppercase}`,
    `img.preview{width:100%;height:auto;border:1px solid var(--line);margin-top:24px;display:block}`,
    "",
  ].join("\n");
}

function buildDashboardHtml(): string {
  return [
    `<!doctype html>`,
    `<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>One Line, One Chill</title><link rel="stylesheet" href="./style.css" /></head><body><main>`,
    `<div class="kicker">One Line, One Chill // Finalist Dossier</div><blockquote id="entry-line"></blockquote>`,
    `<div class="pills" id="entry-pills"></div>`,
    `<div class="grid"><section class="card"><h2>Judge Criteria</h2><div id="criteria-bars"></div></section>`,
    `<section class="card"><h2>Sentence Anatomy</h2><div id="anatomy-box"></div></section></div>`,
    `<section class="card"><h2>Internal Pairwise Tournament</h2>`,
    `<table><thead><tr><th>#</th><th>Label</th><th>Chars</th><th>W-L</th><th>Score</th></tr></thead><tbody id="ranking-body"></tbody></table></section>`,
    `<img class="preview" src="../screenshots/preview.svg" alt="Entry Card Preview" /></main>`,
    `<script src="../data.js"></script><script>(function(){`,
    `const d=window.__ONE_LINE_DATA__;if(!d||!d.board||!d.dossier)return;const b=d.board;`,
    `const byId=function(id){return document.getElementById(id);};`,
    `byId("entry-line").textContent=b.line;`,
    `const pills=[b.char_count+" / 200 chars",b.single_sentence?"1 sentence":"invalid","~ "+b.breath_seconds+"s breath","score "+b.weighted_score.toFixed(2),"sha256 "+b.fingerprint_sha256.slice(0,12)];`,
    `const pillEl=byId("entry-pills");pills.forEach(function(t){const s=document.createElement("span");s.className="pill";s.textContent=t;pillEl.appendChild(s);});`,
    `const barsEl=byId("criteria-bars");["fright","vividness","originality","craft"].forEach(function(k){`,
    `const row=document.createElement("div");row.className="bar-row";`,
    `const lbl=document.createElement("span");lbl.textContent=k.toUpperCase();`,
    `const trk=document.createElement("div");trk.className="track";`,
    `const fl=document.createElement("div");fl.className="fill";fl.style.width=Math.max(0,Math.min(100,b.criteria[k]*10))+"%";`,
    `const val=document.createElement("span");val.textContent=b.criteria[k].toFixed(1);`,
    `trk.appendChild(fl);row.append(lbl,trk,val);barsEl.appendChild(row);});`,
    `const anat=byId("anatomy-box"),a=d.dossier.entry.anatomy;`,
    `[["Opening",a.opening],["Hinge",a.hinge],["Payoff",a.payoff]].forEach(function(pair){const p=document.createElement("p");p.textContent=pair[0]+": "+pair[1];anat.appendChild(p);});`,
    `const tbody=byId("ranking-body");d.dossier.candidates.forEach(function(c,i){const tr=document.createElement("tr");`,
    `[String(i+1),c.label,String(c.metrics.char_count),c.pairwise_wins+"-"+c.pairwise_losses,c.weighted_score.toFixed(2)].forEach(function(v){const td=document.createElement("td");td.textContent=v;tr.appendChild(td);});`,
    `tbody.appendChild(tr);});})();</script></body></html>`,
    "",
  ].join("\n");
}

function escapeScriptJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function main(): void {
  validateCandidates(CANDIDATES);
  const { ranked, matchups } = runTournament(CANDIDATES);
  const winner = ranked[0];
  if (!winner.metrics.under_200 || !winner.metrics.single_sentence) {
    throw new Error(`Winning entry "${winner.id}" failed brief constraints.`);
  }

  const rawOutDir = (process.env.MAKEFUN_OUTPUT_DIR ?? "").trim();
  const outDir = path.resolve(rawOutDir || "out");
  const dashboardDir = path.join(outDir, "dashboard");
  const screenshotsDir = path.join(outDir, "screenshots");
  fs.mkdirSync(dashboardDir, { recursive: true });
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const board = {
    bounty_id: BOUNTY_ID,
    bounty_name: BOUNTY_NAME,
    entry_id: winner.id,
    label: winner.label,
    line: winner.line,
    char_count: winner.metrics.char_count,
    max_chars: MAX_CHARS,
    under_200: winner.metrics.under_200,
    single_sentence: winner.metrics.single_sentence,
    word_count: winner.metrics.word_count,
    breath_seconds: winner.metrics.breath_seconds,
    weighted_score: winner.weighted_score,
    pairwise_wins: winner.pairwise_wins,
    pairwise_losses: winner.pairwise_losses,
    criteria: winner.scores,
    weights: WEIGHTS,
    valid: winner.metrics.under_200 && winner.metrics.single_sentence,
    fingerprint_sha256: winner.metrics.sha256,
  };

  const dossier = {
    schema: "one-line-one-chill/1",
    bounty: {
      id: BOUNTY_ID,
      name: BOUNTY_NAME,
      criteria_priority: [...CRITERIA_ORDER],
      weights: WEIGHTS,
    },
    entry: winner,
    validation: {
      under_200_chars: winner.metrics.under_200,
      single_sentence: winner.metrics.single_sentence,
      deterministic: true,
      network_calls: 0,
    },
    candidates: ranked,
    pairwise_matches: matchups,
    artifacts: [
      "line.txt",
      "board.json",
      "dossier.json",
      "data.js",
      "dashboard/index.html",
      "dashboard/style.css",
      "screenshots/card.png",
      "screenshots/preview.svg",
    ],
  };

  const dataJs = `window.__ONE_LINE_DATA__ = ${escapeScriptJson({ board, dossier })};\n`;
  fs.writeFileSync(path.join(outDir, "line.txt"), `${winner.line}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "board.json"), `${JSON.stringify(board, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "dossier.json"), `${JSON.stringify(dossier, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "data.js"), dataJs, "utf8");
  fs.writeFileSync(path.join(dashboardDir, "index.html"), buildDashboardHtml(), "utf8");
  fs.writeFileSync(path.join(dashboardDir, "style.css"), buildDashboardCss(), "utf8");
  fs.writeFileSync(path.join(screenshotsDir, "card.png"), buildCardPng(winner));
  fs.writeFileSync(path.join(screenshotsDir, "preview.svg"), buildCardSvg(winner), "utf8");

  process.stdout.write(
    `Wrote entry (${winner.metrics.char_count} chars, score ${winner.weighted_score.toFixed(2)}, sha256 ${winner.metrics.sha256.slice(0, 12)})\n`
  );
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exitCode = 1;
}