import ExcelJS from 'exceljs';
import { languageName } from './languages';

// The question bank spreadsheet: one row per question or customer objection.
// Text columns are text_<language code>, e.g. text_hi, text_en, text_ta.

export type QuestionRow = {
  code: string; type: 'question' | 'objection'; category: string; weight: number;
  texts: Record<string, string>; good_answer: string; average_answer: string; poor_answer: string;
  must_mention: string[]; knockout: boolean; knockout_rule: string | null;
};
export type SheetError = { row: number | null; column: string | null; message: string };

const FIXED_BEFORE = ['question_id', 'type', 'category', 'weight'] as const;
const FIXED_AFTER = ['good_answer', 'average_answer', 'poor_answer', 'must_mention', 'knockout', 'knockout_rule'] as const;
const MAX_ROWS = 500;

const columnsFor = (languages: string[]) => [...FIXED_BEFORE, ...languages.map(l => `text_${l}`), ...FIXED_AFTER];

const EXAMPLES: QuestionRow[] = [
  {
    code: 'Q01', type: 'question', category: 'Field work readiness', weight: 1,
    texts: { en: 'This job involves visiting customers' + "'" + ' homes every day. Are you comfortable with field work?', hi: 'इस नौकरी में रोज़ ग्राहकों के घर जाना होता है। क्या आप फ़ील्ड वर्क के लिए तैयार हैं?' },
    good_answer: 'Yes, clearly willing, gives an example of past field or outdoor work and how they managed travel.',
    average_answer: 'Yes, but without any detail or example.',
    poor_answer: 'Hesitant, wants an office job, or says no.',
    must_mention: [], knockout: true, knockout_rule: 'Candidate must clearly say yes to daily field work.',
  },
  {
    code: 'OBJ01', type: 'objection', category: 'Price objection', weight: 3,
    texts: { en: 'Customer: "Your pressure cooker is too expensive. The local brand is half the price." What do you say?', hi: 'ग्राहक: "आपका प्रेशर कुकर बहुत महँगा है। लोकल ब्रांड आधे दाम में मिलता है।" आप क्या कहेंगे?' },
    good_answer: 'Acknowledges the concern, explains safety features and long life, warranty and service network, compares cost over years, offers EMI or an exchange offer, asks a closing question.',
    average_answer: 'Mentions quality or warranty but does not connect it to the customer' + "'" + 's concern or try to close.',
    poor_answer: 'Argues with the customer, runs down the other brand, or immediately offers a discount with no reason.',
    must_mention: ['safety', 'warranty', 'long life'], knockout: false, knockout_rule: null,
  },
];

function rowValues(q: QuestionRow, languages: string[]) {
  return [q.code, q.type, q.category, q.weight, ...languages.map(l => q.texts[l] ?? ''),
    q.good_answer, q.average_answer, q.poor_answer, q.must_mention.join(', '), q.knockout ? 'yes' : 'no', q.knockout_rule ?? ''];
}

