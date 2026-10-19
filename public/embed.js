/*
  Bädda in Annonsbesiktningen på valfri webbplats:
    <div id="annonsbesiktningen"></div>
    <script src="https://DIN-SAJT.netlify.app/embed.js" async></script>
  Rutan växer automatiskt med innehållet.
*/
(function () {
  var s = document.currentScript;
  var origin = new URL(s.src).origin;
  var host = document.getElementById('annonsbesiktningen');
  if (!host) { host = document.createElement('div'); s.parentNode.insertBefore(host, s); }
  var f = document.createElement('iframe');
  f.src = origin + '/';
  f.title = 'Annonsbesiktningen – granskning av Google Ads';
  f.loading = 'lazy';
  f.allow = 'clipboard-write';
  f.style.cssText = 'width:100%;border:0;min-height:900px;display:block';
  host.appendChild(f);
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.type !== 'annonsbesiktning:height') return;
    f.style.height = e.data.height + 'px';
  });
})();
