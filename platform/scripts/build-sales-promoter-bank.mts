// Builds the DRAFT question bank for the Retail Store Sales Promoter job from TTK Prestige's
// "Sales Promoter Interview Sheet" (Part A screening → knockout questions, Part B → scored questions).
//   npx tsx scripts/build-sales-promoter-bank.mts
// English questions and ideal answers follow the sheet. Average/poor answers, and the Hindi, Tamil and
// Malayalam wording, are a first draft: have native-speaking sales managers check them before use.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSheet, type QuestionRow } from '../src/lib/question-sheet';

type Draft = Omit<QuestionRow, 'texts' | 'must_mention' | 'knockout' | 'knockout_rule'> & {
  en: string; hi: string; ta: string; ml: string; must_mention?: string[]; knockout_rule?: string;
};

const q = (d: Draft): QuestionRow => ({
  code: d.code, type: d.type, category: d.category, weight: d.weight,
  texts: { en: d.en, hi: d.hi, ta: d.ta, ml: d.ml },
  good_answer: d.good_answer, average_answer: d.average_answer, poor_answer: d.poor_answer,
  must_mention: d.must_mention ?? [], knockout: !!d.knockout_rule, knockout_rule: d.knockout_rule ?? null,
});

// ---------- Part A: screening (always asked first; a fail or unclear answer flags the interview) ----------
// Weight 1: these decide eligibility, not the score. Documents are still checked in person.
const SCREENING: Draft[] = [
  {
    code: 'A1', type: 'question', category: 'Screening: experience', weight: 1,
    en: 'How many years have you worked as a sales promoter in retail?',
    hi: 'आपने रिटेल में सेल्स प्रमोटर के रूप में कितने साल काम किया है?',
    ta: 'சில்லறை விற்பனைக் கடைகளில் சேல்ஸ் ப்ரோமோட்டராக எத்தனை ஆண்டுகள் வேலை செய்திருக்கிறீர்கள்?',
    ml: 'റീട്ടെയിൽ കടകളിൽ സെയിൽസ് പ്രൊമോട്ടറായി നിങ്ങൾ എത്ര വർഷം ജോലി ചെയ്തിട്ടുണ്ട്?',
    good_answer: '3 or more years as a sales promoter in retail, preferably home or kitchen appliances, with the brands or stores named.',
    average_answer: '3 or more years in retail sales but in an unrelated category, or the years are given without any detail.',
    poor_answer: 'Under 3 years of retail sales promoter experience, or cannot say.',
    knockout_rule: 'At least 3 years as a retail sales promoter (to be verified against experience letters).',
  },
  {
    code: 'A2', type: 'question', category: 'Screening: education', weight: 1,
    en: 'What is your highest qualification? Please tell us the board or school and the year you passed.',
    hi: 'आपकी सबसे ऊँची शैक्षिक योग्यता क्या है? कृपया बोर्ड या स्कूल का नाम और पास होने का साल बताइए।',
    ta: 'உங்கள் அதிகபட்ச கல்வித் தகுதி என்ன? வாரியம் அல்லது பள்ளியின் பெயரையும் தேர்ச்சி பெற்ற ஆண்டையும் சொல்லுங்கள்.',
    ml: 'നിങ്ങളുടെ ഏറ്റവും ഉയർന്ന വിദ്യാഭ്യാസ യോഗ്യത എന്താണ്? ബോർഡ് അല്ലെങ്കിൽ സ്കൂളിന്റെ പേരും പാസായ വർഷവും പറയൂ.',
    good_answer: '10th pass or above, with the board or school and the year of passing.',
    average_answer: '10th pass or above, but no board, school or year given.',
    poor_answer: 'Below 10th standard, or will not say.',
    knockout_rule: '10th standard passed or above (to be verified against the marksheet or certificate).',
  },
  {
    code: 'A3', type: 'question', category: 'Screening: age', weight: 1,
    en: 'Please tell us your date of birth.',
    hi: 'कृपया अपनी जन्मतिथि बताइए।',
    ta: 'உங்கள் பிறந்த தேதியைச் சொல்லுங்கள்.',
    ml: 'നിങ്ങളുടെ ജനനത്തീയതി പറയൂ.',
    good_answer: 'Gives a full date of birth showing an age of 35 years or below.',
    average_answer: 'Gives only the age or the year of birth, 35 or below.',
    poor_answer: 'Older than 35, or does not give a date of birth.',
    knockout_rule: 'Age 35 years or below (to be verified against Aadhaar or school certificate).',
  },
  {
    code: 'A4', type: 'question', category: 'Screening: location', weight: 1,
    en: 'What is your native place, and in which city do you live and work now? If the store is in another city, are you willing to relocate?',
    hi: 'आपका मूल निवास कहाँ है, और अभी आप किस शहर में रहते और काम करते हैं? अगर स्टोर किसी दूसरे शहर में है, तो क्या आप वहाँ शिफ़्ट होने के लिए तैयार हैं?',
    ta: 'உங்கள் சொந்த ஊர் எது, இப்போது எந்த நகரத்தில் வசித்து வேலை செய்கிறீர்கள்? கடை வேறு நகரத்தில் இருந்தால், அங்கே இடம் மாறத் தயாரா?',
    ml: 'നിങ്ങളുടെ സ്വദേശം എവിടെയാണ്, ഇപ്പോൾ ഏത് നഗരത്തിലാണ് താമസിക്കുന്നതും ജോലി ചെയ്യുന്നതും? സ്റ്റോർ മറ്റൊരു നഗരത്തിലാണെങ്കിൽ അവിടേക്ക് മാറാൻ തയ്യാറാണോ?',
    good_answer: 'Clearly states native city and state and current city; the current city matches the store location, or clearly willing to relocate.',
    average_answer: 'Gives the cities but is unsure about relocating.',
    poor_answer: 'Does not say where they live, or is unwilling to work in the store’s city.',
    knockout_rule: 'Lives in the store’s city or is willing to relocate (to be verified against address proof).',
  },
];

