'use strict';

const https = require('https');

/**
 * GET JSON cu timeout și reîncercări (backoff exponențial). Respinge la status != 2xx sau JSON invalid,
 * ca apelantul să știe clar că datele lipsesc (nu primește `null` tăcut).
 */
function getJsonOnce(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (apex-quant)', Accept: 'application/json' }, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP_${res.statusCode} ${url}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`INVALID_JSON ${url}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error(`TIMEOUT ${url}`)));
    req.on('error', reject);
  });
}

async function getJson(url, { timeoutMs = 10000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await getJsonOnce(url, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr;
}

module.exports = { getJson };
