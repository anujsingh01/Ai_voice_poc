// whisper-stt.js — offline speech-to-text in the browser with Whisper (Transformers.js).
//
//   import { WhisperSTT } from './whisper-stt.js';
//   const stt = new WhisperSTT();
//   await stt.load();
//   const { text, language } = await stt.transcribe(file);   // File, Blob, ArrayBuffer or 16 kHz Float32Array
//
// Audio never leaves the PC. The page must be served over http://localhost or https, from the folder
// that also holds ./models/ (the converted fine-tuned models).

// Fixed choice: Whisper small is the most accurate model that still runs in a browser.
export const DEFAULT_MODEL = 'onnx-community/whisper-small';

// Languages where standard Whisper is weak use a fine-tuned model instead (converted, in ./models/).
// Larger Malayalam alternative, also converted: 'thennal/whisper-medium-ml'.
export const LANGUAGE_MODELS = {
  ta: 'vasista22/whisper-tamil-small',
  ml: 'vrclc/Whisper-small-Malayalam',
};

// Every language Whisper small was trained on (99), as [code, name].
// Indian languages are listed first; the rest follow alphabetically.
export const INDIAN_LANGUAGES = [
  ['hi', 'Hindi'], ['ta', 'Tamil'], ['te', 'Telugu'], ['kn', 'Kannada'], ['ml', 'Malayalam'],
  ['mr', 'Marathi'], ['bn', 'Bengali'], ['gu', 'Gujarati'], ['pa', 'Punjabi'], ['ur', 'Urdu'],
  ['as', 'Assamese'], ['ne', 'Nepali'], ['sd', 'Sindhi'], ['sa', 'Sanskrit'],
];
export const OTHER_LANGUAGES = [
  ['af', 'Afrikaans'], ['sq', 'Albanian'], ['am', 'Amharic'], ['ar', 'Arabic'], ['hy', 'Armenian'],
  ['az', 'Azerbaijani'], ['ba', 'Bashkir'], ['eu', 'Basque'], ['be', 'Belarusian'], ['bs', 'Bosnian'],
  ['br', 'Breton'], ['bg', 'Bulgarian'], ['my', 'Burmese (Myanmar)'], ['ca', 'Catalan'], ['zh', 'Chinese'],
  ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'], ['nl', 'Dutch'], ['en', 'English'],
  ['et', 'Estonian'], ['fo', 'Faroese'], ['fi', 'Finnish'], ['fr', 'French'], ['gl', 'Galician'],
  ['ka', 'Georgian'], ['de', 'German'], ['el', 'Greek'], ['ht', 'Haitian Creole'], ['ha', 'Hausa'],
  ['haw', 'Hawaiian'], ['he', 'Hebrew'], ['hu', 'Hungarian'], ['is', 'Icelandic'], ['id', 'Indonesian'],
  ['it', 'Italian'], ['ja', 'Japanese'], ['jw', 'Javanese'], ['kk', 'Kazakh'], ['km', 'Khmer'],
  ['ko', 'Korean'], ['lo', 'Lao'], ['la', 'Latin'], ['lv', 'Latvian'], ['ln', 'Lingala'],
  ['lt', 'Lithuanian'], ['lb', 'Luxembourgish'], ['mk', 'Macedonian'], ['mg', 'Malagasy'], ['ms', 'Malay'],
  ['mt', 'Maltese'], ['mi', 'Maori'], ['mn', 'Mongolian'], ['no', 'Norwegian'], ['nn', 'Norwegian Nynorsk'],
  ['oc', 'Occitan'], ['ps', 'Pashto'], ['fa', 'Persian'], ['pl', 'Polish'], ['pt', 'Portuguese'],
  ['ro', 'Romanian'], ['ru', 'Russian'], ['sr', 'Serbian'], ['sn', 'Shona'], ['si', 'Sinhala'],
  ['sk', 'Slovak'], ['sl', 'Slovenian'], ['so', 'Somali'], ['es', 'Spanish'], ['su', 'Sundanese'],
  ['sw', 'Swahili'], ['sv', 'Swedish'], ['tl', 'Tagalog'], ['tg', 'Tajik'], ['tt', 'Tatar'],
  ['th', 'Thai'], ['bo', 'Tibetan'], ['tr', 'Turkish'], ['tk', 'Turkmen'], ['uk', 'Ukrainian'],
  ['uz', 'Uzbek'], ['vi', 'Vietnamese'], ['cy', 'Welsh'], ['yi', 'Yiddish'], ['yo', 'Yoruba'],
];
export const LANGUAGE_NAMES = new Map([...INDIAN_LANGUAGES, ...OTHER_LANGUAGES]);

