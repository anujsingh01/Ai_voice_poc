// Starting drafts for the candidate privacy notice (DPDP Act 2023, Rules 2025, Rule 3).
// They must be reviewed by the tenant's legal/HR reviewer before go-live; this is not legal advice.
// {company}, {days} and {contact} are filled in when shown.

export const DEFAULT_CONSENT: Record<string, string> = {
  en: `{company} uses this voice interview to assess your suitability for the job you applied for.

What we collect: your name, phone number or email, your age confirmation, and the audio recordings and text of your answers.

How it is used: your answers are converted to text on {company}'s own computers. The text, with your name and phone number hidden, is scored by an AI service against the company's model answers. A recruiter at {company} reviews the result and makes every decision; nothing is decided by the AI alone.

Where it is kept: in India. It is deleted automatically {days} days after your interview, and we tell you 48 hours before deletion.

Your rights: you can withdraw consent at any time using the link in your messages, and ask to see, correct or delete your data. Withdrawing does not affect anything done before.

Questions or complaints: {contact}. If you are not satisfied, you may complain to the Data Protection Board of India.

By continuing, you confirm you are 18 or older and agree to this.`,
  hi: `{company} इस वॉइस इंटरव्यू से यह आँकता है कि आप जिस नौकरी के लिए आवेदन कर रहे हैं, उसके लिए आप कितने उपयुक्त हैं।

हम क्या लेते हैं: आपका नाम, फ़ोन नंबर या ईमेल, आपकी उम्र की पुष्टि, और आपके जवाबों की रिकॉर्डिंग व उनका टेक्स्ट।

इसका उपयोग कैसे होता है: आपके जवाब {company} के अपने कंप्यूटरों पर टेक्स्ट में बदले जाते हैं। आपका नाम और फ़ोन नंबर छिपाकर, यह टेक्स्ट एक AI सेवा द्वारा कंपनी के मॉडल उत्तरों से मिलाकर स्कोर किया जाता है। हर फ़ैसला {company} का रिक्रूटर लेता है; AI अकेले कोई फ़ैसला नहीं करता।

डेटा कहाँ रहता है: भारत में। इंटरव्यू के {days} दिन बाद यह अपने आप मिटा दिया जाता है, और मिटाने से 48 घंटे पहले हम आपको सूचना देते हैं।

आपके अधिकार: आप अपने संदेशों में दिए गए लिंक से कभी भी सहमति वापस ले सकते हैं, और अपना डेटा देखने, सुधारने या मिटाने के लिए कह सकते हैं। सहमति वापस लेने से पहले हुए काम पर असर नहीं पड़ता।

सवाल या शिकायत: {contact}। संतुष्ट न होने पर आप भारतीय डेटा संरक्षण बोर्ड (Data Protection Board of India) में शिकायत कर सकते हैं।

आगे बढ़कर आप पुष्टि करते हैं कि आपकी उम्र 18 वर्ष या उससे अधिक है और आप इससे सहमत हैं।`,
};

export function fillConsent(text: string, v: { company: string; days: number; contact: string }) {
  return text.replaceAll('{company}', v.company).replaceAll('{days}', String(v.days)).replaceAll('{contact}', v.contact);
}
