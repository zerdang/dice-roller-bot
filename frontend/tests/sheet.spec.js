import { test, expect } from "@playwright/test";

const abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
async function openSheet(page, theme = "fantasy", failTracking = false) {
  await page.addInitScript(theme => localStorage.setItem("tabletop-theme", theme), theme);
  let card = { id: 1, name: "Elara", revision: 1, hp: 19, max_hp: 24, temp_hp: 0, speed: 30, proficiency_bonus: 2, armor_class: 14, initiative_modifier: 2, exhaustion: 0,
    ability_scores: Object.fromEntries(abilities.map(a => [a, 14])), identity: { species: "Elf", class_name: "Wizard", level: "3" }, conditions: [], resources: [], background: {}, notes: "", action_reminders: { note: "Keep cover in mind." },
    ability_sources: { strength: { base: 12, increases: [{ label: "Species Points", points: 1 }, { label: "XYZ Equipment", points: 1 }] } },
    skill_training: { Persuasion: { tier: 2, adjustment: 1, adjustment_source: "XYZ Equipment" }, Stealth: { tier: 1, override: 0 } },
    save_training: { charisma: { tier: 1, adjustment: -1, adjustment_source: "XYZ Armor" } },
    attacks: [{ name: "Longsword", bonus: 4, damage: "1d8+2", category: "Attack" }],
    spells: [{ name: "Aid", casting_time: "1 action", level: 2 }, { name: "Healing Word", casting_time: "1 bonus action", level: 1 }, { name: "Shield", casting_time: "1 reaction", level: 1 }], spell_slots: { "1": { current: 2, max: 3 } },
    inventory: [{ name: "Longsword", quantity: 1 }, { name: "Potion of Healing", quantity: 2 }, { name: "Healer’s Kit", quantity: 1 }, { name: "Unidentified Relic", quantity: 1 }],
    features: [{ name: "Cunning Action", activation: "Bonus Action", notes: "Check feature requirements." }],
  };
  const updates = [];
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let value = [];
    if (path === "/api/auth/me") value = { user: { username: "Alex" }, active_campaign_id: 1, campaigns: [{ id: 1, name: "The Lantern Road", game_system: "dnd", role: "player" }] };
    else if (path === "/api/dashboard") value = { role: "player", campaign: { id: 1, name: "The Lantern Road", game_system: "dnd" }, characters: [card], dnd_characters: [card], dnd_roster: [{ ...card, can_open: true, is_own: true, controller_key: "alex" }], dnd_rolls: [], turn_order: [] };
    else if (path === "/api/battlemap/state") value = { scene: null, tokens: [], annotations: [], presets: [] };
    else if (path === "/api/dnd/characters/1" && route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      updates.push(patch);
      if (failTracking && patch.action_reminders) return route.fulfill({ status: 409, json: { error: "Character changed; reload." } });
      card = { ...card, ...patch, revision: card.revision + 1 };
      value = card;
    } else if (path.endsWith("/sheet-rolls")) value = { label: "Check", total: 14, expression: "1d20+2" };
    else if (path.endsWith("/portrait")) return route.fulfill({ status: 404 });
    await route.fulfill({ json: value });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open sheet", exact: true }).click();
  return { updates };
}