// Text translation between any two of these languages (Whisper itself can only translate into English).
// Chrome's built-in translator is used for the pairs it supports (Hindi, Tamil, Telugu, Kannada, Marathi, Bengali
// and most world languages, but not Malayalam, Gujarati, Punjabi, Urdu, Assamese, Nepali, Sindhi or Sanskrit).
// Other pairs use NLLB-200 on the CPU in its own worker; it downloads about 900 MB the first time it is used.
export const TRANSLATION_MODEL = 'Xenova/nllb-200-distilled-600M';
// Whisper language code -> NLLB language code, for the languages translation supports.
export const NLLB_CODES = {
  hi: 'hin_Deva', ta: 'tam_Taml', te: 'tel_Telu', kn: 'kan_Knda', ml: 'mal_Mlym', mr: 'mar_Deva',
  bn: 'ben_Beng', gu: 'guj_Gujr', pa: 'pan_Guru', ur: 'urd_Arab', as: 'asm_Beng', ne: 'npi_Deva',
  sd: 'snd_Arab', sa: 'san_Deva',
  en: 'eng_Latn', ar: 'arb_Arab', zh: 'zho_Hans', nl: 'nld_Latn', fr: 'fra_Latn', de: 'deu_Latn',
  he: 'heb_Hebr', id: 'ind_Latn', it: 'ita_Latn', ja: 'jpn_Jpan', km: 'khm_Khmr', ko: 'kor_Hang',
  ms: 'zsm_Latn', my: 'mya_Mymr', fa: 'pes_Arab', pl: 'pol_Latn', pt: 'por_Latn', ru: 'rus_Cyrl',
  si: 'sin_Sinh', es: 'spa_Latn', sw: 'swh_Latn', th: 'tha_Thai', tr: 'tur_Latn', uk: 'ukr_Cyrl',
  vi: 'vie_Latn',
};

// The translation model often drops a sentence when given several at once, and only handles a few hundred
// words at a time, so text is translated one sentence at a time (long unpunctuated runs split by length).
export function splitForTranslation(text, max = 300) {
  const chunks = [];
  for (const sentence of text.trim().split(/(?<=[.!?।॥])\s+/)) {
    let cur = '';
    for (const word of sentence.split(/\s+/)) {
      if (cur && cur.length + 1 + word.length > max) { chunks.push(cur); cur = ''; }
      cur = cur ? cur + ' ' + word : word;
    }
    if (cur) chunks.push(cur);
  }
  return chunks;
}

// Each model runs in its own Web Worker, so the page stays responsive while it works, and so its memory can be
// given back: ONNX Runtime keeps the memory of a disposed model for reuse, so the only way to really free a
// model (CPU and graphics card memory) is to end its worker.
const workerSrc = `
import { pipeline, env, Tensor } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
env.allowLocalModels = true;
let asr = null, langTokens = [];
let translator = null;   // Promise of the translation pipeline, loaded on first use

async function load({ model, device, modelsUrl, languages = [] }) {
  env.localModelPath = modelsUrl;
  // On the CPU use several cores; only possible when the server sends the cross-origin isolation headers.
  if (self.crossOriginIsolated) env.backends.onnx.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency || 4);
  // On GPU quantise the decoder (size/speed) but not the encoder (accuracy). Half precision (fp16) halves the
  // encoder's memory at practically the same accuracy; a model without an fp16 file falls back to fp32.
  // The fp16 encoders are in ./models, converted with layer-norm and softmax kept at fp32: fully fp16 ones
  // overflow (the Hugging Face one for whisper-small turns Hindi into "ददद…").
  let fp16 = device === 'webgpu' && !!(await navigator.gpu.requestAdapter())?.features.has('shader-f16');
  const open = () => pipeline('automatic-speech-recognition', model, { device,
    dtype: device === 'webgpu' ? { encoder_model: fp16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } : 'q8',
    progress_callback: p => self.postMessage({ type: 'progress', p }) });
  try { asr = await open(); }
  catch (e) { if (!fp16) throw e; fp16 = false; asr = await open(); }
  // Warm-up run so the first real clip isn't slow from shader compilation.
  await asr(new Float32Array(16000), { language: 'en' });
  langTokens = languages
    .map(code => ({ code, id: asr.tokenizer.model.tokens_to_ids.get('<|' + code + '|>') }))
    .filter(t => t.id !== undefined);
  return { fp16 };
}

// Transformers.js has no language detection (it silently assumes English), so do it here:
// feed the first 30 s plus the start token through the model and see which language token it rates highest.
async function detectLanguage(audio) {
  const { input_features } = await asr.processor(audio);
  const sot = asr.model.generation_config.decoder_start_token_id;
  const decoder_input_ids = new Tensor('int64', BigInt64Array.from([BigInt(sot)]), [1, 1]);
  const { logits } = await asr.model({ input_features, decoder_input_ids });
  const scores = logits.data;
  let best = null;
  for (const t of langTokens) if (!best || scores[t.id] > scores[best.id]) best = t;
  return best.code;
}

async function translate({ model, chunks, from, to }) {
  const t0 = performance.now();
  // CPU (wasm) so it never competes with Whisper for the graphics card.
  translator ??= pipeline('translation', model, { device: 'wasm', dtype: 'q8',
    progress_callback: p => self.postMessage({ type: 'progress', p }) })
    .catch(e => { translator = null; throw e; });
  const tr = await translator;
  // One piece at a time: batching several gives garbled, mixed-language output.
  const parts = [];
  for (const chunk of chunks) {
    const [out] = await tr(chunk, { src_lang: from, tgt_lang: to, max_new_tokens: 400 });
    parts.push(out.translation_text.trim());
  }
  return { text: parts.join(' '), ms: performance.now() - t0 };
}

self.onmessage = async ({ data }) => {
  try {
    let reply;
    if (data.type === 'load') reply = await load(data);
    else if (data.type === 'detect') reply = { language: await detectLanguage(data.audio) };
    else if (data.type === 'run') {
      const out = await asr(data.audio, { task: data.task, language: data.language, chunk_length_s: 30, stride_length_s: 5 });
      reply = { text: out.text.trim() };
    } else if (data.type === 'translate') reply = await translate(data);
    self.postMessage({ ...reply, type: 'done', id: data.id });
  } catch (e) {
    self.postMessage({ type: 'error', id: data.id, message: e?.message || String(e) });
  }
};
`;

