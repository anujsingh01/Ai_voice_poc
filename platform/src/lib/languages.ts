// Interview languages a tenant can enable. Codes match Whisper's, so they pass straight to transcription.
export const INTERVIEW_LANGUAGES = [
  ['hi', 'Hindi'], ['en', 'English'], ['ta', 'Tamil'], ['te', 'Telugu'], ['kn', 'Kannada'],
  ['ml', 'Malayalam'], ['mr', 'Marathi'], ['bn', 'Bengali'], ['gu', 'Gujarati'], ['pa', 'Punjabi'],
  ['ur', 'Urdu'], ['as', 'Assamese'],
] as const;

export const LANGUAGE_CODES = INTERVIEW_LANGUAGES.map(([c]) => c) as string[];
export const languageName = (code: string) => INTERVIEW_LANGUAGES.find(([c]) => c === code)?.[1] ?? code;
