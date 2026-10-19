// Kontrollerar en betalning hos Stripe och låser upp hela rapporten.
// Hemligheter (Edge Functions › Secrets): STRIPE_SECRET_KEY (krävs), STRIPE_PAYMENT_LINK_ID (valfri, plink_...), ALLOWED_ORIGINS (valfri).
import { handleVerifyPayment } from '../_shared/logic.ts';
import { restDb, origins, serverKey } from '../_shared/rest.ts';

const env = (k: string) => Deno.env.get(k) || '';
const db = restDb(env('SUPABASE_URL'), serverKey(k => Deno.env.get(k)));

async function stripeSession(id: string) {
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env('STRIPE_SECRET_KEY')}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  return await res.json();
}

Deno.serve(req => handleVerifyPayment(req, {
  db,
  stripeSession: env('STRIPE_SECRET_KEY') ? stripeSession : undefined,
  expectedPaymentLink: env('STRIPE_PAYMENT_LINK_ID') || undefined,
  allowedOrigins: origins(env('ALLOWED_ORIGINS'))
}).catch(e => { console.error(e); return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }); }));
