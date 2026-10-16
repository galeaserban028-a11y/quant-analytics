const fs = require('fs');
const vm = require('vm');

function syncHttpsGet(url) {
    const { execFileSync } = require('child_process');
    return execFileSync(process.execPath, ['-e', `
        const https = require('https');
        https.get(${JSON.stringify(url)}, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => process.stdout.write(d));
        });
    `], { encoding: 'utf8' });
}

const propsStore = {};
const sandbox = {
    Logger: { log: (msg) => console.log("[Logger]", msg) },
    PropertiesService: {
        getScriptProperties: () => ({
            getProperty: (k) => propsStore[k] || null,
            setProperty: (k, v) => { propsStore[k] = v; },
            deleteProperty: (k) => { delete propsStore[k]; }
        })
    },
    UrlFetchApp: {
        fetch: (url) => {
            if (url.includes('api.telegram.org')) {
                console.log("[Telegram Mock Sent]:\n" + decodeURIComponent(url.split('text=')[1].split('&')[0]));
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
    Date,
    JSON
};

const code = fs.readFileSync('google_apps_script_bot.js', 'utf8');
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

sandbox.sendTelegramMessage({ triggerUid: '12345' });
for (const k of Object.keys(propsStore)) {
    if (k.startsWith('MODEL_')) {
        console.log("🧠 Saved in Agent Memory ->", k, propsStore[k]);
    }
}
console.log("✅ V8 FOREX MULTI-AGENT COMPANY TESTED SUCCESSFULLY!");
