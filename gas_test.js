const fs = require('fs');
const vm = require('vm');
const https = require('https');

function syncHttpsGet(url) {
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, ['-e', `
        const https = require('https');
        https.get(${JSON.stringify(url)}, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => process.stdout.write(d));
        });
    `], { encoding: 'utf8' });
    return out;
}

const propsStore = {};
const sandbox = {
    Logger: { log: (msg) => console.log("[Logger]", msg) },
    PropertiesService: {
        getScriptProperties: () => ({
            getProperty: (k) => propsStore[k] || null,
            setProperty: (k, v) => { propsStore[k] = v; }
        })
    },
    UrlFetchApp: {
        fetch: (url) => {
            if (url.includes('api.telegram.org')) {
                console.log("[Telegram Mock Sent]:", decodeURIComponent(url.split('text=')[1].split('&')[0]));
                return { getContentText: () => '{"ok":true}' };
            }
            const body = syncHttpsGet(url);
            return { getContentText: () => body };
        }
    },
    encodeURIComponent,
    parseFloat,
    String,
    Object,
    Math,
    JSON
};

const code = fs.readFileSync('google_apps_script_bot.js', 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Test calling sendTelegramMessage with a trigger event object (simulating Google Trigger)
sandbox.sendTelegramMessage({ triggerUid: '12345' });
console.log("✅ DRY-RUN V6 COMPLETAT FĂRĂ NICIO EROARE!");
