// Hämtar rapporter direkt från Google Ads, bara läsning. Se _shared/googleAds.ts för flödet.
// Hemligheter (Edge Functions › Secrets):
//   GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (krävs, från Google Cloud › Klienter)
//   GOOGLE_ADS_SEAL_KEY (krävs, minst 32 slumpade tecken)
//   GOOGLE_ADS_API_VERSION (valfri, t.ex. v26), GOOGLE_ADS_DEVELOPER_TOKEN (valfri, behövs inte längre), ALLOWED_ORIGINS
import { handleGoogleAds } from '../_shared/googleAds.ts';
import { origins } from '../_shared/rest.ts';

const env = (k: string) => Deno.env.get(k) || '';

Deno.serve(req => handleGoogleAds(req, {
  clientId: env('GOOGLE_OAUTH_CLIENT_ID'),
  clientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'),
  sealKey: env('GOOGLE_ADS_SEAL_KEY'),
  apiVersion: env('GOOGLE_ADS_API_VERSION') || undefined,
  developerToken: env('GOOGLE_ADS_DEVELOPER_TOKEN') || undefined,
  allowedOrigins: origins(env('ALLOWED_ORIGINS'))
}).catch(e => { console.error(e); return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }); }));
