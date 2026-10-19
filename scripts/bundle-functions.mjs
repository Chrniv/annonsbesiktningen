// Slår ihop varje Edge Function till en enda fil (supabase/deploy/<namn>.ts) som går att klistra in
// i Supabase-dashboardens editor. Med Supabase CLI behövs inte detta: `supabase functions deploy`.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

mkdirSync('supabase/deploy', { recursive: true });
for (const name of ['submit-lead', 'verify-payment']) {
  await build({
    entryPoints: [`supabase/functions/${name}/index.ts`],
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    outfile: `supabase/deploy/${name}.ts`,
    banner: { js: `// @ts-nocheck\n// ${name}: genererad av scripts/bundle-functions.mjs – ändra i supabase/functions/ i stället.` },
    logLevel: 'warning'
  });
  console.log('supabase/deploy/' + name + '.ts');
}
