// Builds the DRAFT question bank for the Sales Promoter first round from TTK Prestige's
// "Sales Promoter – First Round Interview Framework" (sections 2–8).
//   npx tsx scripts/build-sales-promoter-first-round-bank.mts
// Left out on purpose: section 1 (candidate details come from the candidate list or the recruiter, not
// the interview), section 6 (family background is not a job requirement; DPDP data minimisation) and
// year of birth (the interview already confirms 18+). Related questions are merged so the interview
// stays near 15 minutes. Q06 (motivation) is added. Hindi, Tamil and Malayalam wording, and the
// average/poor answers, are a first draft: have native-speaking sales managers check them before use.
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

// ---------- Knockouts (sections 5, 7.3 and 8.3): always asked first; a fail flags the interview ----------
const KNOCKOUTS: Draft[] = [
  {
    code: 'K1', type: 'question', category: 'Location and commute', weight: 1,
    en: 'Where are you staying now? How far is it from the store you are applying for, and how will you travel there every day?',
    hi: 'आप अभी कहाँ रहते हैं? जिस स्टोर के लिए आप आवेदन कर रहे हैं, वह आपके घर से कितनी दूर है, और आप रोज़ वहाँ कैसे आएँगे-जाएँगे?',
    ta: 'நீங்கள் இப்போது எங்கே தங்கியிருக்கிறீர்கள்? நீங்கள் விண்ணப்பிக்கும் கடை உங்கள் வீட்டிலிருந்து எவ்வளவு தூரம், தினமும் அங்கே எப்படிச் செல்வீர்கள்?',
    ml: 'നിങ്ങൾ ഇപ്പോൾ എവിടെയാണ് താമസിക്കുന്നത്? നിങ്ങൾ അപേക്ഷിക്കുന്ന കടയിലേക്ക് വീട്ടിൽ നിന്ന് എത്ര ദൂരമുണ്ട്, ദിവസവും അവിടെ എങ്ങനെ പോകും?',
    good_answer: 'Names their area; the store is about an hour or less away; has a clear, reliable way to travel (own two-wheeler, bus, metro or train).',
    average_answer: 'Lives somewhat far or the travel plan is unclear, but is willing to manage.',
    poor_answer: 'Lives very far (more than about 1.5 hours each way) with no plan to travel, or does not say where they live.',
    knockout_rule: 'Can reach the store every day: lives within about an hour’s travel and has a clear way to commute.',
  },
  {
    code: 'K2', type: 'question', category: 'Store timings and standing hours', weight: 1,
    en: 'This job means standing and talking with customers for long hours. Store hours include weekends and festival days, and the weekly off is on a weekday. Are you comfortable with this?',
    hi: 'इस नौकरी में लंबे समय तक खड़े रहकर ग्राहकों से बात करनी होती है। स्टोर में शनिवार-रविवार और त्योहारों पर भी काम होता है, और साप्ताहिक छुट्टी किसी कामकाजी दिन पर मिलती है। क्या यह आपके लिए ठीक है?',
    ta: 'இந்த வேலையில் நீண்ட நேரம் நின்றுகொண்டு வாடிக்கையாளர்களுடன் பேச வேண்டும். வார இறுதி நாட்களிலும் பண்டிகை நாட்களிலும் கடை திறந்திருக்கும்; வார விடுமுறை வார நாட்களில் ஒன்றில் இருக்கும். இது உங்களுக்குச் சரியா?',
    ml: 'ഈ ജോലിയിൽ ദീർഘനേരം നിന്നുകൊണ്ട് ഉപഭോക്താക്കളോട് സംസാരിക്കേണ്ടി വരും. ശനി, ഞായർ ദിവസങ്ങളിലും ഉത്സവ ദിവസങ്ങളിലും കട തുറന്നിരിക്കും; ആഴ്ചയിലെ അവധി ഒരു പ്രവൃത്തി ദിവസമായിരിക്കും. ഇത് നിങ്ങൾക്ക് സമ്മതമാണോ?',
    good_answer: 'A clear yes, ideally mentioning past work with similar hours, weekend or festival duty.',
    average_answer: 'Yes, but hesitant or with conditions (e.g. some Sundays off).',
    poor_answer: 'No; needs every Sunday off, cannot work festivals, or cannot stand for long hours.',
    knockout_rule: 'Clearly agrees to long standing hours, weekend and festival working, and a weekday weekly off.',
  },
  {
    code: 'K3', type: 'question', category: 'Joining time', weight: 1,
    en: 'If you are selected, how soon can you join?',
    hi: 'अगर आपका चयन होता है, तो आप कितनी जल्दी जॉइन कर सकते हैं?',
    ta: 'நீங்கள் தேர்ந்தெடுக்கப்பட்டால், எவ்வளவு விரைவில் வேலையில் சேர முடியும்?',
    ml: 'നിങ്ങളെ തിരഞ്ഞെടുത്താൽ, എത്ര വേഗം ജോലിയിൽ ചേരാൻ കഴിയും?',
    good_answer: 'Immediately or within 15 days, with a clear date or notice period.',
    average_answer: 'Within 15 to 30 days, or unsure of the exact date.',
    poor_answer: 'More than 30 days, or cannot say.',
    knockout_rule: 'Can join within 30 days.',
  },
];

