# Annonsbesiktningen

Gratis granskning av Google Ads-konton som leadmagnet. Besökaren laddar upp exporter från Google Ads, får ett betyg och de viktigaste fynden, lämnar e-post för sammanfattningen och kan köpa hela rapporten (PDF, Excel, CSV, negativa sökord, pauslistor, produktuteslutningar och nya produkttitlar).

## Så hänger det ihop

| Del | Var | Vad |
| --- | --- | --- |
| Webbsidan | Netlify (byggs från GitHub) | Hela analysen körs i besökarens webbläsare. Filerna lämnar aldrig datorn. |
| Databas | Supabase (Stockholm) | Leads, köp och admins. Ingen besökare kan läsa något; bara admins. |
| `submit-lead` | Supabase Edge Function | Sparar en lead när besökaren lämnar e-post och samtycke. Mejlar dig (valfritt, via Resend). |
| `verify-payment` | Supabase Edge Function | Frågar Stripe om betalningen är klar innan hela rapporten låses upp. |
| Betalning | Stripe Payment Link | Kunden betalar hos Stripe och skickas tillbaka till sidan. |

```
index.html, integritetspolicy.html   sidorna
src/engine.js      analysmotorn (ren logik, ingen DOM) – läser exporter och räknar fram fynd
src/ui.js          gränssnittet
src/backend.js     allt som pratar med Supabase
src/config.js      inställningar (byrånamn, pris, Supabase-adress, betallänk)
public/embed.js    inbäddning på andra webbplatser
supabase/          databasschema och Edge Functions
tests/             tester (npm test)
```

## Kom igång (en gång, cirka 30 minuter)

### 1. Supabase
1. Skapa projektet `annonsbesiktningen`, region **North EU (Stockholm)**.
2. **SQL Editor › New query**: klistra in hela `supabase/migrations/001_init.sql` och kör.
   Kör sedan, med din e-post: `insert into public.admins (email) values ('din@epost.se');`
3. **Edge Functions › Deploy a new function › Via Editor**, två gånger:
   - namn `submit-lead`, klistra in `supabase/deploy/submit-lead.ts`
   - namn `verify-payment`, klistra in `supabase/deploy/verify-payment.ts`
   - Stäng av **Verify JWT** på båda (funktionerna skyddar sig själva).
   (Filerna skapas med `npm run functions`. Med Supabase CLI räcker `supabase functions deploy`.)
4. **Edge Functions › Secrets** (alla valfria tills du tar betalt):
   - `ALLOWED_ORIGINS` = sidans adress, t.ex. `https://annonsbesiktningen.netlify.app` (flera med komma)
   - `SITE_URL` = samma adress (används i lead-mejlet)
   - `RESEND_API_KEY`, `NOTIFY_EMAIL`, `NOTIFY_FROM` för mejl om nya leads
   - `STRIPE_SECRET_KEY`, `STRIPE_PAYMENT_LINK_ID` för betalningar (se steg 4)
5. **Authentication › URL Configuration**: sätt *Site URL* till sidans adress och lägg till `https://DIN-SAJT/**` under *Redirect URLs*. Annars fungerar inte inloggningslänken.

### 2. Inställningar
Fyll i `src/config.js` (eller motsvarande miljövariabler i Netlify):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AGENCY_NAME`, `VITE_CONTACT_EMAIL`, `VITE_REPORT_PRICE`, `VITE_STRIPE_PAYMENT_LINK`.
Allt där är publikt. Lägg aldrig in hemliga nycklar.

### 3. Netlify
**Add new site › Import from GitHub** och välj repot. Bygginställningarna läses från `netlify.toml`.

### 4. Stripe (när du vill ta betalt)
1. **Payment Links › New**: produkten "Fullständig rapport", 495 kr.
2. Under **After payment** väljer du *Don't show confirmation page* och anger
   `https://DIN-SAJT/?betald=1&session_id={CHECKOUT_SESSION_ID}`
3. Lägg länken (`https://buy.stripe.com/...`) i `VITE_STRIPE_PAYMENT_LINK`.
4. Skapa en **restricted key** med läsrätt för *Checkout Sessions* och lägg den som `STRIPE_SECRET_KEY` i Supabase. Länkens id (`plink_...`) blir `STRIPE_PAYMENT_LINK_ID`.

Utan betallänk visar sidan en knapp för att simulera betalning, så att du kan testa leveransen.

## Använda

- **Admin:** öppna `https://DIN-SAJT/#admin`, skriv din e-post och klicka på länken du får. Du ser alla leads, kan öppna varje protokoll och växla till "Visa som prospekt".
- **Bädda in** på din byråsajt:
  ```html
  <div id="annonsbesiktningen"></div>
  <script src="https://DIN-SAJT/embed.js" async></script>
  ```
- **Leads raderas** automatiskt efter 12 månader. Köp sparas i sju år (bokföringslagen).

## Utveckla

```
npm install
npm run dev        # lokal server
npm test           # motor- och funktionstester
npm run build      # bygger dist/
npm run functions  # buntar Edge Functions för dashboarden
```

Inställningar som påverkar analysen (växelkurser, egna varumärken, branschsnitt) finns i `src/config.js` och överst i `src/engine.js`.
