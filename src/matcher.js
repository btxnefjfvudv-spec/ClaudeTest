const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

export function normalizeCode(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/\s+/g, '')
    .toUpperCase();
}

export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function levenshtein(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const cur = [i];
    for (let j = 1; j <= t.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[t.length];
}

export function similarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const longest = Math.max(Array.from(x).length, Array.from(y).length);
  return 1 - levenshtein(x, y) / longest;
}

export const MatchKind = Object.freeze({
  EXACT_CODE: 'EXACT_CODE',
  EXACT_NAME: 'EXACT_NAME',
  CODE_NAME_MISMATCH: 'CODE_NAME_MISMATCH',
  AMBIGUOUS: 'AMBIGUOUS',
  SIMILAR_ONLY: 'SIMILAR_ONLY',
  NOT_FOUND: 'NOT_FOUND',
});

export const CONFIRMED_KINDS = new Set([MatchKind.EXACT_CODE, MatchKind.EXACT_NAME]);

function similarCandidates(wanted, siteCourses) {
  const out = [];
  for (const c of siteCourses) {
    let score = 0;
    if (wanted.name) {
      score = similarity(wanted.name, c.name);
      const a = normalizeName(wanted.name);
      const b = normalizeName(c.name);
      if (a && b && (a.includes(b) || b.includes(a))) score = Math.max(score, 0.7);
    }
    if (wanted.code && levenshtein(normalizeCode(wanted.code), normalizeCode(c.code)) <= 1) {
      score = Math.max(score, 0.8);
    }
    if (score >= 0.6) out.push({ course: c, score: Math.round(score * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.course);
}

/**
 * จับคู่วิชาที่ผู้ใช้ต้องการกับรายการบนเว็บ
 * - มีรหัส: ใช้รหัสเป็นหลัก ถ้าระบุชื่อด้วยแล้วชื่อไม่ตรง จะไม่ยืนยันอัตโนมัติ
 * - ไม่มีรหัส: ชื่อต้องตรงกันทุกตัวอักษร (ไม่สนช่องว่าง/ตัวพิมพ์)
 * - ชื่อใกล้เคียงจะถูกเสนอเป็นตัวเลือก แต่ไม่ถูกเลือกให้เอง
 */
export function matchCourse(wanted, siteCourses) {
  const code = normalizeCode(wanted.code);
  const name = normalizeName(wanted.name);
  let hits;

  if (code) {
    hits = siteCourses.filter((c) => normalizeCode(c.code) === code);
  } else if (name) {
    hits = siteCourses.filter((c) => normalizeName(c.name) === name);
  } else {
    return { kind: MatchKind.NOT_FOUND, course: null, candidates: [] };
  }

  if (wanted.seq != null && String(wanted.seq).trim() !== '') {
    hits = hits.filter((c) => String(c.seq) === String(wanted.seq).trim());
  }

  if (hits.length === 0) {
    const candidates = similarCandidates(wanted, siteCourses);
    return {
      kind: candidates.length ? MatchKind.SIMILAR_ONLY : MatchKind.NOT_FOUND,
      course: null,
      candidates,
    };
  }
  if (hits.length > 1) {
    return { kind: MatchKind.AMBIGUOUS, course: null, candidates: hits };
  }

  const hit = hits[0];
  if (code && name && normalizeName(hit.name) !== name) {
    return { kind: MatchKind.CODE_NAME_MISMATCH, course: null, candidates: [hit] };
  }
  return { kind: code ? MatchKind.EXACT_CODE : MatchKind.EXACT_NAME, course: hit, candidates: [] };
}
