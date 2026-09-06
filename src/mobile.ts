import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { load } from "cheerio";
export async function renderMobile(
  html: string,
  styles: string[] = [],
): Promise<{ fits: boolean; width: number; viewport: number }> {
  const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const executablePath =
    process.env.BROWSER_EXECUTABLE_PATH ||
    (existsSync(edge) ? edge : undefined);
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    timeout: 15000,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8000);
    const $ = load(html);
    $('script,iframe,object,embed,link,meta[http-equiv="refresh"]').remove();
    for (const css of styles) $("head").append($("<style>").text(css));
    await page.setContent($.html(), {
      waitUntil: "domcontentloaded",
      timeout: 8000,
    });
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    return { ...dimensions, fits: dimensions.width <= dimensions.viewport + 1 };
  } finally {
    await browser.close();
  }
}
