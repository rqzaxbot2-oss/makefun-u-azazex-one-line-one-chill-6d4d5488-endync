export interface DimensionScores {
  fright: number;
  vividness: number;
  originality: number;
  craft: number;
}

export interface ScoreWeights {
  fright: number;
  vividness: number;
  originality: number;
  craft: number;
}

export interface CandidateLine {
  id: string;
  text: string;
  motif?: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: string[];
  charCount: number;
  wordCount: number;
}

export interface LineEvaluation {
  id: string;
  text: string;
  valid: boolean;
  violations: string[];
  charCount: number;
  wordCount: number;
  dimensions: DimensionScores;
  composite: number;
}

export interface PairwiseComparison {
  aId: string;
  bId: string;
  winnerId: string | null;
  loserId: string | null;
  margin: number;
  tie: boolean;
}

export interface RankedCandidate {
  rank: number;
  id: string;
  text: string;
  evaluation: LineEvaluation;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  elo: number;
  bradleyTerry: number;
  finalScore: number;
}

export interface CorpusStats {
  docCount: number;
  docFreq: Map<string, number>;
}

export const MAX_CHARS = 199;
export const MIN_CHARS = 24;

export const DEFAULT_WEIGHTS: ScoreWeights = {
  fright: 0.4,
  vividness: 0.25,
  originality: 0.2,
  craft: 0.15,
};

const DREAD_WORDS = new Set([
  "breathing", "breath", "whisper", "whispered", "whispering", "smiling", "smiled",
  "blink", "blinked", "blinking", "footsteps", "mirror", "reflection", "knocking",
  "knocked", "scratching", "scratched", "teeth", "shadow", "shadows", "voice",
  "voices", "eyes", "skin", "grave", "coffin", "monitor", "heartbeat", "pulse",
  "closet", "basement", "attic", "window", "corpse", "dead", "buried", "crying",
  "screaming", "watching", "staring", "crawling", "knuckles", "throat", "neck",
  "pillow", "mattress", "bed", "crib", "hallway", "doorway", "lock", "locked",
  "unlocked", "dark", "darkness", "silence", "silent", "alone", "tucked", "nails",
  "fingernails", "lid", "eyelids", "mouth", "jaw", "blood", "bones", "teeth",
  "cold", "warm", "alive", "wake", "woke", "sleep", "sleeping", "asleep", "died",
]);

const INTIMATE_ANCHORS = new Set([
  "my", "me", "i", "you", "your", "our", "mother", "mom", "dad", "father",
  "daughter", "son", "baby", "child", "wife", "husband", "sister", "brother",
  "bedroom", "crib", "mirror", "pillow", "bed", "blanket", "home", "house",
]);

const SENSORY_WORDS = new Set([
  "wet", "damp", "cold", "warm", "clammy", "pale", "hollow", "clicking", "scraping",
  "creaking", "dripping", "flickering", "rusted", "metallic", "sour", "bitter",
  "trembling", "jagged", "smeared", "fogged", "breathless", "heavy", "sharp",
  "ragged", "rasping", "cracked", "splintered", "soggy", "slick", "grey", "gray",
  "black", "red", "white", "yellow", "glass", "wood", "iron", "dust", "mud",
  "salt", "sweat", "ash", "frost", "steam", "static", "hum", "hiss", "thud",
  "tap", "tapping", "scuff", "scratches", "fingerprints", "teeth", "tongue",
  "eyelids", "knuckles", "collarbone", "ribs", "wrist", "ankle", "throat",
]);

const HINGE_WORDS = new Set([
  "until", "except", "when", "still", "never", "only", "already", "since",
  "again", "back", "inside", "underneath", "behind", "beneath", "before",
  "after", "instead", "though", "yet", "but", "while", "ours", "mine",
]);

const WEAK_ENDINGS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
  "with", "that", "this", "it", "very", "really", "just", "some", "thing",
]);

const ABSTRACT_FILLER = new Set([
  "scary", "terrifying", "horrifying", "creepy", "spooky", "frightening",
  "eerie", "weird", "strange", "horrible", "awful", "terrible", "evil",
  "suddenly", "somehow", "something", "anything", "everything", "very", "really",
]);

