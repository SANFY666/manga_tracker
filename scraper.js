const puppeteer = require("puppeteer");
const fs = require("fs");

const mangasConfig = [
  {
    name: "Raising Villains",
    senkuro:
      "https://senkuro.com/manga/raising-villains-the-right-way/chapters",
    rutoki: "https://rutoki.com/manga/nm4700573",
  },
  // Додавай нові тайтли сюди, через кому
];

(async () => {
  console.log("Запуск браузера...");
  const browser = await puppeteer.launch({ 
    headless: true, 
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
});
  const page = await browser.newPage();

  // Блокуємо завантаження картинок і стилів для швидкості
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (["image", "stylesheet", "font"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  const results = [];

  for (const manga of mangasConfig) {
    console.log(`Сканування: ${manga.name}`);
    let senkuroText = "Помилка";
    let rutokiText = "Помилка";

    try {
      await page.goto(manga.senkuro, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const senkuroSelector =
        "#app > div > section > div.container > div > section > article.project-stats > div > div:nth-child(3) > div.project-stats__body > div.project-stats__name";
      await page.waitForSelector(senkuroSelector, { timeout: 10000 });
      senkuroText = await page.$eval(senkuroSelector, (el) =>
        el.textContent.trim(),
      );
    } catch (e) {
      console.log("Не вдалося знайти Senkuro");
    }

    try {
      await page.goto(manga.rutoki, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      const rutokiSelector = "#c-c-mm-i-r-read > div";
      await page.waitForSelector(rutokiSelector, { timeout: 10000 });
      let rawRutoki = await page.$eval(rutokiSelector, (el) =>
        el.textContent.trim(),
      );
      const rutokiMatch = rawRutoki.match(/\d+/);
      if (rutokiMatch) rutokiText = rutokiMatch[0];
    } catch (e) {
      console.log("Не вдалося знайти Rutoki");
    }

    results.push({
      name: manga.name,
      senkuroChapters: senkuroText,
      rutokiChapters: rutokiText,
    });
  }

  await browser.close();

  const data = {
    mangas: results,
    lastUpdated: new Date().toLocaleString("uk-UA", {
      timeZone: "Europe/Kyiv",
    }),
  };

  fs.writeFileSync("data.json", JSON.stringify(data, null, 2));
  console.log("Дані успішно збережено у data.json");
})();