for (const theme of ["fantasy", "crt", "simple"]) {
  test(`${theme}: compact overview, checks, and one-row tabs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openSheet(page, theme);
    const abilitiesBox = await page.locator(".sheet-summary-block").boundingBox();
    const combatBox = await page.locator(".combat-section").boundingBox();
    expect(Math.abs(abilitiesBox.y - combatBox.y)).toBeLessThan(2);
    expect(abilitiesBox.width).toBeLessThan(600);
    expect(combatBox.x).toBeGreaterThan(abilitiesBox.x + abilitiesBox.width);
    expect(abilitiesBox.height).toBeLessThan(170);
    expect(await page.locator(".ability-tile").first().evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(75);
    const metrics = await page.locator(".skill-row").first().evaluate(row => [row, row.querySelector(".sheet-roll-control"), ...row.querySelectorAll("button")].map(el => ({ tag: el.className, rect: el.getBoundingClientRect().height, height: getComputedStyle(el).height, padding: getComputedStyle(el).padding, margin: getComputedStyle(el).margin, display: getComputedStyle(el).display, minHeight: getComputedStyle(el).minHeight })));
    expect(await page.locator(".sheet-skills").evaluate(el => el.getBoundingClientRect().height), JSON.stringify(metrics)).toBeLessThan(340);
    expect(await page.locator(".save-row").first().evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(34);
    const tabs = await page.locator(".sheet-tabs button").evaluateAll(nodes => nodes.map(node => { const rect = node.getBoundingClientRect(); return { top: rect.top, right: rect.right }; }));
    expect(new Set(tabs.map(tab => Math.round(tab.top))).size).toBe(1);
    expect(tabs.at(-1).right).toBeLessThanOrEqual((await page.locator(".sheet-tabs").boundingBox()).x + (await page.locator(".sheet-tabs").boundingBox()).width + 1);
    await expect(page.getByRole("button", { name: "Mark Help used", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark Magic used", exact: true })).toBeVisible();
    if (theme === "fantasy") await page.screenshot({ path: testInfo.outputPath("compact-character-sheet.png") });
  });
}

test("turn tracker follows action costs, persists, and keeps slots and equipment separate", async ({ page }) => {
  const { updates } = await openSheet(page);
  const tracker = page.getByRole("group", { name: "Turn tracker", exact: true });
  await page.getByRole("button", { name: "Mark Help used", exact: true }).click();
  await expect(tracker.getByRole("button", { name: "Action used", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Mark Magic used", exact: true })).toBeDisabled();
  await page.getByRole("group", { name: "Filter actions" }).getByRole("button", { name: "Bonus Action", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mark Potion of Healing used", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark Healing Word used", exact: true }).click();
  await expect(tracker.getByRole("button", { name: "Bonus used", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("group", { name: "Filter actions" }).getByRole("button", { name: "Reaction", exact: true }).click();
  await page.getByRole("button", { name: "Mark Shield used", exact: true }).click();
  await expect(tracker.getByRole("button", { name: "Reaction used", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(updates.every(patch => Object.keys(patch).sort().join(",") === "action_reminders,revision")).toBe(true);
  expect(updates.at(-1).action_reminders.note).toBe("Keep cover in mind.");
  await page.locator(".sheet-header").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Open sheet", exact: true }).click();
  await expect(tracker.getByRole("button", { name: "Reaction used", exact: true })).toHaveAttribute("aria-pressed", "true");
  await tracker.getByRole("button", { name: "New turn", exact: true }).click();
  for (const label of ["Action", "Bonus", "Reaction", "Interact"]) await expect(tracker.getByRole("button", { name: `${label} used`, exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("failed tracker updates do not show usage as saved", async ({ page }) => {
  await openSheet(page, "fantasy", true);
  await page.getByRole("button", { name: "Mark Help used", exact: true }).click();
  await expect(page.locator(".save-status")).toContainText("Save failed");
  await expect(page.getByRole("group", { name: "Turn tracker" }).getByRole("button", { name: "Action used", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("compact ability editing preserves pending changes until save", async ({ page }) => {
  const { updates } = await openSheet(page);
  await page.locator(".sheet-summary-block").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "strength score", exact: true }).fill("16");
  await page.getByRole("checkbox", { name: "Inspiration", exact: true }).check();
  expect(updates).toHaveLength(0);
  await expect(page.getByRole("group", { name: "Turn tracker" }).getByRole("button", { name: "Action used", exact: true })).toBeDisabled();
  await page.locator(".sheet-summary-block").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect(updates.at(-1)).toMatchObject({ ability_scores: { strength: 16 }, heroic_inspiration: 1 });
  await expect(page.getByRole("button", { name: "strength ability check", exact: true })).toHaveText("+3");
});

for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}px: compact controls and single-row tabs stay reachable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openSheet(page);
    expect(await page.locator(".sheet-scroll").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const firstTop = await page.locator(".sheet-tabs button").first().evaluate(el => el.getBoundingClientRect().top);
    for (const button of await page.locator(".sheet-tabs button").all()) expect(await button.evaluate((el, top) => Math.abs(el.getBoundingClientRect().top - top), firstTop)).toBeLessThan(2);
    await page.getByRole("button", { name: "charisma saving throw roll options", exact: true }).click();
    const popup = page.locator(".roll-popover");
    const bounds = await popup.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    const roll = page.waitForRequest(request => request.url().endsWith("/sheet-rolls"));
    await popup.getByRole("button", { name: "Roll now", exact: true }).click();
    expect((await roll).postDataJSON()).toMatchObject({ field_type: "save", name: "charisma" });
    await page.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Player-visible notes", exact: true })).toBeVisible();
  });
}

async function tooltipFits(page) {
  const box = await page.getByRole("tooltip").boundingBox();
  const viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

for (const theme of ["fantasy", "crt", "simple"]) {
  test(`${theme}: modifier tooltips explain sources, expertise, penalties, and zero overrides`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await openSheet(page, theme);
    await page.locator(".ability-tile").first().hover();
    let tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("14 Strength (+2)");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "Base Points" })).toContainText("+1");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "Species Points" })).toContainText("+0");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "XYZ Equipment" })).toContainText("+1");
    await tooltipFits(page);
    await tooltip.hover();
    await page.waitForTimeout(200); // The tooltip must remain open after leaving its anchor.
    await expect(tooltip).toBeVisible();
    if (theme === "fantasy") await page.screenshot({ path: testInfo.outputPath("modifier-breakdown.png") });
    await page.keyboard.press("Escape");
    await expect(tooltip).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Elara character sheet" })).toBeVisible();
    const persuasion = page.getByRole("button", { name: "Persuasion skill check", exact: true });
    await persuasion.scrollIntoViewIfNeeded();
    await persuasion.focus();
    tooltip = page.getByRole("tooltip");
    await expect(tooltip).toContainText("Persuasion (+7)");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "Expertise" })).toContainText("+4");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "XYZ Equipment" })).toContainText("+1");
    await expect(persuasion).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id"));
    const save = page.getByRole("button", { name: "charisma saving throw", exact: true });
    await save.scrollIntoViewIfNeeded();
    await save.focus();
    await expect(tooltip).toContainText("Charisma saving throw (+3)");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "XYZ Armor" })).toContainText("-1");
    await tooltipFits(page);
    const stealth = page.getByRole("button", { name: "Stealth skill check", exact: true });
    await stealth.scrollIntoViewIfNeeded();
    await stealth.focus();
    await expect(tooltip).toContainText("Stealth (+0)");
    await expect(tooltip.getByRole("listitem").filter({ hasText: "Manual override" })).toContainText("-4");
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}px: focused modifier breakdown remains inside the viewport`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openSheet(page);
    const save = page.getByRole("button", { name: "charisma saving throw", exact: true });
    await save.scrollIntoViewIfNeeded();
    await save.focus();
    await expect(page.getByRole("tooltip")).toContainText("Charisma saving throw (+3)");
    await tooltipFits(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeVisible();
  });
}

