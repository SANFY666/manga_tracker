const puppeteer = require('puppeteer');
const fs = require('fs');
const admin = require('firebase-admin');

// Підключення до Firebase за допомогою ключа з GitHub Secrets
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Твій глобальний список (як і раніше)
const mangasConfig = [
    { name: 'Raising Villains', senkuro: 'https://senkuro.com/manga/raising-villains-the-right-way/chapters', rutoki: 'https://rutoki.com/manga/nm4700573' }
];

(async () => {
    console.log('Запуск браузера...');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if(['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // 1. ОНОВЛЕННЯ ГЛОБАЛЬНИХ ТАЙТЛІВ (data.json)
    const results = [];
    for (const manga of mangasConfig) {
        let senkuroText = 'Помилка', rutokiText = 'Помилка';
        try {
            await page.goto(manga.senkuro, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('.project-stats__name', { timeout: 10000 });
            senkuroText = await page.$eval('#app > div > section > div.container > div > section > article.project-stats > div > div:nth-child(3) > div.project-stats__body > div.project-stats__name', el => el.textContent.trim());
        } catch (e) {}

        try {
            await page.goto(manga.rutoki, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('#c-c-mm-i-r-read > div', { timeout: 10000 });
            let rawRutoki = await page.$eval('#c-c-mm-i-r-read > div', el => el.textContent.trim());
            const match = rawRutoki.match(/\d+/);
            if (match) rutokiText = match[0];
        } catch (e) {}

        results.push({ name: manga.name, senkuroChapters: senkuroText, rutokiChapters: rutokiText });
    }
    fs.writeFileSync('data.json', JSON.stringify({ mangas: results, lastUpdated: new Date().toLocaleString('uk-UA') }, null, 2));
    console.log('Глобальні дані оновлено!');

    // 2. ОНОВЛЕННЯ ОСОБИСТИХ ТАЙТЛІВ КОРИСТУВАЧІВ З FIREBASE
    console.log('Починаємо сканування особистих тайтлів...');
    const usersSnap = await db.collection('users').get();
    
    for (const userDoc of usersSnap.docs) {
        const customMangasRef = userDoc.ref.collection('custom_mangas');
        const customMangasSnap = await customMangasRef.get();

        for (const mangaDoc of customMangasSnap.docs) {
            const manga = mangaDoc.data();
            let senkuroText = manga.senkuroChapters || '...';
            let rutokiText = manga.rutokiChapters || '...';

            if (manga.senkuroUrl && manga.senkuroUrl.includes('senkuro.com')) {
                try {
                    await page.goto(manga.senkuroUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector('.project-stats__name', { timeout: 5000 });
                    senkuroText = await page.$eval('#app > div > section > div.container > div > section > article.project-stats > div > div:nth-child(3) > div.project-stats__body > div.project-stats__name', el => el.textContent.trim());
                } catch(e) { console.log(`Помилка Senkuro для ${manga.name}`); }
            }

            if (manga.rutokiUrl && manga.rutokiUrl.includes('rutoki.com')) {
                try {
                    await page.goto(manga.rutokiUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                    await page.waitForSelector('#c-c-mm-i-r-read > div', { timeout: 5000 });
                    let raw = await page.$eval('#c-c-mm-i-r-read > div', el => el.textContent.trim());
                    const match = raw.match(/\d+/);
                    if (match) rutokiText = match[0];
                } catch(e) { console.log(`Помилка Rutoki для ${manga.name}`); }
            }

            // Записуємо нові глави назад в базу користувачу
            await mangaDoc.ref.update({
                senkuroChapters: senkuroText,
                rutokiChapters: rutokiText
            });
        }
    }

    await browser.close();
    console.log('Скрипт успішно завершено!');
})();