// ---------- Part B: skills and attitude (each scored 1 to 5 in the sheet; equal weight) ----------
const SKILLS: Draft[] = [
  {
    code: 'B05', type: 'question', category: 'Career journey', weight: 5,
    en: 'Walk us through your career, brand by brand. What is your total experience, and how much of it is relevant to this job?',
    hi: 'अपने करियर के बारे में ब्रांड-दर-ब्रांड बताइए। आपका कुल अनुभव कितना है, और उसमें से कितना इस नौकरी से जुड़ा है?',
    ta: 'உங்கள் வேலை அனுபவத்தை ஒவ்வொரு பிராண்டாக வரிசையாகச் சொல்லுங்கள். மொத்த அனுபவம் எவ்வளவு, அதில் இந்த வேலைக்குத் தொடர்புடையது எவ்வளவு?',
    ml: 'നിങ്ങളുടെ കരിയർ ഓരോ ബ്രാൻഡായി വിശദീകരിക്കൂ. ആകെ എത്ര വർഷത്തെ പരിചയമുണ്ട്, അതിൽ ഈ ജോലിയുമായി ബന്ധപ്പെട്ടത് എത്ര?',
    good_answer: 'A clear timeline: brand, store, role, duration and reason for leaving for each job; separates total from relevant experience; stable tenures with named brands; mentions achievements such as “achieved 110% of target”.',
    average_answer: 'Names the brands and durations but no reasons for leaving or achievements, or the timeline is hard to follow.',
    poor_answer: 'Vague or contradictory history, many very short jobs without explanation, or cannot separate relevant experience.',
  },
  {
    code: 'B06', type: 'question', category: 'Reading buying intent', weight: 5,
    en: 'How do you tell whether a customer will buy, and how do you make sure the customer is converted?',
    hi: 'आप कैसे पहचानते हैं कि ग्राहक ख़रीदेगा या नहीं, और आप कैसे पक्का करते हैं कि वह ख़रीद ले?',
    ta: 'ஒரு வாடிக்கையாளர் வாங்குவாரா என்பதை எப்படிக் கண்டுபிடிப்பீர்கள்? அவர் வாங்குவதை எப்படி உறுதி செய்வீர்கள்?',
    ml: 'ഒരു ഉപഭോക്താവ് വാങ്ങുമോ എന്ന് നിങ്ങൾ എങ്ങനെ തിരിച്ചറിയും? അവർ ഉറപ്പായും വാങ്ങുന്നുവെന്ന് എങ്ങനെ ഉറപ്പാക്കും?',
    good_answer: 'Watches buying signals: asks about price, warranty or EMI; handles the product; compares models; comes with family. Then asks about needs, demos the right product, handles doubts, offers a scheme or bundle, asks for the sale, and takes contact details to follow up.',
    average_answer: 'Mentions a few signals or a few steps (e.g. demo and offer) but not both reading intent and closing.',
    poor_answer: 'Says every customer is the same, or relies only on discounts or pushing.',
  },
  {
    code: 'B08', type: 'question', category: 'Benefit vs. product selling', weight: 5,
    en: 'How is benefit selling different from product selling?',
    hi: 'बेनिफ़िट सेलिंग और प्रोडक्ट सेलिंग में क्या फ़र्क़ है?',
    ta: 'பெனிஃபிட் செல்லிங் (பயன் சார்ந்த விற்பனை) மற்றும் ப்ராடக்ட் செல்லிங் (பொருள் சார்ந்த விற்பனை) இரண்டுக்கும் என்ன வித்தியாசம்?',
    ml: 'ബെനിഫിറ്റ് സെല്ലിങ്ങും പ്രോഡക്ട് സെല്ലിങ്ങും തമ്മിലുള്ള വ്യത്യാസം എന്താണ്?',
    good_answer: 'Product selling lists features (“5-litre, 1000W”); benefit selling links features to the customer’s life (“cooks faster, saves gas, healthier meals for your family”). Customers buy outcomes, not specifications. Ideally gives an example from a kitchen product.',
    average_answer: 'Knows benefit selling is about the customer but gives no clear example, or mixes up the two.',
    poor_answer: 'Does not know the difference.',
  },
  {
    code: 'B09', type: 'question', category: 'Building trust', weight: 5,
    en: 'What is essential to build a customer’s trust in the product and the brand?',
    hi: 'प्रोडक्ट और ब्रांड पर ग्राहक का भरोसा बनाने के लिए क्या ज़रूरी है?',
    ta: 'பொருள் மீதும் பிராண்ட் மீதும் வாடிக்கையாளரின் நம்பிக்கையை வளர்க்க எவை அவசியம்?',
    ml: 'ഉൽപ്പന്നത്തിലും ബ്രാൻഡിലും ഉപഭോക്താവിന്റെ വിശ്വാസം നേടാൻ എന്തൊക്കെയാണ് അത്യാവശ്യം?',
    good_answer: 'Honesty; strong product knowledge; a live demo; clear warranty and service information; real customer examples; no over-promising; polite and well-groomed; follow-up after the sale.',
    average_answer: 'Mentions two or three of these, without explaining.',
    poor_answer: 'Suggests over-promising or pressure, or has no real answer.',
  },
  {
    code: 'B10', type: 'question', category: 'Brand visibility beyond selling', weight: 5,
    en: 'Apart from selling, what do you do in the store to make the brand visible and get customers’ attention?',
    hi: 'बेचने के अलावा, ब्रांड को दिखाने और ग्राहकों का ध्यान खींचने के लिए आप स्टोर में और क्या करते हैं?',
    ta: 'விற்பனையைத் தவிர, பிராண்ட் கண்ணில் படவும் வாடிக்கையாளர்களின் கவனத்தை ஈர்க்கவும் கடையில் வேறு என்ன செய்வீர்கள்?',
    ml: 'വിൽപ്പനയ്ക്കു പുറമെ, ബ്രാൻഡ് ശ്രദ്ധിക്കപ്പെടാനും ഉപഭോക്താക്കളുടെ ശ്രദ്ധ ആകർഷിക്കാനും സ്റ്റോറിൽ നിങ്ങൾ മറ്റെന്താണ് ചെയ്യുന്നത്?',
    good_answer: 'Keeps the display clean, stocked and correctly priced; POS and branding in place; demo units working; stock register updated; tracks competitor activity; collects leads and customer feedback.',
    average_answer: 'Mentions display and cleanliness only.',
    poor_answer: 'Says that is not their job, or has nothing to add.',
  },
  {
    code: 'B11', type: 'question', category: 'Staying updated', weight: 5,
    en: 'How do you keep your knowledge growing and stay updated on competitors’ products and offers?',
    hi: 'आप अपनी जानकारी कैसे बढ़ाते हैं, और प्रतियोगी कंपनियों के प्रोडक्ट और ऑफ़र के बारे में कैसे अपडेट रहते हैं?',
    ta: 'உங்கள் அறிவை எப்படி வளர்த்துக்கொள்கிறீர்கள்? போட்டி நிறுவனங்களின் பொருட்கள், சலுகைகள் பற்றி எப்படித் தெரிந்துகொள்கிறீர்கள்?',
    ml: 'നിങ്ങളുടെ അറിവ് എങ്ങനെ വളർത്തുന്നു? എതിരാളി കമ്പനികളുടെ ഉൽപ്പന്നങ്ങളെയും ഓഫറുകളെയും കുറിച്ച് എങ്ങനെ അപ്ഡേറ്റഡ് ആയിരിക്കുന്നു?',
    good_answer: 'Attends brand trainings; reads manuals and circulars; checks competitor schemes in nearby stores and online; follows company WhatsApp updates; consults the ASM about changes.',
    average_answer: 'Mentions one or two sources only (e.g. trainings).',
    poor_answer: 'Does not try to stay updated, or relies only on customers telling them.',
  },
  {
    code: 'B12', type: 'question', category: 'Joining and support expected', weight: 5,
    en: 'How soon can you join, and what support do you expect from the brand?',
    hi: 'आप कितनी जल्दी जॉइन कर सकते हैं, और आप ब्रांड से किस तरह के सहयोग की उम्मीद रखते हैं?',
    ta: 'எவ்வளவு விரைவில் வேலையில் சேர முடியும்? பிராண்டிடமிருந்து என்ன மாதிரியான ஆதரவை எதிர்பார்க்கிறீர்கள்?',
    ml: 'എത്ര പെട്ടെന്ന് ജോലിയിൽ ചേരാൻ കഴിയും? ബ്രാൻഡിൽ നിന്ന് എന്തുതരം പിന്തുണയാണ് പ്രതീക്ഷിക്കുന്നത്?',
    good_answer: 'Can join within the notice period (about 7 to 30 days). Expects product training, a clear salary and incentive structure, uniform and materials, and regular manager support. Expectations are realistic.',
    average_answer: 'Joining time is unclear or long, or expectations are vague.',
    poor_answer: 'Cannot give a joining time, or has unrealistic demands.',
  },
];

