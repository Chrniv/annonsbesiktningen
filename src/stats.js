/* Annonsbesiktningen – statistik. Ren matematik utan beroenden.

   Två idéer, samma som försäkringsbolagen använder sedan 1700-talet:

   1. Risk att det är otur
      En sökterm som kostat 3 gånger kontots kostnad per konvertering "borde" ha gett ungefär 3 konverteringar
      om den presterade som resten av kontot. Har den gett 0 är frågan: hur ofta händer det av ren slump?
      Antalet konverteringar följer en Poissonfördelning, så svaret är P(X ≤ konv | λ = kostnad / referens-CPA).
      Är risken liten (under t.ex. 15 %) är termen troligen sämre på riktigt, inte bara otursam.

   2. Krympning mot snittet (Bayes)
      Små tal är opålitliga: 2 konverteringar på 10 klick ser ut som 20 % konverteringsgrad men är mest tur.
      Vi låtsas att varje sökord, produkt och kampanj redan har "en konvertering till snittpris" i bagaget
      (priorConversions i config.js). Med lite data dominerar snittet, med mycket data dominerar sökordets egna siffror.
      Samma antagande ger också sannolikheten att något verkligen är bättre än snittet. */

/* ---------- Gammafunktioner (Numerical Recipes) ---------- */
const LANCZOS = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
function lnGamma(x) {
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of LANCZOS) ser += c / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
// Nedre regulariserade gammafunktionen P(a, x) som serie (bra för x < a + 1)
function gammaSeries(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 500; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}
// Övre regulariserade gammafunktionen Q(a, x) som kedjebråk (bra för x ≥ a + 1)
function gammaContFrac(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
/** Övre regulariserade gammafunktionen Q(a, x) = 1 − P(a, x). */
export function gammaQ(a, x) {
  if (!(a > 0)) return 0;
  if (!(x > 0)) return 1;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContFrac(a, x);
}

/** P(X ≤ k) för X ~ Poisson(λ). k får vara ett decimaltal (Google räknar delade konverteringar), då används den kontinuerliga formen. */
export function poissonCdf(k, lambda) {
  if (!(lambda > 0)) return 1;
  if (k < 0) return 0;
  return clamp01(gammaQ(k + 1, lambda));
}

/* ---------- 1. Risk att det är otur ---------- */
/**
 * Sannolikheten att något som egentligen presterar på referensnivån ändå bara får `conv` konverteringar för `cost`.
 * Liten risk = troligen sämre på riktigt.
 * @param {number} cost      kostnad under perioden
 * @param {number} conv      konverteringar under perioden
 * @param {number} refCpa    kostnad per konvertering som räknas som "normalt" (kontots snitt eller break-even)
 */
export function badLuckChance(cost, conv, refCpa) {
  if (!(refCpa > 0) || !(cost > 0)) return 1;
  return poissonCdf(Math.max(0, conv || 0), cost / refCpa);
}

/** Lägsta kostnad utan konvertering som behövs för att risken att det är otur ska vara högst `level`. */
export function minCostWithoutConversion(refCpa, level) {
  return refCpa * -Math.log(level);
}

/** Säkerheten som visas för kunden: 1 − risken att det är otur. */
export const certainty = p => clamp01(1 - p);

/** "hög" (risk ≤ sureLevel), "medel" (risk ≤ flagLevel) eller null. */
export function confidenceTier(p, levels) {
  if (p <= levels.sureLevel) return 'hög';
  if (p <= levels.flagLevel) return 'medel';
  return null;
}

/** Kort text till listor och rapporter, t.ex. "97 % säkert". Aldrig 100 %: något utrymme för slump finns alltid. */
export function certaintyText(p) {
  const c = Math.min(99, Math.floor(certainty(p) * 100));
  return `${c} % säkert`;
}

/* ---------- 2. Krympning mot snittet ---------- */
/** Kostnad per konvertering efter krympning: som om objektet hade k extra konverteringar till referenspris. */
export function shrunkCpa(cost, conv, refCpa, k) {
  return (cost + k * refCpa) / ((conv || 0) + k);
}

/** Andel (t.ex. konverteringsgrad) efter krympning: k extra "lyckade" på k / snittandel försök. */
export function shrunkRate(successes, trials, refRate, k) {
  if (!(refRate > 0)) return trials > 0 ? successes / trials : null;
  return ((successes || 0) + k) / ((trials || 0) + k / refRate);
}

/** ROAS efter krympning: som om objektet hade spenderat priorCost till snittets ROAS. */
export function shrunkRoas(cost, value, refRoas, priorCost) {
  return ((value || 0) + priorCost * refRoas) / ((cost || 0) + priorCost);
}

/**
 * Förväntad merkostnad jämfört med referensnivån, efter krympning.
 * Det är den del av kostnaden som troligen inte skulle ha behövts om objektet presterade som snittet.
 */
export function shrunkExcess(cost, conv, refCpa, k) {
  if (!(cost > 0) || !(refCpa > 0)) return 0;
  return Math.max(0, cost - cost * refCpa / shrunkCpa(cost, conv, refCpa, k));
}

/**
 * Sannolikheten att objektets verkliga kostnad per konvertering är lägre än referensen
 * (gammafördelning för konverteringar per krona, med k konverteringar till referenspris som förkunskap).
 */
export function probBetter(cost, conv, refCpa, k) {
  if (!(refCpa > 0)) return 0;
  return clamp01(gammaQ(k + Math.max(0, conv || 0), k + Math.max(0, cost || 0) / refCpa));
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