/** Builds the Excel file: the template (with examples) or an export of an existing version. */
export async function buildSheet(languages: string[], rows?: QuestionRow[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Interview Platform';
  const ws = wb.addWorksheet('Questions', { views: [{ state: 'frozen', ySplit: 1 }] });
  const cols = columnsFor(languages);
  ws.columns = cols.map(c => ({ header: c, key: c, width: c.startsWith('text_') || c.endsWith('answer') ? 50 : c === 'knockout_rule' ? 36 : 16 }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
  for (const q of rows ?? EXAMPLES) ws.addRow(rowValues(q, languages));
  ws.eachRow((r, i) => { if (i > 1) r.alignment = { wrapText: true, vertical: 'top' }; });
  const typeCol = ws.getColumn('type').letter, koCol = ws.getColumn('knockout').letter, wCol = ws.getColumn('weight').letter;
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    ws.getCell(`${typeCol}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"question,objection"'] };
    ws.getCell(`${koCol}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"yes,no"'] };
    ws.getCell(`${wCol}${r}`).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 5] };
  }

  const help = wb.addWorksheet('How to fill this in');
  help.getColumn(1).width = 22; help.getColumn(2).width = 100;
  const lines: [string, string][] = [
    ['question_id', 'Short unique code, e.g. Q07 or OBJ03. Keep the same code when you edit a question, so its recorded audio stays linked.'],
    ['type', '"question" for interview questions, "objection" for customer objections the candidate must handle.'],
    ['category', 'Free text used for reports, e.g. Motivation, Customer situation, Price objection.'],
    ['weight', '1 (least important) to 5 (most important).'],
    ...languages.map(l => [`text_${l}`, `The question exactly as it is read out in ${languageName(l)}. Fill every language column.`] as [string, string]),
    ['good_answer', 'What a strong answer contains. The AI scores against these three model answers, so they matter most for accuracy.'],
    ['average_answer', 'What an acceptable but unremarkable answer looks like.'],
    ['poor_answer', 'What a weak answer looks like.'],
    ['must_mention', 'Optional. Comma-separated points a good answer should mention, e.g. safety, warranty, long life.'],
    ['knockout', '"yes" if a wrong answer should flag the candidate for a recruiter (never auto-rejected).'],
    ['knockout_rule', 'Required when knockout is yes: what the candidate must say, in plain words.'],
    ['', ''],
    ['Audio', 'Record or upload the spoken version of each question on the question bank page after uploading this file.'],
    ['Versions', 'Every upload creates a new version. Interviews keep the version they were scored with.'],
  ];
  lines.forEach(([a, b]) => { const r = help.addRow([a, b]); r.getCell(1).font = { bold: true }; r.alignment = { wrapText: true, vertical: 'top' }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Turns any Excel cell value (number, rich text, hyperlink, formula result) into trimmed text. */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map(t => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

/** Reads and validates an uploaded sheet. Returns every problem found, with row numbers as Excel shows them. */
export async function parseSheet(file: ArrayBuffer, tenantLanguages: string[]): Promise<{ rows: QuestionRow[]; errors: SheetError[]; languages: string[] }> {
  const errors: SheetError[] = [];
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file);
  } catch {
    return { rows: [], errors: [{ row: null, column: null, message: 'This is not a readable .xlsx file. Save it from Excel as "Excel Workbook (.xlsx)".' }], languages: [] };
  }
  const ws = wb.getWorksheet('Questions') ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: null, column: null, message: 'The file has no sheets.' }], languages: [] };

  const header = new Map<string, number>();
  ws.getRow(1).eachCell((c, i) => { const h = cellText(c.value).toLowerCase(); if (h) header.set(h, i); });
  for (const c of [...FIXED_BEFORE, ...FIXED_AFTER]) {
    if (!header.has(c)) errors.push({ row: 1, column: c, message: `Missing column "${c}". Start from the downloaded template.` });
  }
  const sheetLanguages = [...header.keys()].filter(h => h.startsWith('text_')).map(h => h.slice(5));
  const unknown = sheetLanguages.filter(l => !tenantLanguages.includes(l));
  if (unknown.length) errors.push({ row: 1, column: null, message: `Language columns not enabled for your account: ${unknown.map(l => 'text_' + l).join(', ')}. Remove them or ask the platform administrator to enable the language.` });
  const languages = sheetLanguages.filter(l => tenantLanguages.includes(l));
  if (!languages.length) errors.push({ row: 1, column: null, message: 'Add at least one question text column, e.g. text_hi or text_en.' });
  if (errors.length) return { rows: [], errors, languages };

  const rows: QuestionRow[] = [];
  const seen = new Map<string, number>();
  const get = (r: ExcelJS.Row, col: string) => cellText(r.getCell(header.get(col)!).value);
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const allBlank = [...header.values()].every(i => !cellText(r.getCell(i).value));
    if (allBlank) return;
    if (rows.length >= MAX_ROWS) { if (rows.length === MAX_ROWS) errors.push({ row: n, column: null, message: `More than ${MAX_ROWS} rows; split the bank.` }); return; }
    const err = (column: string | null, message: string) => errors.push({ row: n, column, message });

    const code = get(r, 'question_id');
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(code)) err('question_id', 'Must be 1–20 letters, numbers, - or _.');
    else if (seen.has(code.toUpperCase())) err('question_id', `Duplicate of row ${seen.get(code.toUpperCase())}.`);
    else seen.set(code.toUpperCase(), n);

    const type = get(r, 'type').toLowerCase();
    if (type !== 'question' && type !== 'objection') err('type', 'Must be "question" or "objection".');
    const category = get(r, 'category');
    if (!category) err('category', 'Required.');
    const weight = Number(get(r, 'weight'));
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) err('weight', 'Must be a whole number from 1 to 5.');

    const texts: Record<string, string> = {};
    for (const l of languages) {
      const t = get(r, `text_${l}`);
      if (!t) err(`text_${l}`, `Missing the ${languageName(l)} text.`);
      else if (t.length > 1000) err(`text_${l}`, 'Too long (max 1000 characters).');
      texts[l] = t;
    }
    const answers = { good_answer: get(r, 'good_answer'), average_answer: get(r, 'average_answer'), poor_answer: get(r, 'poor_answer') };
    for (const [k, v] of Object.entries(answers)) {
      if (!v) err(k, 'Required: model answers anchor the scoring.');
      else if (v.length > 2000) err(k, 'Too long (max 2000 characters).');
    }
    const ko = get(r, 'knockout').toLowerCase() || 'no';
    if (ko !== 'yes' && ko !== 'no') err('knockout', 'Must be "yes" or "no".');
    const rule = get(r, 'knockout_rule');
    if (ko === 'yes' && !rule) err('knockout_rule', 'Required when knockout is yes.');

    rows.push({
      code: code.toUpperCase(), type: type as QuestionRow['type'], category, weight, texts, ...answers,
      must_mention: get(r, 'must_mention').split(',').map(s => s.trim()).filter(Boolean),
      knockout: ko === 'yes', knockout_rule: ko === 'yes' ? rule : null,
    });
  });
  if (!rows.length && !errors.length) errors.push({ row: null, column: null, message: 'The sheet has no question rows.' });
  return { rows, errors, languages };
}
