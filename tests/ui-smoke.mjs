import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
if (!process.env.TEST_LOGIN_PASSWORD)
  throw Error(
    "Defina TEST_LOGIN_PASSWORD e, opcionalmente, TEST_LOGIN_USERNAME para testar o painel com login.",
  );
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const errors = [];
let initialPipeline = 0;
const campaignName = "DEMO · Imobiliárias em Dourados " + Date.now();
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:3000/login");
  await page.locator("#submit:not([disabled])").waitFor();
  await page
    .locator("#username")
    .fill(process.env.TEST_LOGIN_USERNAME || "admin");
  await page.locator("#password").fill(process.env.TEST_LOGIN_PASSWORD);
  await page.locator("#submit").click();
  await page.waitForURL("http://127.0.0.1:3000/");
  await page
    .getByText("Redis conectado", { exact: false })
    .waitFor({ timeout: 15000 });
  initialPipeline = Number(await page.locator("#m-pipeline").textContent());
  await page.locator('#overview [data-action="new"]').click();
  await page.locator("#campaign-dialog").waitFor();
  await page.locator('[name="name"]').fill(campaignName);
  await page.locator('[name="segment"]').fill("imobiliárias");
  await page.locator('[name="maxLeads"]').fill("6");
  await page.locator("#frequency").selectOption("daily");
  await page
    .getByRole("button", { name: "Criar campanha", exact: true })
    .click();
  await page.locator("#campaign-dialog").waitFor({ state: "hidden" });
  await page.locator('#campaign-list [data-action="start"]').last().click();
  await page
    .locator("#runs .run")
    .filter({ hasText: campaignName })
    .getByText("concluída", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.locator('[data-tab="approval"]').click();
  await page.locator('#approval-list [data-action="lead"]').first().click();
  await page
    .locator(".message")
    .first()
    .fill("Olá! Podemos conversar sobre um sistema de gestão?");
  await page.locator('[data-action="approve"]').click();
  await page.locator('[data-action="pipeline"]').waitFor();
  await page.locator('[data-action="pipeline"]').click();
  await page
    .getByText("Estado: approved · No pipeline", { exact: false })
    .waitFor();
  await page.locator('[data-close="lead-dialog"]').click();
  await page.locator('[data-tab="pipeline"]').click();
  assert.equal(
    await page.locator("#pipeline-list .card").count(),
    initialPipeline + 1,
  );
  await page.locator('[data-tab="campaigns"]').click();
  await page.locator('[data-action="schedule"]').first().click();
  await page.locator('[data-action="unschedule"]').first().waitFor();
  await page.locator('[data-action="unschedule"]').first().click();
  await page.locator('[data-action="schedule"]').first().waitFor();
  await page.locator('[data-tab="overview"]').click();
  await page.locator("#toast").waitFor({ state: "hidden", timeout: 10000 });
  await page.screenshot({ path: "data/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "data/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: UI campaign creation, BullMQ capture, approval, pipeline, scheduler enable/disable, mobile overflow, no browser errors.",
  );
} finally {
  await browser.close();
}