// ---------- Scored questions (sections 2, 3, 4, 7 and 8) ----------
const QUESTIONS: Draft[] = [
  {
    code: 'Q01', type: 'question', category: 'Sales experience', weight: 4,
    en: 'Tell us about your sales experience. Which companies have you worked for, which stores or outlets were you placed in, and how long did you work at each? What is your total work experience?',
    hi: 'अपने सेल्स अनुभव के बारे में बताइए। आपने किन कंपनियों में काम किया है, आप किन स्टोर या आउटलेट में तैनात थे, और हर जगह कितने समय तक काम किया? आपका कुल कार्य-अनुभव कितना है?',
    ta: 'உங்கள் விற்பனை அனுபவத்தைப் பற்றிச் சொல்லுங்கள். எந்தெந்த நிறுவனங்களில் வேலை செய்தீர்கள், எந்தக் கடைகளில் அல்லது அவுட்லெட்களில் பணியமர்த்தப்பட்டீர்கள், ஒவ்வொன்றிலும் எவ்வளவு காலம் வேலை செய்தீர்கள்? உங்கள் மொத்த வேலை அனுபவம் எவ்வளவு?',
    ml: 'നിങ്ങളുടെ സെയിൽസ് അനുഭവത്തെക്കുറിച്ച് പറയൂ. ഏതൊക്കെ കമ്പനികളിൽ ജോലി ചെയ്തു, ഏതൊക്കെ കടകളിലോ ഔട്ട്‌ലെറ്റുകളിലോ ആയിരുന്നു നിയമനം, ഓരോയിടത്തും എത്ര കാലം ജോലി ചെയ്തു? നിങ്ങളുടെ ആകെ പ്രവൃത്തിപരിചയം എത്രയാണ്?',
    good_answer: 'In-store retail sales experience with the companies, stores and durations named; stable tenures (about a year or more each); gives a clear total.',
    average_answer: 'Some sales experience, but vague, with short stints, or in non-retail sales; or a fresher with other customer-facing work.',
    poor_answer: 'No sales or customer-facing experience, or a history that is vague or contradictory.',
  },
  {
    code: 'Q02', type: 'question', category: 'Reason for leaving', weight: 1,
    en: 'Why did you leave your last job, or why do you want to leave it?',
    hi: 'आपने अपनी पिछली नौकरी क्यों छोड़ी, या क्यों छोड़ना चाहते हैं?',
    ta: 'உங்கள் கடைசி வேலையை ஏன் விட்டீர்கள், அல்லது ஏன் விட விரும்புகிறீர்கள்?',
    ml: 'നിങ്ങളുടെ കഴിഞ്ഞ ജോലി എന്തിനാണ് വിട്ടത്, അല്ലെങ്കിൽ എന്തിനാണ് വിടാൻ ആഗ്രഹിക്കുന്നത്?',
    good_answer: 'A clear, honest reason (growth, a better brand, relocation, contract ended) and speaks respectfully about the previous employer.',
    average_answer: 'A vague reason without detail.',
    poor_answer: 'Blames the previous employer harshly, avoids the question, or describes repeated conflicts.',
  },
  {
    code: 'Q03', type: 'question', category: 'Category knowledge', weight: 3,
    en: 'Which products and categories have you sold before? Have you sold kitchen appliances such as pressure cookers, cookware, mixer grinders or gas stoves?',
    hi: 'आपने पहले कौन-से प्रोडक्ट और कैटेगरी बेची हैं? क्या आपने प्रेशर कुकर, कुकवेयर, मिक्सर ग्राइंडर या गैस स्टोव जैसे किचन अप्लायंसेज़ बेचे हैं?',
    ta: 'இதற்கு முன் எந்தெந்தப் பொருட்களையும் வகைகளையும் விற்றிருக்கிறீர்கள்? பிரஷர் குக்கர், சமையல் பாத்திரங்கள், மிக்ஸர் கிரைண்டர் அல்லது கேஸ் அடுப்பு போன்ற சமையலறை சாதனங்களை விற்றிருக்கிறீர்களா?',
    ml: 'മുമ്പ് ഏതൊക്കെ ഉൽപ്പന്നങ്ങളും വിഭാഗങ്ങളുമാണ് നിങ്ങൾ വിറ്റിട്ടുള്ളത്? പ്രഷർ കുക്കർ, പാചക പാത്രങ്ങൾ, മിക്സർ ഗ്രൈൻഡർ, ഗ്യാസ് സ്റ്റൗ തുടങ്ങിയ അടുക്കള ഉപകരണങ്ങൾ വിറ്റിട്ടുണ്ടോ?',
    good_answer: 'Has sold kitchen or home appliances or other consumer durables; names products and brands and can explain a feature of one.',
    average_answer: 'Has sold a related category (electronics, consumer goods, FMCG) but not kitchen appliances.',
    poor_answer: 'Has not sold products, or cannot name the categories handled.',
  },
  {
    code: 'Q04', type: 'question', category: 'Sales achievement', weight: 3,
    en: 'What were your average monthly sales, and how did that compare with your target? Give an example of a good month.',
    hi: 'आपकी औसत मासिक बिक्री कितनी थी, और वह आपके टारगेट की तुलना में कैसी थी? किसी अच्छे महीने का उदाहरण दीजिए।',
    ta: 'உங்கள் சராசரி மாத விற்பனை எவ்வளவு, அது உங்கள் இலக்குடன் ஒப்பிடும்போது எப்படி இருந்தது? நன்றாக விற்ற ஒரு மாதத்தின் உதாரணம் சொல்லுங்கள்.',
    ml: 'നിങ്ങളുടെ ശരാശരി പ്രതിമാസ വിൽപ്പന എത്രയായിരുന്നു, അത് ടാർഗറ്റുമായി താരതമ്യം ചെയ്യുമ്പോൾ എങ്ങനെയായിരുന്നു? നല്ല വിൽപ്പന നടന്ന ഒരു മാസത്തിന്റെ ഉദാഹരണം പറയൂ.',
    good_answer: 'Gives specific figures (units or rupees) against the target (e.g. 100–120% achieved) and an example of what they did in a good month.',
    average_answer: 'Gives approximate figures without comparing them with a target.',
    poor_answer: 'Gives no figures, or does not know their sales.',
  },
  {
    code: 'Q05', type: 'question', category: 'Brand awareness', weight: 3,
    en: 'What do you know about TTK Prestige? Have you seen or used Prestige products? Name any Prestige products or categories you know.',
    hi: 'TTK प्रेस्टीज के बारे में आप क्या जानते हैं? क्या आपने प्रेस्टीज के प्रोडक्ट देखे या इस्तेमाल किए हैं? प्रेस्टीज के जो भी प्रोडक्ट या कैटेगरी आप जानते हैं, उनके नाम बताइए।',
    ta: 'TTK பிரெஸ்டீஜ் பற்றி உங்களுக்கு என்ன தெரியும்? பிரெஸ்டீஜ் பொருட்களைப் பார்த்திருக்கிறீர்களா அல்லது பயன்படுத்தியிருக்கிறீர்களா? உங்களுக்குத் தெரிந்த பிரெஸ்டீஜ் பொருட்கள் அல்லது வகைகளின் பெயர்களைச் சொல்லுங்கள்.',
    ml: 'TTK പ്രസ്റ്റീജിനെക്കുറിച്ച് നിങ്ങൾക്ക് എന്തറിയാം? പ്രസ്റ്റീജ് ഉൽപ്പന്നങ്ങൾ കാണുകയോ ഉപയോഗിക്കുകയോ ചെയ്തിട്ടുണ്ടോ? നിങ്ങൾക്കറിയാവുന്ന പ്രസ്റ്റീജ് ഉൽപ്പന്നങ്ങളുടെയോ വിഭാഗങ്ങളുടെയോ പേരുകൾ പറയൂ.',
    good_answer: 'Knows Prestige is a well-known Indian kitchen appliance brand, best known for pressure cookers; names three or more categories such as pressure cookers, non-stick cookware, gas stoves, mixer grinders, induction cooktops or electric kettles; may share personal or family use.',
    average_answer: 'Knows the brand and names one or two products.',
    poor_answer: 'Has not heard of the brand, or cannot name any product.',
  },
  {
    code: 'Q06', type: 'question', category: 'Motivation', weight: 3,
    en: 'Why do you want to work as a sales promoter for Prestige?',
    hi: 'आप प्रेस्टीज के लिए सेल्स प्रमोटर के रूप में काम क्यों करना चाहते हैं?',
    ta: 'பிரெஸ்டீஜுக்காக சேல்ஸ் ப்ரோமோட்டராக ஏன் வேலை செய்ய விரும்புகிறீர்கள்?',
    ml: 'പ്രസ്റ്റീജിനായി സെയിൽസ് പ്രൊമോട്ടറായി ജോലി ചെയ്യാൻ നിങ്ങൾ എന്തിനാണ് ആഗ്രഹിക്കുന്നത്?',
    good_answer: 'Enjoys meeting customers and selling, wants to grow in retail, values working with a trusted brand; may mention incentives as a reason to sell more.',
    average_answer: 'A general reason such as needing a job, with no link to sales or the brand.',
    poor_answer: 'No reason, or clearly sees it as a short stop until something else comes up.',
  },
  {
    code: 'Q07', type: 'question', category: 'Customer approach', weight: 5,
    en: 'A customer walks into the store and stops near the Prestige section. How do you approach them, and what do you do next?',
    hi: 'एक ग्राहक स्टोर में आता है और प्रेस्टीज सेक्शन के पास रुकता है। आप उनसे कैसे बात शुरू करेंगे, और उसके बाद क्या करेंगे?',
    ta: 'ஒரு வாடிக்கையாளர் கடைக்குள் வந்து பிரெஸ்டீஜ் பகுதியின் அருகே நிற்கிறார். அவரை எப்படி அணுகுவீர்கள், அதன் பிறகு என்ன செய்வீர்கள்?',
    ml: 'ഒരു ഉപഭോക്താവ് കടയിൽ വന്ന് പ്രസ്റ്റീജ് വിഭാഗത്തിനടുത്ത് നിൽക്കുന്നു. നിങ്ങൾ അവരെ എങ്ങനെ സമീപിക്കും, അതിനുശേഷം എന്തു ചെയ്യും?',
    good_answer: 'Greets warmly and offers help without pressure; asks what they need and for whom (family size, cooking habits, budget); recommends a suitable product; gives a demo and explains benefits; mentions warranty and current offers; asks for the sale.',
    average_answer: 'Greets and shows products, but does not ask about needs or does not try to close.',
    poor_answer: 'Pushes the costliest product straight away, waits for the customer to ask, or has no clear approach.',
  },
  {
    code: 'Q08', type: 'question', category: 'Salary (for information)', weight: 1,
    en: 'What was your last monthly salary, and what salary do you expect for this job?',
    hi: 'आपकी पिछली मासिक सैलरी कितनी थी, और इस नौकरी के लिए आप कितनी सैलरी की उम्मीद करते हैं?',
    ta: 'உங்கள் கடைசி மாதச் சம்பளம் எவ்வளவு, இந்த வேலைக்கு எவ்வளவு சம்பளம் எதிர்பார்க்கிறீர்கள்?',
    ml: 'നിങ്ങളുടെ അവസാന മാസശമ്പളം എത്രയായിരുന്നു, ഈ ജോലിക്ക് എത്ര ശമ്പളം പ്രതീക്ഷിക്കുന്നു?',
    good_answer: 'Gives both figures clearly; the expectation is reasonable compared with the last salary; open to incentive-based pay.',
    average_answer: 'Gives only one figure, or a vague range.',
    poor_answer: 'Refuses to say, or the expectation is far above the last salary with no reason.',
  },
];

