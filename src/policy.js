import './styles.css';
import { CONFIG } from './config.js';

document.querySelectorAll('[data-agency]').forEach(el => { el.textContent = CONFIG.agencyName; });
document.querySelectorAll('[data-months]').forEach(el => { el.textContent = String(CONFIG.leadRetentionMonths); });
document.querySelectorAll('[data-contact]').forEach(el => {
  if (!CONFIG.contactEmail) { el.textContent = 'kontaktadressen på vår webbplats'; return; }
  const a = document.createElement('a'); a.href = 'mailto:' + CONFIG.contactEmail; a.textContent = CONFIG.contactEmail; el.replaceWith(a);
});
document.getElementById('updated').textContent = '2026-10-19';