// Whisper expects 16 kHz mono float samples; the browser resamples for us here.
export async function toPCM16k(input) {
  if (input instanceof Float32Array) return input;
  const bytes = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: 16000 });
  const buf = await ctx.decodeAudioData(bytes);
  await ctx.close();
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const a = buf.getChannelData(0), b = buf.getChannelData(1), m = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) / 2;
  return m;
}

export class WhisperSTT {
  /**
   * @param {object} [options]
   * @param {(loadedBytes:number, totalBytes:number) => void} [options.onProgress]  model download progress
   * @param {(model:string, state:'loading'|'ready'|'unloaded'|'failed', message?:string) => void} [options.onExtraModel]
   *        state of the fine-tuned Tamil/Malayalam models. Each loads the first time its language comes up, and
   *        only one is kept in memory at a time.
   * @param {(loadedBytes:number, totalBytes:number) => void} [options.onTranslateProgress]
   *        download progress of the translation model, the first time translate() is used
   * @param {number} [options.translationIdleSeconds]  free the translation model's memory after this many
   *        seconds without a translation; it loads again on the next one. Default 60; Infinity keeps it.
   * @param {number} [options.languageModelIdleSeconds]  free the Tamil/Malayalam model's memory after this many
   *        seconds without a clip; it loads again on the next one. Default 60; Infinity keeps it.
   * @param {string} [options.modelsUrl]  where ./models/ is served; defaults to next to this file
   * @param {'webgpu'|'wasm'} [options.device]  force graphics card or CPU; default graphics card if Chrome has one.
   *        The CPU uses much less memory but is slower, and only uses several cores if the page is cross-origin
   *        isolated (see server.js).
   */
  constructor({ onProgress, onExtraModel, onTranslateProgress, translationIdleSeconds = 60,
                languageModelIdleSeconds = 60, modelsUrl, device } = {}) {
    this.onProgress = onProgress;
    this.onExtraModel = onExtraModel;
    this.onTranslateProgress = onTranslateProgress;
    this.translationIdleSeconds = translationIdleSeconds;
    this.languageModelIdleSeconds = languageModelIdleSeconds;
    this.modelsUrl = modelsUrl || new URL('models/', import.meta.url).href;
    this.device = device || (navigator.gpu ? 'webgpu' : 'wasm');
    this.worker = null;   // standard Whisper; also detects the language
    this._extra = null;   // { model, worker, ready } for the fine-tuned model currently loaded
    this._translateWorker = null;
    this._translating = 0;
    this._pending = new Map();
    this._nextId = 1;
    this._queue = Promise.resolve();   // one clip at a time on the GPU
    this._files = new Map();
    this._tfiles = new Map();
  }