test("score sources and named check bonuses can be edited without applying score points twice", async ({ page }) => {
  const { updates } = await openSheet(page);
  const abilities = page.locator(".sheet-summary-block");
  await abilities.getByRole("button", { name: "Edit", exact: true }).click();
  await abilities.getByText("Score sources", { exact: true }).click();
  await abilities.getByRole("combobox", { name: "Ability", exact: true }).selectOption("charisma");
  await abilities.getByRole("spinbutton", { name: "Base Points", exact: true }).fill("12");
  await abilities.getByRole("button", { name: "Add score source", exact: true }).click();
  await abilities.getByRole("textbox", { name: "Source name", exact: true }).fill("XYZ Equipment");
  await abilities.getByRole("spinbutton", { name: "Score points", exact: true }).fill("2");
  await abilities.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  expect(updates.at(-1).ability_scores.charisma).toBe(14);
  expect(updates.at(-1).ability_sources.charisma).toEqual({ base: 12, increases: [{ label: "XYZ Equipment", points: 2 }] });
  await page.getByRole("button", { name: "charisma ability check", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText("XYZ Equipment (+2 score)");
  const skills = page.locator(".sheet-skills");
  await skills.getByRole("button", { name: "Edit", exact: true }).click();
  await skills.getByRole("spinbutton", { name: "Persuasion bonus adjustment", exact: true }).fill("2");
  await skills.getByRole("textbox", { name: "Persuasion bonus source", exact: true }).fill("Silver Ring");
  await skills.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  const persuasion = page.getByRole("button", { name: "Persuasion skill check", exact: true });
  await persuasion.scrollIntoViewIfNeeded();
  await persuasion.focus();
  await expect(persuasion).toHaveText("+8");
  await expect(page.getByRole("tooltip").getByRole("listitem").filter({ hasText: "Silver Ring" })).toContainText("+2");
});
