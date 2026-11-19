/*
  Inloggning mot Google för att hämta rapporter direkt (OAuth 2.0 med PKCE). Körs i webbläsaren.
  Bytet av kod mot token sker i Edge Function google-ads, där klienthemligheten finns.
  sessionStorage håller bara slumpvärdena för den här inloggningen och startsvaren, så att de finns kvar när Google skickar tillbaka besökaren.
*/
import { CONFIG, backendConfigured } from './config.js';

const KEY = 'annonsbesiktning:google';
const MAX_AGE = 30 * 60 * 1000;
export const ADWORDS_SCOPE = 'https://www.googleapis.com/auth/adwords';
export const googleEnabled = () => !!CONFIG.googleClientId && backendConfigured();

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const redirectUri = () => location.origin + location.pathname;

/** Skickar besökaren till Googles inloggning. `saved` (startsvaren) kommer tillbaka från takeGoogleReturn(). */
export async function startGoogleConnect(saved) {
  const verifier = random(32);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = random(16);
  sessionStorage.setItem(KEY, JSON.stringify({ state, verifier, saved: saved || null, at: Date.now() }));
  const p = new URLSearchParams({
    client_id: CONFIG.googleClientId, redirect_uri: redirectUri(), response_type: 'code', scope: ADWORDS_SCOPE,
    access_type: 'online', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
  });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p.toString());
}

/**
 * Läser svaret när Google skickar tillbaka besökaren och tar bort det ur adressen.
 * Returnerar null (ingen inloggning pågick), { error, saved } eller { code, verifier, saved }.
 */
export function takeGoogleReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('state') || !(q.has('code') || q.has('error'))) return null;
  const code = q.get('code'), error = q.get('error'), state = q.get('state');
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY); } catch (e) { s = null; }
  ['code', 'state', 'scope', 'error', 'error_description', 'error_uri', 'authuser', 'prompt', 'hd', 'iss'].forEach(k => q.delete(k));
  try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash); } catch (e) { /* ok */ }
  if (!s || s.state !== state || Date.now() - s.at > MAX_AGE) return { error: 'state', saved: s && s.saved };
  if (error) return { error: error === 'access_denied' ? 'denied' : 'oauth', saved: s.saved };
  return { code, verifier: s.verifier, saved: s.saved };
}

/** Kontonummer som i Google Ads: 123-456-7890 */
export const fmtCustomerId = id => String(id || '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');

/** Perioden som hämtas: de senaste `days` dagarna till och med i går, i lokal tid. */
export function apiPeriod(days, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  const to = new Date(d); to.setDate(to.getDate() - 1);
  const from = new Date(to); from.setDate(from.getDate() - (days - 1));
  return { from: iso(from), to: iso(to) };
}

/** Text till besökaren för ett fel från Edge Function eller Google. */
export function googleErrorText(err) {
  const d = (err && err.data) || {}, reason = String(d.reason || ''), code = String(d.error || (err && err.message) || '');
  if (code === 'denied') return 'Du avbröt inloggningen hos Google. Inget hämtades.';
  if (code === 'state') return 'Inloggningen kunde inte kontrolleras. Försök igen.';
  if (code === 'session') return 'Kopplingen till Google Ads har gått ut. Koppla igen.';
  if (code === 'scope') return 'Google gav inte behörighet till Google Ads. Försök igen och godkänn åtkomsten.';
  if (code === 'not_configured') return 'Kopplingen till Google Ads är inte klar än. Ladda upp CSV-filer så länge.';
  if (/PERMISSION_DENIED|USER_PERMISSION/.test(reason)) return 'Ditt Google-konto har inte behörighet till det annonskontot.';
  if (/CUSTOMER_NOT_ENABLED|NOT_ACTIVE|CANCELED/.test(reason)) return 'Annonskontot är inte aktivt.';
  if (/DEVELOPER_TOKEN|ACCESS_LEVEL|NOT_APPROVED|PROJECT|TEST_ACCOUNT/.test(reason)) return 'Google har inte godkänt kopplingen för det här kontot än. Ladda upp CSV-filer så länge.';
  if (/QUOTA|RESOURCE_EXHAUSTED|RATE/.test(reason)) return 'Google Ads tar inte emot fler frågor just nu. Försök igen om en stund, eller ladda upp CSV-filer.';
  if (code === 'oauth') return 'Inloggningen hos Google gick inte igenom. Försök igen.';
  return 'Google Ads svarade inte som väntat. Försök igen, eller ladda upp CSV-filer.';
}
