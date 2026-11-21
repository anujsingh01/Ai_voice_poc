// Parsing and checking candidate lists (CSV exported from Excel or an ATS).

export type CandidateInput = { name: string; phone: string | null; email: string | null; language: string | null };
export type RowProblem = { row: number; message: string };

/** Indian mobile numbers to E.164 (+91XXXXXXXXXX). Returns null if it isn't a valid mobile number. */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '');
  const m = /^(?:\+91|0091|91|0)?([6-9]\d{9})$/.exec(digits);
  return m ? `+91${m[1]}` : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Name to greet someone by: "Priya Rao" → "Priya", "Rao, Priya" → "Priya". */
export function firstName(name: string) {
  const n = name.includes(',') ? name.split(',').slice(1).join(' ') : name;
  return n.trim().split(/\s+/)[0] || name.trim();
}

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  const src = text.replace(/^﻿/, '');   // Excel adds a byte-order mark
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim()));
}

const HEADER_ALIASES: Record<string, keyof CandidateInput> = {
  name: 'name', 'full name': 'name', candidate: 'name', 'candidate name': 'name',
  phone: 'phone', mobile: 'phone', 'mobile number': 'phone', 'phone number': 'phone', whatsapp: 'phone',
  email: 'email', 'email address': 'email', 'e-mail': 'email',
  language: 'language', 'preferred language': 'language',
};

export function readCandidates(csv: string, allowedLanguages: string[], maxRows = 5000) {
  const problems: RowProblem[] = [];
  const rows = parseCsv(csv);
  if (!rows.length) return { candidates: [], problems: [{ row: 1, message: 'The file is empty.' }] };
  const cols = rows[0].map(h => HEADER_ALIASES[h.trim().toLowerCase()]);
  if (!cols.includes('name') || (!cols.includes('phone') && !cols.includes('email'))) {
    return { candidates: [], problems: [{ row: 1, message: 'The first row must be headings including "name" and "phone" or "email".' }] };
  }
  if (rows.length - 1 > maxRows) return { candidates: [], problems: [{ row: 1, message: `More than ${maxRows} candidates; split the file.` }] };

  const candidates: (CandidateInput & { row: number })[] = [];
  rows.slice(1).forEach((r, i) => {
    const row = i + 2;
    const get = (k: keyof CandidateInput) => (cols.indexOf(k) >= 0 ? (r[cols.indexOf(k)] ?? '').trim() : '');
    const name = get('name');
    const rawPhone = get('phone'), rawEmail = get('email').toLowerCase(), rawLang = get('language').toLowerCase();
    const phone = rawPhone ? normalisePhone(rawPhone) : null;
    const email = rawEmail || null;
    if (!name || name.length > 120) return problems.push({ row, message: 'Name is missing or too long.' });
    if (rawPhone && !phone) return problems.push({ row, message: `"${rawPhone}" is not a valid Indian mobile number.` });
    if (email && !EMAIL.test(email)) return problems.push({ row, message: `"${rawEmail}" is not a valid email address.` });
    if (!phone && !email) return problems.push({ row, message: 'Needs a phone number or an email.' });
    const language = rawLang && allowedLanguages.includes(rawLang) ? rawLang : null;
    candidates.push({ row, name, phone, email, language });
  });
  return { candidates, problems };
}