const CLICHE_PATTERNS: RegExp[] = [
  /\bfrom inside the house\b/i,
  /\bdon'?t look behind you\b/i,
  /\bit was me\b/i,
  /\ball along\b/i,
  /\bjust a dream\b/i,
  /\bnobody was there\b/i,
  /\bno one was there\b/i,
  /\bdead all along\b/i,
  /\bghost|vampire|zombie|werewolf|demon|monster\b/i,
  /\bboo\b/i,
  /\bturning around\b/i,
  /\bdark and stormy\b/i,
];

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9'\s-]/g, " ");
  return cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length > 0);
}

function countSentences(text: string): number {
  const normalized = text
    .trim()
    .replace(/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr)\./gi, "ABBR")
    .replace(/\b(?:a|p)\.m\./gi, "TIME")
    .replace(/\.{3,}/g, "—");
  const stripped = normalized.replace(/["'”’)\]]+$/g, "").trim();
  const internalBreaks = stripped.match(/[.!?]+(?:\s+["'“‘(\[]*[A-Za-z0-9])/g);
  return 1 + (internalBreaks ? internalBreaks.length : 0);
}

export function validateLine(text: string): ValidationResult {
  const trimmed = text.trim();
  const violations: string[] = [];
  const charCount = trimmed.length;
  const tokens = tokenize(trimmed);
  const wordCount = tokens.length;

  if (charCount === 0) violations.push("empty");
  if (charCount > MAX_CHARS) violations.push(`exceeds_${MAX_CHARS}_chars`);
  if (charCount > 0 && charCount < MIN_CHARS) violations.push(`under_${MIN_CHARS}_chars`);
  if (/[\r\n]/.test(trimmed)) violations.push("contains_newline");
  if (charCount > 0 && countSentences(trimmed) > 1) violations.push("multiple_sentences");
  if (charCount > 0 && !/[.!?]["'”’)\]]*$/.test(trimmed)) {
    violations.push("missing_terminal_punctuation");
  }
  if (wordCount < 5) violations.push("too_few_words");

  return {
    valid: violations.length === 0,
    violations,
    charCount,
    wordCount,
  };
}

export function buildCorpusStats(candidates: CandidateLine[]): CorpusStats {
  const docFreq = new Map<string, number>();
  for (const c of candidates) {
    const unique = new Set(tokenize(c.text));
    for (const token of unique) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  return { docCount: candidates.length, docFreq };
}

export function scoreFright(text: string, tokens: string[]): number {
  const n = Math.max(1, tokens.length);
  const halfIndex = Math.floor(n / 2);

  let dreadHits = 0;
  let lateDreadHits = 0;
  let intimateHits = 0;
  const seenDread = new Set<string>();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (DREAD_WORDS.has(tok) && !seenDread.has(tok)) {
      seenDread.add(tok);
      dreadHits += 1;
      if (i >= halfIndex) lateDreadHits += 1;
    }
    if (INTIMATE_ANCHORS.has(tok)) {
      intimateHits += 1;
    }
  }

  const dreadCore = Math.min(1, dreadHits / 3.5) * 42;
  const latePunch = Math.min(1, lateDreadHits / 2) * 24;
  const intimacy = Math.min(1, intimateHits / 2.5) * 18;

  const hasNegationOrInversion =
    /\b(?:never|no|not|isn't|wasn't|didn't|couldn't|won't|stopped|empty|missing|wrong|already|still)\b/i.test(text);
  const inversionScore = hasNegationOrInversion ? 10 : 0;

  const hasDirectSpeechOrClock = /["“”]|:\d\d\b|\b(?:midnight|3\s*a\.?m\.?|night|morning)\b/i.test(text);
  const immediacyScore = hasDirectSpeechOrClock ? 6 : 0;

  let fillerPenalty = 0;
  for (const tok of tokens) {
    if (ABSTRACT_FILLER.has(tok)) fillerPenalty += 6;
  }

  return round4(clamp(dreadCore + latePunch + intimacy + inversionScore + immediacyScore - fillerPenalty, 0, 100));
}

export function scoreVividness(text: string, tokens: string[]): number {
  const n = Math.max(1, tokens.length);
  const uniqueSensory = new Set<string>();
  let abstractCount = 0;

  for (const tok of tokens) {
    if (SENSORY_WORDS.has(tok)) uniqueSensory.add(tok);
    if (ABSTRACT_FILLER.has(tok)) abstractCount += 1;
  }

  const sensoryCore = Math.min(1, uniqueSensory.size / 3.2) * 52;
  const concreteDensity = Math.min(1, (uniqueSensory.size / n) * 5.5) * 20;

  const hasActionVerbs =
    /\b[a-z]{4,}(?:ed|ing)\b/i.test(text) && !/\b(?:was|were|is|are)\s+(?:being|very|really)\b/i.test(text);
  const verbScore = hasActionVerbs ? 16 : 6;

  const hasSpecificDetail = /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|left|right|second|third|under|inside|against)\b/i.test(text);
  const detailScore = hasSpecificDetail ? 12 : 4;

  const penalty = abstractCount * 8;
  return round4(clamp(sensoryCore + concreteDensity + verbScore + detailScore - penalty, 0, 100));
}

export function scoreOriginality(
  text: string,
  tokens: string[],
  corpusStats?: CorpusStats,
): number {
  const n = Math.max(1, tokens.length);
  const uniqueTokens = new Set(tokens);
  const ttr = uniqueTokens.size / n;

  let clichePenalty = 0;
  for (const pat of CLICHE_PATTERNS) {
    if (pat.test(text)) clichePenalty += 18;
  }

  let tellerPenalty = 0;
  for (const tok of tokens) {
    if (ABSTRACT_FILLER.has(tok)) tellerPenalty += 7;
  }

  let idfScore = 50;
  if (corpusStats && corpusStats.docCount > 1) {
    let sumIdf = 0;
    const maxIdf = Math.log(corpusStats.docCount + 1);
    for (const tok of uniqueTokens) {
      const df = corpusStats.docFreq.get(tok) ?? 1;
      sumIdf += Math.log((corpusStats.docCount + 1) / df);
    }
    const avgIdf = sumIdf / Math.max(1, uniqueTokens.size);
    idfScore = clamp((avgIdf / Math.max(0.01, maxIdf)) * 75, 0, 75);
  } else {
    const longDistinct = [...uniqueTokens].filter((t) => t.length >= 6).length;
    idfScore = clamp((longDistinct / n) * 140, 20, 68);
  }

  const diversityScore = clamp((ttr - 0.55) / 0.45, 0, 1) * 25;
  return round4(clamp(idfScore + diversityScore - clichePenalty - tellerPenalty, 0, 100));
}

export function scoreCraft(text: string, tokens: string[]): number {
  const trimmed = text.trim();
  const len = trimmed.length;
  const n = tokens.length;

  let lengthScore = 0;
  if (len >= 65 && len <= 155) {
    lengthScore = 30;
  } else if (len >= 40 && len <= MAX_CHARS) {
    const dist = len < 65 ? 65 - len : len - 155;
    lengthScore = clamp(30 - dist * 0.45, 10, 30);
  } else {
    lengthScore = 5;
  }

  let cadenceScore = 0;
  if (n >= 12 && n <= 28) {
    cadenceScore = 22;
  } else if (n >= 8 && n <= 36) {
    cadenceScore = 14;
  } else {
    cadenceScore = 6;
  }

  let hingeScore = 4;
  const pivotStart = Math.floor(n * 0.25);
  const pivotEnd = Math.ceil(n * 0.85);
  for (let i = pivotStart; i < Math.min(n, pivotEnd); i++) {
    if (HINGE_WORDS.has(tokens[i])) {
      hingeScore = 20;
      break;
    }
  }
  if (hingeScore < 20 && /[,;—:]/.test(trimmed)) {
    hingeScore = 16;
  }

  const lastToken = tokens[n - 1] ?? "";
  let endingScore = 10;
  if (lastToken.length >= 4 && !WEAK_ENDINGS.has(lastToken)) {
    endingScore = 18;
    if (DREAD_WORDS.has(lastToken) || SENSORY_WORDS.has(lastToken)) {
      endingScore = 22;
    }
  } else if (WEAK_ENDINGS.has(lastToken)) {
    endingScore = 4;
  }

  const punctuationClean = !/!!|\?\?|;;|,,|\s[,.;:!?]/.test(trimmed);
  const polishScore = punctuationClean ? 6 : 0;

  return round4(clamp(lengthScore + cadenceScore + hingeScore + endingScore + polishScore, 0, 100));
}

export function computeComposite(
  dimensions: DimensionScores,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const totalWeight =
    weights.fright + weights.vividness + weights.originality + weights.craft;
  const norm = totalWeight > 0 ? totalWeight : 1;
  const raw =
    (dimensions.fright * weights.fright +
      dimensions.vividness * weights.vividness +
      dimensions.originality * weights.originality +
      dimensions.craft * weights.craft) /
    norm;
  return round4(clamp(raw, 0, 100));
}

export function evaluateLine(
  candidate: CandidateLine,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
  corpusStats?: CorpusStats,
): LineEvaluation {
  const validation = validateLine(candidate.text);
  const tokens = tokenize(candidate.text);

  const dimensions: DimensionScores = validation.valid
    ? {
        fright: scoreFright(candidate.text, tokens),
        vividness: scoreVividness(candidate.text, tokens),
        originality: scoreOriginality(candidate.text, tokens, corpusStats),
        craft: scoreCraft(candidate.text, tokens),
      }
    : { fright: 0, vividness: 0, originality: 0, craft: 0 };

  const composite = validation.valid ? computeComposite(dimensions, weights) : 0;

  return {
    id: candidate.id,
    text: candidate.text.trim(),
    valid: validation.valid,
    violations: validation.violations,
    charCount: validation.charCount,
    wordCount: validation.wordCount,
    dimensions,
    composite,
  };
}

export function evaluateCorpus(
  candidates: CandidateLine[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): LineEvaluation[] {
  const stats = buildCorpusStats(candidates);
  return candidates.map((c) => evaluateLine(c, weights, stats));
}

export function compareLines(
  a: LineEvaluation,
  b: LineEvaluation,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): PairwiseComparison {
  if (a.valid !== b.valid) {
    const winner = a.valid ? a : b;
    const loser = a.valid ? b : a;
    return {
      aId: a.id,
      bId: b.id,
      winnerId: winner.id,
      loserId: loser.id,
      margin: 100,
      tie: false,
    };
  }

  const diffFright = a.dimensions.fright - b.dimensions.fright;
  const diffVivid = a.dimensions.vividness - b.dimensions.vividness;
  const diffOrig = a.dimensions.originality - b.dimensions.originality;
  const diffCraft = a.dimensions.craft - b.dimensions.craft;

  const weightedDiff =
    diffFright * weights.fright +
    diffVivid * weights.vividness +
    diffOrig * weights.originality +
    diffCraft * weights.craft;

  const tieEpsilon = 0.25;
  if (Math.abs(weightedDiff) <= tieEpsilon) {
    const cascade = [diffFright, diffVivid, diffOrig, diffCraft];
    for (const d of cascade) {
      if (Math.abs(d) > 0.5) {
        const winner = d > 0 ? a : b;
        const loser = d > 0 ? b : a;
        return {
          aId: a.id,
          bId: b.id,
          winnerId: winner.id,
          loserId: loser.id,
          margin: round4(Math.abs(d)),
          tie: false,
        };
      }
    }
    return {
      aId: a.id,
      bId: b.id,
      winnerId: null,
      loserId: null,
      margin: 0,
      tie: true,
    };
  }

  const winner = weightedDiff > 0 ? a : b;
  const loser = weightedDiff > 0 ? b : a;
  return {
    aId: a.id,
    bId: b.id,
    winnerId: winner.id,
    loserId: loser.id,
    margin: round4(Math.abs(weightedDiff)),
    tie: false,
  };
}

export function runRoundRobin(
  evaluations: LineEvaluation[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): PairwiseComparison[] {
  const ordered = [...evaluations].sort((x, y) => x.id.localeCompare(y.id));
  const results: PairwiseComparison[] = [];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      results.push(compareLines(ordered[i], ordered[j], weights));
    }
  }
  return results;
}

export function computeEloRatings(
  ids: string[],
  comparisons: PairwiseComparison[],
  initialRating = 1500,
  kFactor = 32,
  passes = 16,
): Map<string, number> {
  const ratings = new Map<string, number>();
  for (const id of ids) {
    ratings.set(id, initialRating);
  }
  if (ids.length <= 1 || comparisons.length === 0) return ratings;

  const stepScale = kFactor / Math.max(1, ids.length - 1);

  for (let p = 0; p < passes; p++) {
    const deltas = new Map<string, number>();
    for (const id of ids) deltas.set(id, 0);

    for (const cmp of comparisons) {
      const ra = ratings.get(cmp.aId) ?? initialRating;
      const rb = ratings.get(cmp.bId) ?? initialRating;
      const expectedA = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const scoreA = cmp.tie ? 0.5 : cmp.winnerId === cmp.aId ? 1 : 0;
      const deltaA = stepScale * (scoreA - expectedA);

      deltas.set(cmp.aId, (deltas.get(cmp.aId) ?? 0) + deltaA);
      deltas.set(cmp.bId, (deltas.get(cmp.bId) ?? 0) - deltaA);
    }

    for (const id of ids) {
      ratings.set(id, (ratings.get(id) ?? initialRating) + (deltas.get(id) ?? 0));
    }
  }

  for (const id of ids) {
    ratings.set(id, round4(ratings.get(id) ?? initialRating));
  }
  return ratings;
}

export function computeBradleyTerry(
  ids: string[],
  comparisons: PairwiseComparison[],
  iterations = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  const n = ids.length;
  if (n === 0) return scores;
  if (n === 1) {
    scores.set(ids[0], 50);
    return scores;
  }

  const indexOf = new Map<string, number>();
  ids.forEach((id, idx) => indexOf.set(id, idx));

  const wins: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const games: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (const cmp of comparisons) {
    const i = indexOf.get(cmp.aId);
    const j = indexOf.get(cmp.bId);
    if (i === undefined || j === undefined || i === j) continue;
    games[i][j] += 1;
    games[j][i] += 1;
    if (cmp.tie) {
      wins[i][j] += 0.5;
      wins[j][i] += 0.5;
    } else if (cmp.winnerId === cmp.aId) {
      wins[i][j] += 1;
    } else {
      wins[j][i] += 1;
    }
  }

  const prior = 0.05;
  let strength = Array(n).fill(1);

  for (let iter = 0; iter < iterations; iter++) {
    const next = Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      let wSum = 0;
      let denom = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const nij = games[i][j] + 2 * prior;
        wSum += wins[i][j] + prior;
        denom += nij / (strength[i] + strength[j]);
      }
      next[i] = denom > 0 ? wSum / denom : 1;
    }
    let logSum = 0;
    for (let i = 0; i < n; i++) logSum += Math.log(Math.max(1e-12, next[i]));
    const geoMean = Math.exp(logSum / n);
    strength = next.map((v) => v / geoMean);
  }

  for (let i = 0; i < n; i++) {
    const probScale = (100 * strength[i]) / (1 + strength[i]);
    scores.set(ids[i], round4(probScale));
  }
  return scores;
}

export function rankCandidates(
  candidates: CandidateLine[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): RankedCandidate[] {
  if (candidates.length === 0) return [];

  const evaluations = evaluateCorpus(candidates, weights);
  const comparisons = runRoundRobin(evaluations, weights);
  const ids = evaluations.map((e) => e.id).sort((a, b) => a.localeCompare(b));
  const eloMap = computeEloRatings(ids, comparisons);
  const btMap = computeBradleyTerry(ids, comparisons);

  const tally = new Map<string, { wins: number; losses: number; ties: number }>();
  for (const id of ids) tally.set(id, { wins: 0, losses: 0, ties: 0 });

  for (const cmp of comparisons) {
    const ta = tally.get(cmp.aId);
    const tb = tally.get(cmp.bId);
    if (!ta || !tb) continue;
    if (cmp.tie) {
      ta.ties += 1;
      tb.ties += 1;
    } else if (cmp.winnerId === cmp.aId) {
      ta.wins += 1;
      tb.losses += 1;
    } else {
      tb.wins += 1;
      ta.losses += 1;
    }
  }

  const ranked: RankedCandidate[] = evaluations.map((evaluation) => {
    const t = tally.get(evaluation.id) ?? { wins: 0, losses: 0, ties: 0 };
    const total = t.wins + t.losses + t.ties;
    const winRate = total > 0 ? round4((t.wins + 0.5 * t.ties) / total) : 0;
    const elo = eloMap.get(evaluation.id) ?? 1500;
    const bradleyTerry = btMap.get(evaluation.id) ?? 50;
    const eloNorm = clamp((elo - 1300) / 4, 0, 100);
    const finalScore = evaluation.valid
      ? round4(0.45 * bradleyTerry + 0.3 * evaluation.composite + 0.25 * eloNorm)
      : 0;

    return {
      rank: 0,
      id: evaluation.id,
      text: evaluation.text,
      evaluation,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      winRate,
      elo,
      bradleyTerry,
      finalScore,
    };
  });

  ranked.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.bradleyTerry !== a.bradleyTerry) return b.bradleyTerry - a.bradleyTerry;
    if (b.evaluation.dimensions.fright !== a.evaluation.dimensions.fright) {
      return b.evaluation.dimensions.fright - a.evaluation.dimensions.fright;
    }
    return a.id.localeCompare(b.id);
  });

  ranked.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  return ranked;
}