const puppeteer = require('puppeteer');
const admin = require('firebase-admin');
const fs = require('fs');
const https = require('https');
const { execSync } = require('child_process');

async function runAll() {
    console.log('Запуск головної функції...');

    // 1. Ініціалізація Firebase
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    const db = admin.firestore();

    // 2. Налаштування Puppeteer
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if(['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    // 3. Сканування тайтлів
    console.log('Починаємо сканування тайтлів...');
    const customMangasSnap = await db.collectionGroup('custom_mangas').get();
    
    for (const mangaDoc of customMangasSnap.docs) {
        const manga = mangaDoc.data();
        let senkuroText = manga.senkuroChapters || '...';
        let rutokiText = manga.rutokiChapters || '...';
        
        const now = Date.now();
        if (now - (manga.lastChecked || 0) < 7200000 && (senkuroText !== '...' || rutokiText !== '...')) continue;

        if (manga.senkuroUrl?.includes('senkuro.com')) {
            try {
                await page.goto(manga.senkuroUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                senkuroText = await page.$eval('#app > div > section > div.container > div > section > article.project-stats > div > div:nth-child(3) > div.project-stats__body > div.project-stats__name', el => el.textContent.trim());
            } catch(e) {}
        }
        if (manga.rutokiUrl?.includes('rutoki.com')) {
            try {
                await page.goto(manga.rutokiUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                let raw = await page.$eval('#c-c-mm-i-r-read > div', el => el.textContent.trim());
                const match = raw.match(/\d+/);
                if (match) rutokiText = match[0];
            } catch(e) {}
        }
        await mangaDoc.ref.update({ senkuroChapters: senkuroText, rutokiChapters: rutokiText, lastChecked: now });
    }

    // 4. Оновлення каталогу з MangaDex
    console.log('Оновлюємо catalog.json...');
    const catalogUrl = 'https://api.mangadex.org/manga?includes[]=cover_art&limit=12&contentRating[]=safe';
    const options = { headers: { 'User-Agent': 'MangaTrackerBot/1.0' } };

    const catalogData = await new Promise((resolve) => {
        https.get(catalogUrl, options, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => resolve(data));
        }).on('error', () => resolve(''));
    });

    if (catalogData.trim().startsWith('{')) {
        fs.writeFileSync('catalog.json', catalogData);
        
        // 5. Зберігаємо файл у репозиторій
        console.log('Зберігаємо catalog.json в репозиторій...');
        execSync('git config user.name "github-actions[bot]"');
        execSync('git config user.email "github-actions[bot]@users.noreply.github.com"');
        execSync('git add catalog.json');
        try {
            execSync('git commit -m "Автоматичне оновлення каталогу"');
            execSync('git push');
        } catch(e) {
            console.log('Немає змін для коміту.');
        }
    } else {
        console.log('Помилка: отримано некоректні дані, catalog.json не оновлено.');
    }

    await browser.close();
    console.log('Все успішно завершено!');
}

runAll().catch(err => {
    console.error(err);
    process.exit(1);
});
