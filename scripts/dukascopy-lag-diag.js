'use strict';
// Cât de proaspete sunt lumânările Dukascopy (freeserv)? Rulează de 6 ori, la 25 s distanță.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const H = { 'User-Agent': UA, Referer: 'https://freeserv.dukascopy.com/2.0/?path=chart/index&showUI=true&instrument=DEU.IDX/EUR' };
async function duka(inst, interval) {
  const u = `https://freeserv.dukascopy.com/2.0/?path=chart/json3&instrument=${encodeURIComponent(inst)}&offer_side=B&interval=${interval}&splits=true&stocks=true&limit=5&time_direction=P&timestamp=${Date.now()}&jsonp=_cb`;
  const t = await (await fetch(u, { headers: H })).text();
  return JSON.parse(t.slice(t.indexOf('(') + 1, t.lastIndexOf(')')));
}
(async () => {
  for (let k = 0; k < 6; k++) {
    const now = Date.now();
    try {
      const m1 = await duka('DEU.IDX/EUR', '1MIN'), m15 = await duka('DEU.IDX/EUR', '15MIN');
      const os = (await (await fetch('https://metadata-backend.ostium.io/PricePublish/latest-prices')).json()).find((x) => x.from === 'DAX');
      const ts = (a) => a.map((x) => x[0]).sort((p, q) => q - p);
      const n1 = m1.find((x) => x[0] === ts(m1)[0]), n15 = m15.find((x) => x[0] === ts(m15)[0]);
      console.log(`::notice::#${k} ${new Date(now).toISOString()} | M1 cea mai nouă deschisă acum ${((now - n1[0]) / 1000).toFixed(0)} s close ${n1[4]} | M15 cea mai nouă deschisă acum ${((now - n15[0]) / 60000).toFixed(1)} min close ${n15[4]} | Ostium live mid ${os.mid.toFixed(1)} (acum ${(now / 1000 - os.timestampSeconds).toFixed(0)} s)`);
    } catch (e) { console.log('::notice::#' + k + ' EROARE ' + e.message); }
    await new Promise((r) => setTimeout(r, 25000));
  }
})();