// Section 7.2 ("convince a customer to buy over a competitor's product") is a role-play, so it is an objection.
const OBJECTIONS: Draft[] = [
  {
    code: 'OBJ01', type: 'objection', category: 'Competitor objection', weight: 5,
    en: 'A customer says: “The other brand’s mixer grinder looks just as good and costs less. Why should I buy Prestige?” What do you say?',
    hi: 'ग्राहक कहता है: “दूसरे ब्रांड का मिक्सर ग्राइंडर भी उतना ही अच्छा दिखता है और सस्ता है। मैं प्रेस्टीज क्यों खरीदूँ?” आप क्या कहेंगे?',
    ta: 'வாடிக்கையாளர் சொல்கிறார்: “வேறு பிராண்டின் மிக்ஸர் கிரைண்டரும் இதே அளவு நன்றாகத் தெரிகிறது, விலையும் குறைவு. நான் ஏன் பிரெஸ்டீஜ் வாங்க வேண்டும்?” நீங்கள் என்ன சொல்வீர்கள்?',
    ml: 'ഉപഭോക്താവ് പറയുന്നു: “മറ്റൊരു ബ്രാൻഡിന്റെ മിക്സർ ഗ്രൈൻഡറും ഇത്രയും നല്ലതായി തോന്നുന്നു, വിലയും കുറവാണ്. ഞാൻ എന്തിന് പ്രസ്റ്റീജ് വാങ്ങണം?” നിങ്ങൾ എന്തു പറയും?',
    good_answer: 'Acknowledges the point and asks what matters most to the customer; compares on value: motor and durability, safety features, jar quality, warranty and service network, brand trust; offers a demo; mentions any scheme or EMI; never runs down the other brand; asks for the sale.',
    average_answer: 'Mentions quality or warranty in general terms, without linking it to the customer’s need or trying to close.',
    poor_answer: 'Criticises the other brand or the customer, or just offers a discount with no reason.',
    must_mention: ['warranty', 'service'],
  },
];

const rows = [...KNOCKOUTS, ...QUESTIONS, ...OBJECTIONS].map(q);
mkdirSync('content', { recursive: true });
const out = 'content/Sales-Promoter-First-Round-Bank-DRAFT.xlsx';
writeFileSync(out, await buildSheet(['en', 'hi', 'ta', 'ml'], rows));
console.log(`${out}: ${KNOCKOUTS.length} knockouts + ${QUESTIONS.length} questions + ${OBJECTIONS.length} objection`);