// Part B item 7 is a role-play, so it is asked as a customer objection (after the questions).
const OBJECTIONS: Draft[] = [
  {
    code: 'B07', type: 'objection', category: 'Handling objections: price', weight: 5,
    en: 'During a demo, the customer says: “Your product is costly.” What do you do?',
    hi: 'डेमो के दौरान ग्राहक कहता है: “आपका प्रोडक्ट महँगा है।” आप क्या करेंगे?',
    ta: 'டெமோ நடக்கும்போது வாடிக்கையாளர் சொல்கிறார்: “உங்கள் பொருள் விலை அதிகம்.” நீங்கள் என்ன செய்வீர்கள்?',
    ml: 'ഡെമോയ്ക്കിടെ ഉപഭോക്താവ് പറയുന്നു: “നിങ്ങളുടെ ഉൽപ്പന്നത്തിന് വില കൂടുതലാണ്.” നിങ്ങൾ എന്തു ചെയ്യും?',
    good_answer: 'Listens without arguing and acknowledges the concern; asks what they are comparing with; shows value (durability, safety, warranty, service) and cost per year of use; offers EMI or a scheme if needed; confirms the objection is resolved, then closes.',
    average_answer: 'Explains quality or offers EMI, but does not ask what they are comparing with or does not try to close.',
    poor_answer: 'Argues, criticises the customer or the competitor, or immediately offers an unauthorised discount.',
  },
];

const rows = [...SCREENING, ...SKILLS, ...OBJECTIONS].map(q);
mkdirSync('content', { recursive: true });
const out = 'content/Sales-Promoter-Question-Bank-DRAFT.xlsx';
writeFileSync(out, await buildSheet(['en', 'hi', 'ta', 'ml'], rows));
console.log(`${out}: ${SCREENING.length} screening + ${SKILLS.length} questions + ${OBJECTIONS.length} objection`);
