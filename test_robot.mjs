// test_robot.mjs
import { launch } from 'cloakbrowser';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await launch({
    headless: false,
    proxy: 'http://user296388:8cpmj1@89.106.202.176:4586'
});
const page = await browser.newPage();
page.on('dialog', async d => await d.accept());

await page.goto('https://deviceandbrowserinfo.com/are_you_a_bot_interactions', { waitUntil: 'domcontentloaded' });
await sleep(2000);

await page.click('input[type="email"]');
await page.type('input[type="email"]', 'hello@example.com');
await page.click('input[type="password"]');
await page.type('input[type="password"]', 'Secure#Pass123');
await page.click('button.btn.btn-primary[type="submit"]');

await sleep(3000);
const text = await page.evaluate(() => document.body.innerText || '');
console.log('\n=== ROBOT RESULT ===');
for (const line of text.split('\n')) {
    const l = line.toLowerCase();
    if (l.includes('isbot') || l.includes('you are') || l.includes('suspicious') || l.includes('superhuman'))
        console.log('  ' + line.trim());
}
await browser.close();
