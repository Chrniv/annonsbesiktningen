/*
  Inställningar för Annonsbesiktningen.
  Allt i den här filen är publikt (det skickas till besökarens webbläsare).
  Lägg ALDRIG in Supabase service_role-nyckeln, Stripes hemliga nyckel eller andra hemligheter här.

  Värdena kan också sättas som miljövariabler i Netlify (Site configuration › Environment variables),
  t.ex. VITE_SUPABASE_URL. Miljövariabeln vinner över värdet i filen.
*/
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const pick = (key, fallback) => (env[key] != null && env[key] !== '' ? env[key] : fallback);

export const CONFIG = {
  productName: 'Annonsbesiktningen',
  agencyName: pick('VITE_AGENCY_NAME', 'Annonsbesiktningen'),          // byråns namn, visas på sidan och i rapporterna
  contactEmail: pick('VITE_CONTACT_EMAIL', 'christerniven@gmail.com'),              // kontaktadress i integritetspolicyn och sidfoten
  reportPrice: pick('VITE_REPORT_PRICE', '495 kr'),          // pris för hela rapporten, visas på sidan

  // Supabase: Project Settings › API. Båda värdena är gjorda för att vara publika.
  supabaseUrl: pick('VITE_SUPABASE_URL', 'https://spcpauapilafiloadbot.supabase.co'),
  supabaseAnonKey: pick('VITE_SUPABASE_ANON_KEY', 'sb_publishable_xp_1noF7gKjTtrUFrK9ikg_m9vXFBMP'),

  // Stripe Payment Link (https://buy.stripe.com/...). Tom = testläge med knappen "simulera betalning".
  // Efter betalning ska länken skicka tillbaka kunden till: https://DIN-SAJT/?betald=1&session_id={CHECKOUT_SESSION_ID}
  paymentUrl: pick('VITE_STRIPE_PAYMENT_LINK', ''),

  productLabel: { column: 'custom_label_4', value: 'exkludera' }, // etikett i Merchant Center-tilläggsflödet för produkter att utesluta
  usdToSek: 9.7,                   // växelkurs för branschsnitt i USD (okt 2026)
  fxToSek: { SEK: 1, USD: 9.7, EUR: 11.0, NOK: 1.0, DKK: 1.48, GBP: 13.0 }, // ungefärliga kurser, okt 2026
  ownBrands: [],                   // egna varumärken som får användas i titlar och annonser, t.ex. ['smartphoto']

  // Statistik (se src/stats.js). "Risk" = sannolikheten att något som egentligen presterar som kontots snitt
  // ändå ser så här dåligt ut av ren slump. Lägre värden = färre men säkrare fynd.
  stats: {
    flagLevel: 0.15,        // flagga sökord, söktermer och produkter när risken att det är otur är högst 15 % ("medel" säkerhet)
    ngramLevel: 0.10,       // strängare för återkommande ord: vi testar hundratals ord, så några ser dåliga ut av slump
    sureLevel: 0.05,        // högst 5 % risk = "hög" säkerhet; krävs också för ord som kontot har egna sökord för
    priorConversions: 1,    // krympning: varje objekt antas ha en konvertering till snittpris i bagaget
    winnerProbability: 0.8  // söktermer föreslås som nya sökord först när de med minst 80 % sannolikhet är bättre än snittet
  },
  leadRetentionMonths: 12,         // hur länge leads sparas; samma siffra står i samtyckestexten och policyn
  benchmarkSource: 'WordStream/LocaliQ Google Ads Benchmarks 2026 (13 474 amerikanska sökkampanjer, apr 2025–mar 2026, medianvärden)'
};

export const backendConfigured = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
