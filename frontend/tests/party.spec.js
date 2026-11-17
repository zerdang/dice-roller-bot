import { test, expect } from "@playwright/test";

const base = { revision: 1, hp: 10, max_hp: 14, armor_class: 13, speed: 30, proficiency_bonus: 2, ability_scores: { strength: 12 }, conditions: [], attacks: [], spells: [], inventory: [], features: [], background: {}, resources: [], notes: "A traveler with a story to tell.", dm_notes: "A secret known only to the DM." };
const roster = [
  { ...base, id: 1, name: "Liora", identity: { species: "Elf", class_name: "Druid", level: "3" }, controller_key: "alex", controller_name: "Alex", is_active: true, updated_at: "2026-01-01", is_own: true },
  { ...base, id: 2, name: "Rowan", identity: { species: "Human", class_name: "Ranger", level: "2" }, controller_key: "alex", controller_name: "Alex", updated_at: "2026-11-01", is_own: true },
  { ...base, id: 3, name: "Brann", identity: { species: "Dwarf", class_name: "Fighter", level: "3" }, controller_key: "casey", controller_name: "Casey", is_active: true, updated_at: "2026-11-02", is_own: false },
];

async function campaign(page, role) {
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const cards = roster.filter(card => role === "warden" || card.is_own).map(card => {
      const { dm_notes, ...visible } = card;
      return role === "warden" ? card : visible;
    });
    const summaries = roster.map(({ dm_notes, notes, inventory, ...card }) => ({ ...card, can_open: role === "warden" || card.is_own }));
    let data = [];
    if (path === "/api/auth/me") data = { user: { username: "Alex" }, active_campaign_id: 1, campaigns: [{ id: 1, name: "The Lantern Road", game_system: "dnd", role }] };
    if (path === "/api/dashboard") data = { role, campaign: { id: 1, name: "The Lantern Road", game_system: "dnd" }, characters: cards, dnd_characters: cards, dnd_roster: summaries, dnd_rolls: [], turn_order: [] };
    if (path === "/api/battlemap/state") data = { scene: null, tokens: [], annotations: [], presets: [] };
    if (path.endsWith("/portrait")) return route.fulfill({ status: 404 });
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Party", exact: true }).click();
}

for (const role of ["warden", "player"]) {
  test(`${role}: player groups, access boundaries and sheet switching`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.addInitScript(() => localStorage.setItem("tabletop-theme", "fantasy"));
    await campaign(page, role);
    const alex = page.getByRole("button", { name: /Alex.*2 characters/ });
    await expect(alex).toHaveAttribute("aria-expanded", "false");
    await alex.click();
    await expect(page.locator("#party-alex .party-card .party-identity b")).toHaveText(["Liora", "Rowan"]);
    await page.getByRole("button", { name: /Casey.*1 character/ }).click();
    await expect(page.locator("#party-casey").getByRole("button", { name: "Open sheet", exact: true })).toHaveCount(role === "warden" ? 1 : 0);
    await page.locator(".party-groups").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath("party.png"), fullPage: true });
    await page.locator("#party-alex .party-card").first().getByRole("button", { name: "Open sheet", exact: true }).click();
    const tabs = page.getByRole("tablist", { name: "Character sheets" });
    await expect(tabs.getByRole("tab")).toHaveCount(role === "warden" ? 3 : 2);
    await page.screenshot({ path: testInfo.outputPath("sheet.png"), fullPage: true });
    await tabs.getByRole("tab", { name: /Rowan/ }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Rowan character sheet");
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /DM-private notes/ })).toHaveCount(role === "warden" ? 1 : 0);
    if (role === "player") await expect(tabs.getByRole("tab", { name: /Brann/ })).toHaveCount(0);
    await page.locator(".sheet-tab-panel .sheet-section-heading").getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Player-visible notes", exact: true }).fill("Unsaved story");
    page.once("dialog", dialog => dialog.dismiss());
    await tabs.getByRole("tab", { name: /Liora/ }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Rowan character sheet");
    await expect(page.getByRole("textbox", { name: "Player-visible notes", exact: true })).toHaveValue("Unsaved story");
    page.once("dialog", dialog => dialog.accept());
    await tabs.getByRole("tab", { name: /Liora/ }).click();
    await expect(page.getByRole("dialog")).toHaveAttribute("aria-label", "Liora character sheet");
  });
}
