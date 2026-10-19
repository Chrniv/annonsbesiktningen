// Tar emot en lead från sidan, sparar den och skickar (valfritt) ett mejl till dig.
// Hemligheter (Edge Functions › Secrets): RESEND_API_KEY, NOTIFY_EMAIL, NOTIFY_FROM, SITE_URL, ALLOWED_ORIGINS. Alla valfria.
import { handleSubmitLead, leadEmail } from '../_shared/logic.ts';
import { restDb, origins } from '../_shared/rest.ts';

const env = (k: string) => Deno.env.get(k) || '';
const db = restDb(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

async function notify(row: Record<string, unknown>, id: string) {
  const key = env('RESEND_API_KEY'), to = env('NOTIFY_EMAIL');
  if (!key || !to) return;
  const { subject, text } = leadEmail(row, id, env('SITE_URL'));
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('NOTIFY_FROM') || 'Annonsbesiktningen <onboarding@resend.dev>', to: [to], subject, text, reply_to: row.email })
  });
}

Deno.serve(req => handleSubmitLead(req, { db, notify, allowedOrigins: origins(env('ALLOWED_ORIGINS')) })
  .catch(e => { console.error(e); return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }); }));
