// Removes personal details from transcripts before any text leaves for the scoring service.
// Covers: the candidate's own name (as typed in the candidate list, and after "my name is …" phrases in
// English, Hindi and Tamil), email addresses, and long digit runs (phone, Aadhaar, account numbers) in
// Latin, Devanagari and Tamil digits. Short numbers ("5 years", "20 houses") are kept; they matter.
// Limitation: a name spoken in Hindi/Tamil script is only caught after a "my name is" phrase.

const DIGIT = '[0-9\\u0966-\\u096F\\u0BE6-\\u0BEF]';
const LONG_NUMBER = new RegExp(`(?:\\+?${DIGIT}[\\s\\-.]?){7,}`, 'g');
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const NAME_INTRO = /(my name is|i am called|मेरा नाम|मैं हूँ|என் பெயர்|நான்)\s+((?:[\p{L}\p{M}]+\s*){1,3}?)(?=\s*(?:है|हूँ|हूं|and|,|\.|।|$))/giu;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function maskTranscript(text: string, candidateName: string): string {
  let out = text.replace(EMAIL, '[EMAIL]').replace(LONG_NUMBER, m => (/\s$/.test(m) ? '[NUMBER] ' : '[NUMBER]'));
  const parts = candidateName.split(/[\s,]+/).filter(p => p.length >= 3);
  for (const p of parts) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{M}])${escape(p)}(?![\\p{L}\\p{M}])`, 'giu'), '[NAME]');
  }
  out = out.replace(NAME_INTRO, (_m, intro: string, name: string) => `${intro} [NAME]${/\s$/.test(name) ? ' ' : ''}`);
  return out;
}
