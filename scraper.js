const puppeteer = require('puppeteer');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

(async () => {
    console.log('Запуск браузера...');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if(['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    console.log('Починаємо сканування тайтлів користувачів...');
    
    // Нова команда: шукає всі тайтли у всіх користувачів напряму
    const customMangasSnap = await db.collectionGroup('custom_mangas').get();
    
    if (customMangasSnap.empty) {
        console.log('Жодного тайтлу не знайдено.');
    }
    
    for (const mangaDoc of customMangasSnap.docs) {
        const manga = mangaDoc.data();
        let senkuroText = manga.senkuroChapters || '...';
        let rutokiText = manga.rutokiChapters || '...';
        
        const now = Date.now();
        const lastChecked = manga.lastChecked || 0;
        
        // Перевірка 2-годинного інтервалу
        if (now - lastChecked < 7200000 && (senkuroText !== '...' || rutokiText !== '...')) {
            console.log(`⏳ Пропускаємо "${manga.name}" (оновлювалось менше 2 годин тому)`);
            continue;
        }

        console.log(`🔍 Скануємо: "${manga.name}"`);

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

        // Записуємо нові глави в базу
        await mangaDoc.ref.update({
            senkuroChapters: senkuroText,
            rutokiChapters: rutokiText,
            lastChecked: now
        });
        
        console.log(`✅ Успішно оновлено: "${manga.name}"`);
    }

    await browser.close();
    console.log('Скрипт успішно завершено!');
})();

// Додай це в кінець scraper.js
const fs = require('fs');
const https = require('https');

async function updateCatalog() {
    console.log('Оновлюємо каталог з MangaDex...');
    const url = 'https://api.mangadex.org/manga?includes[]=cover_art&limit=12&contentRating[]=safe';
    
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            fs.writeFileSync('catalog.json', data);
            console.log('Каталог успішно збережено в catalog.json');
        });
    }).on('error', (err) => console.log('Помилка оновлення каталогу: ' + err.message));
}

// Виклич цю функцію в кінці скрипта
await updateCatalog();
