# Flytta Annonsbesiktningen till Lovable

Lovable kan inte koppla sig till ett befintligt GitHub-repo. I stället importerar man koden som en ZIP-fil, och Lovable bygger om appen på sin egen plattform (TanStack Start eller React + Vite). Den här filen beskriver vad som ska följa med och hur man håller det enkelt.

## Före importen

1. Ladda ner repot som ZIP: GitHub › **Code › Download ZIP**.
2. I Lovable: **New project › Import** och ladda upp ZIP-filen.
3. Ge Lovable den här instruktionen (klistra in):

> Detta är en Vite-app i vanilla JavaScript. Behåll `src/engine.js`, `src/stats.js` och `src/config.js` oförändrade: de innehåller all analyslogik och är testade (`tests/engine.test.js`, `tests/stats.test.js`). Bygg om gränssnittet i `index.html` och `src/ui.js` som React-komponenter med samma texter och samma flöde: startfrågor → uppladdning → resultat → e-post och samtycke → sammanfattning → köp → leverans med nedladdningar. Behåll `src/backend.js` som enda ställe som pratar med databasen. Behåll Edge Functions `submit-lead` och `verify-payment` och databasschemat i `supabase/migrations/001_init.sql`, inklusive radnivåskyddet (bara admins får läsa leads).

## Det som är viktigt att bevara

| Del | Varför |
| --- | --- |
| `src/engine.js` | All analys, branschsnitt, besparingsmodell, negativa sökord och titelmotor. Ren logik, inga beroenden. |
| `src/stats.js` | Statistiken bakom säkerheten och krympningen. Ren matematik, inga beroenden. |
| Radnivåskyddet i databasen | Besökare får aldrig läsa leads. Bara e-post i tabellen `admins`. |
| `verify-payment` | Hela rapporten låses bara upp när Stripe bekräftat betalningen. |
| Samtyckestexten och integritetspolicyn | Krävs för att spara leads enligt GDPR. |
| Filerna analyseras i webbläsaren | Ett löfte på sidan: rapporterna lämnar inte besökarens dator förrän hen lämnar e-post. |

## Databasen

Lovable flyttar normalt databasen till **Lovable Cloud** vid import. Två vägar:

- **Behåll din Supabase** (enklast att flytta tillbaka från): koppla Lovable till ditt befintliga Supabase-projekt under *Integrations › Supabase* i stället för Lovable Cloud.
- **Lovable Cloud**: kör `supabase/migrations/001_init.sql` där, lägg in dig själv i `admins`, sätt samma hemligheter (`STRIPE_SECRET_KEY` m.fl.) och flytta befintliga leads med en CSV-export från Supabase (*Table editor › leads › Export*).

## Efter importen: testa detta

- [ ] Exemplet laddas och visar betyg och fynd
- [ ] Uppladdade filer känns igen (kampanjer, söktermer, sökord, produkter)
- [ ] E-post + samtycke skapar en rad i `leads`
- [ ] Testköp (utan betallänk) visar leveransen; PDF, Excel och CSV laddas ner
- [ ] Riktigt köp via Stripe låser upp rapporten, även i en annan webbläsare
- [ ] `#admin` skickar inloggningslänk, och bara admins ser leads
- [ ] `npm test` går igenom
