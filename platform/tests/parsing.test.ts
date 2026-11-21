import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { firstName, normalisePhone, parseCsv, readCandidates } from '../src/lib/candidates';
import { buildSheet, parseSheet } from '../src/lib/question-sheet';

const toArrayBuffer = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** Builds a sheet from the template, then lets the test change cells (row 2 = first example). */
async function sheetWith(edit: (ws: ExcelJS.Worksheet) => void, languages = ['hi', 'en']) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(toArrayBuffer(await buildSheet(languages)));
  edit(wb.getWorksheet('Questions')!);
  return toArrayBuffer(Buffer.from(await wb.xlsx.writeBuffer()));
}
const col = (ws: ExcelJS.Worksheet, name: string) => {
  let i = 0; ws.getRow(1).eachCell((c, n) => { if (c.value === name) i = n; }); return i;
};

describe('question bank sheet', () => {
  it('accepts the template as downloaded', async () => {
    const r = await parseSheet(toArrayBuffer(await buildSheet(['hi', 'en'])), ['hi', 'en']);
    expect(r.errors).toEqual([]);
    expect(r.rows.map(x => x.code)).toEqual(['Q01', 'OBJ01']);
    expect(r.rows[0].knockout).toBe(true);
    expect(r.rows[1].must_mention).toEqual(['safety', 'warranty', 'long life']);
  });

  it('round-trips an export of saved rows', async () => {
    const first = await parseSheet(toArrayBuffer(await buildSheet(['hi', 'en'])), ['hi', 'en']);
    const again = await parseSheet(toArrayBuffer(await buildSheet(['hi', 'en'], first.rows)), ['hi', 'en']);
    expect(again.rows).toEqual(first.rows);
  });

  it('reports every problem with its row and column, and saves nothing', async () => {
    const file = await sheetWith(ws => {
      ws.getCell(2, col(ws, 'weight')).value = 9;
      ws.getCell(2, col(ws, 'text_hi')).value = '';
      ws.getCell(3, col(ws, 'question_id')).value = 'Q01';                // duplicate
      ws.getCell(3, col(ws, 'type')).value = 'quiz';
      ws.getCell(3, col(ws, 'knockout')).value = 'yes';                    // without a rule
      ws.getCell(3, col(ws, 'good_answer')).value = null;
    });
    const r = await parseSheet(file, ['hi', 'en']);
    const found = r.errors.map(e => `${e.row}:${e.column}`).sort();
    expect(found).toEqual(['2:text_hi', '2:weight', '3:good_answer', '3:knockout_rule', '3:question_id', '3:type'].sort());
  });

  it('rejects language columns the tenant has not enabled', async () => {
    const r = await parseSheet(toArrayBuffer(await buildSheet(['hi', 'ta'])), ['hi', 'en']);
    expect(r.errors[0].message).toMatch(/text_ta/);
    expect(r.rows).toEqual([]);
  });

  it('rejects files that are not Excel workbooks', async () => {
    const r = await parseSheet(new TextEncoder().encode('name,phone\nA,1').buffer as ArrayBuffer, ['hi']);
    expect(r.errors[0].message).toMatch(/not a readable .xlsx/);
  });
});

describe('candidate import', () => {
  it('normalises Indian mobile numbers', () => {
    expect(normalisePhone('98765 43210')).toBe('+919876543210');
    expect(normalisePhone('+91-98765-43210')).toBe('+919876543210');
    expect(normalisePhone('09876543210')).toBe('+919876543210');
    expect(normalisePhone('919876543210')).toBe('+919876543210');
    expect(normalisePhone('12345 67890')).toBeNull();   // Indian mobiles start with 6–9
    expect(normalisePhone('98765')).toBeNull();
  });

  it('greets by first name, including "Surname, First" order', () => {
    expect(firstName('Priya Rao')).toBe('Priya');
    expect(firstName('Rao, Priya')).toBe('Priya');
    expect(firstName('  Arun  ')).toBe('Arun');
  });

  it('parses quoted CSV fields, including commas and Excel’s byte-order mark', () => {
    expect(parseCsv('﻿name,phone\r\n"Rao, Priya",98765 43210\r\n"Say ""hi""",9000000000\n')).toEqual([
      ['name', 'phone'], ['Rao, Priya', '98765 43210'], ['Say "hi"', '9000000000'],
    ]);
  });

  it('imports good rows and explains bad ones by row number', () => {
    const csv = [
      'Name,Mobile Number,Email,Language',
      'Priya Rao,98765 43210,,ta',
      'Arun,,arun@example.com,',
      ',9876500000,,',
      'Bad Phone,12345,,',
      'Bad Email,,not-an-email,',
      'Nobody,,,',
      'Lang Unknown,9123456789,,fr',
    ].join('\n');
    const { candidates, problems } = readCandidates(csv, ['hi', 'en', 'ta']);
    expect(candidates.map(c => [c.name, c.phone, c.email, c.language])).toEqual([
      ['Priya Rao', '+919876543210', null, 'ta'],
      ['Arun', null, 'arun@example.com', null],
      ['Lang Unknown', '+919123456789', null, null],
    ]);
    expect(problems.map(p => p.row)).toEqual([4, 5, 6, 7]);
  });

  it('requires a name column and a phone or email column', () => {
    expect(readCandidates('mobile\n9876543210', ['hi']).problems[0].message).toMatch(/headings/);
  });
});