  _newWorker(tag) {
    const worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })), { type: 'module' });
    worker.onmessage = e => this._onMessage(e.data, tag);
    return worker;
  }

  _call(worker, message, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  /** Loads standard Whisper small (graphics card if possible, else CPU). Resolves when ready. */
  load() {
    this._loading ??= this._loadStandard();
    return this._loading;
  }

  async _loadStandard() {
    for (;;) {
      this._files.clear();
      this.worker = this._newWorker('standard');
      try {
        const { fp16 } = await this._call(this.worker, { type: 'load', model: DEFAULT_MODEL, device: this.device,
          modelsUrl: this.modelsUrl, languages: [...LANGUAGE_NAMES.keys()] });
        this.fp16 = fp16;
        return;
      } catch (e) {
        this.worker.terminate();
        if (this.device !== 'webgpu') throw e;
        // Graphics card couldn't run it: fall back to CPU automatically.
        console.warn('WebGPU load failed, falling back to CPU:', e.message);
        this.device = 'wasm';
      }
    }
  }

  // Loads a fine-tuned model in its own worker, ending the worker of the previous one first to free its memory.
  async _useExtra(model) {
    if (this._extra?.model === model) return this._extra.ready;
    this._endExtra();
    const worker = this._newWorker('extra');
    const ready = this._call(worker, { type: 'load', model, device: this.device, modelsUrl: this.modelsUrl });
    this._extra = { model, worker, ready };
    this.onExtraModel?.(model, 'loading');
    try {
      await ready;
      this.onExtraModel?.(model, 'ready');
    } catch (e) {
      worker.terminate();
      this._extra = null;
      this.onExtraModel?.(model, 'failed', e.message);
      throw e;
    }
  }

  /**
   * Converts speech to text.
   * @param {File|Blob|ArrayBuffer|Float32Array} input  any audio format Chrome can play, or 16 kHz mono samples
   * @param {object} [options]
   * @param {string} [options.language]  code such as 'hi', 'ta', 'ml'; leave empty to auto-detect
   * @param {'transcribe'|'translate'} [options.task]  'translate' gives English text
   * @returns {Promise<{text:string, original?:string, language:string, detected:boolean, model:string|null, seconds:number, ms:number}>}
   *          original: with task 'translate' on Tamil/Malayalam, the text in that language before it was translated
   */
  async transcribe(input, { language = '', task = 'transcribe' } = {}) {
    await this.load();
    const audio = await toPCM16k(input);
    const seconds = audio.length / 16000;
    const run = async () => {
      clearTimeout(this._extraTimer);
      this._running = true;
      try { return await transcribeNow(); } finally {
        this._running = false;
        if (this._extra && this.languageModelIdleSeconds !== Infinity) {
          this._extraTimer = setTimeout(() => this.freeLanguageModel(), this.languageModelIdleSeconds * 1000);
        }
      }
    };
    const transcribeNow = async () => {
      const t0 = performance.now();
      const detected = !language;
      if (detected) {
        const first30s = audio.slice(0, 16000 * 30);   // copies, so the worker can take ownership
        ({ language } = await this._call(this.worker, { type: 'detect', audio: first30s }, [first30s.buffer]));
      }
      // Use the fine-tuned model for this language if there is one and it loads; otherwise standard Whisper.
      let model = LANGUAGE_MODELS[language] || null, worker = this.worker;
      if (model) {
        try { await this._useExtra(model); worker = this._extra.worker; } catch { model = null; }
      }
      const copy = audio.slice();
      // The fine-tuned models were only trained to transcribe: asked to translate they still give Tamil/Malayalam.
      // So transcribe with them (accurate) and translate that text into English.
      const fineTunedTranslate = model && task === 'translate';
      const { text } = await this._call(worker, { type: 'run', audio: copy, language,
        task: fineTunedTranslate ? 'transcribe' : task }, [copy.buffer]);
      if (fineTunedTranslate && text) {
        const english = await this.translate(text, { from: language, to: 'en' });
        return { text: english.text, original: text, language, detected, model, seconds, ms: performance.now() - t0 };
      }
      return { text, language, detected, model, seconds, ms: performance.now() - t0 };
    };
    const result = this._queue.then(run, run);
    this._queue = result.catch(() => {});
    return result;
  }

  /**
   * Translates text from one language to another, offline. Does not need load().
   * Uses Chrome's built-in translator when it has the language pair (about 250 MB of memory, a few ms), else the
   * NLLB model (about 900 MB download, up to 4 GB of memory while in use, a few seconds).
   * @param {string} text  e.g. the text from transcribe()
   * @param {object} options
   * @param {string} options.from  language code of the text, e.g. result.language from transcribe()
   * @param {string} options.to    language code to translate into; see NLLB_CODES for the supported ones
   * @returns {Promise<{text:string, ms:number, engine:'chrome'|'nllb'|null, chromeNeedsClick:boolean}>}
   *          chromeNeedsClick: Chrome could do this pair but must download it first, which needs a click;
   *          call prepareTranslation(from, to) from a click handler and NLLB is not needed next time.
   */
  async translate(text, { from, to }) {
    for (const code of [from, to]) {
      if (!NLLB_CODES[code]) throw new Error(`Translation does not support ${LANGUAGE_NAMES.get(code) || code || 'an empty language'}`);
    }
    const chunks = splitForTranslation(text);
    if (from === to || !chunks.length) return { text, ms: 0, engine: null, chromeNeedsClick: false };
    const t0 = performance.now();
    const state = await this._chromeAvailability(from, to);
    if (state === 'available') {
      try {
        const tr = await this._chromeTranslator(from, to);
        return { text: await tr.translate(text.trim()), ms: performance.now() - t0, engine: 'chrome', chromeNeedsClick: false };
      } catch (e) {
        console.warn('Chrome translator failed, using NLLB:', e.message);
      }
    }
    return { ...await this._translateNLLB(chunks, from, to), engine: 'nllb',
      chromeNeedsClick: state === 'downloadable' || state === 'downloading' };
  }

  /**
   * Downloads Chrome's built-in translator for a language pair, so translate() can use it instead of NLLB.
   * Chrome only allows the download from a click (or key press) handler. Resolves true when the pair is ready.
   */
  async prepareTranslation(from, to) {
    if (!from || !to || from === to || !self.Translator) return false;
    try { await this._chromeTranslator(from, to); return true; }
    catch { return false; }   // pair not supported, or not called from a click
  }

  async _chromeAvailability(from, to) {
    if (!self.Translator) return 'unavailable';
    try { return await Translator.availability({ sourceLanguage: from, targetLanguage: to }); }
    catch { return 'unavailable'; }
  }

  _chromeTranslator(from, to) {
    const key = from + '>' + to;
    this._chromeTranslators ??= new Map();
    if (!this._chromeTranslators.has(key)) {
      // create() must be called synchronously inside the click handler, so no await before it.
      const p = Translator.create({ sourceLanguage: from, targetLanguage: to });
      this._chromeTranslators.set(key, p);
      p.catch(() => this._chromeTranslators.delete(key));
    }
    return this._chromeTranslators.get(key);
  }

  async _translateNLLB(chunks, from, to) {
    clearTimeout(this._idleTimer);
    if (!this._translateWorker) { this._translateWorker = this._newWorker('translate'); this._tfiles.clear(); }
    this._translating++;
    try {
      const r = await this._call(this._translateWorker, { type: 'translate', chunks, from: NLLB_CODES[from],
        to: NLLB_CODES[to], model: TRANSLATION_MODEL });
      return { text: r.text, ms: r.ms };
    } finally {
      if (--this._translating === 0 && this.translationIdleSeconds !== Infinity) {
        this._idleTimer = setTimeout(() => this.freeTranslation(), this.translationIdleSeconds * 1000);
      }
    }
  }

  /** Frees the Tamil/Malayalam model's memory now (if no clip is running). The next clip in that language reloads it. */
  freeLanguageModel() {
    if (!this._running) this._endExtra();
  }

  _endExtra() {
    clearTimeout(this._extraTimer);
    if (!this._extra) return;
    this._extra.worker.terminate();
    this.onExtraModel?.(this._extra.model, 'unloaded');
    this._extra = null;
  }

  /** Frees the translation model's memory now (if no translation is running). The next translate() reloads it. */
  freeTranslation() {
    if (this._translating || !this._translateWorker) return;
    clearTimeout(this._idleTimer);
    this._translateWorker.terminate();
    this._translateWorker = null;
  }

  _onMessage(data, tag) {
    if (data.type === 'progress') {
      const p = data.p;
      const [files, callback] = tag === 'standard' ? [this._files, this.onProgress]
        : tag === 'translate' ? [this._tfiles, this.onTranslateProgress] : [];
      if (p.status === 'progress' && p.total && callback) {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let l = 0, t = 0; for (const f of files.values()) { l += f.loaded; t += f.total; }
        callback(l, t);
      }
      return;
    }
    const job = this._pending.get(data.id);
    if (!job) return;
    this._pending.delete(data.id);
    if (data.type === 'error') job.reject(new Error(data.message));
    else job.resolve(data);
  }
}
