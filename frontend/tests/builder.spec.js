import { test, expect } from "@playwright/test";

const abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const scores = Object.fromEntries(abilities.map((name, i) => [name, [15, 14, 13, 12, 10, 8][i]]));
const policy = { methods: ["array", "point_buy", "rolled", "manual"], manual_review_required: true, flexible_background_abilities: true };
const lists = [{ id: "wizard", name: "Wizard", source: "XPHB", edition: "2024" }, { id: "cleric", name: "Cleric", source: "XPHB", edition: "2024" }];
const spells = [
  { id: "spark", name: "Spark", metadata: { level: 0, school: "Evocation" }, eligible_for_character: true },
  { id: "light", name: "Light", metadata: { level: 0, school: "Evocation" }, eligible_for_character: true },
  { id: "shield", name: "Shield", metadata: { level: 1, school: "Abjuration" }, eligible_for_character: true },
  { id: "bless", name: "Bless", metadata: { level: 1, school: "Enchantment" }, eligible_for_character: false },
].map(item => ({ ...item, source: "XPHB", edition: "2024", warnings: [] }));
const languages = [
  { id: "abyssal-xphb", name: "Abyssal", ids: ["abyssal-xphb", "abyssal-phb"] },
  { id: "dwarvish", name: "Dwarvish", ids: ["dwarvish"] },
  { id: "elvish-xphb", name: "Elvish", ids: ["elvish-xphb", "elvish-phb"] },
];

async function openDraft(page, theme = "fantasy", options = {}) {
  await page.addInitScript(theme => localStorage.setItem("tabletop-theme", theme), theme);
  const requests = [];
  let campaignPolicy = { ...policy, flexible_background_abilities: !options.restricted };
  const role = options.role || "player";
  const availableSpells = options.longSpells ? spells.map(item => item.id === "shield" ? { ...item, name: "Mordenkainen's Unusually Long Shield of Protection Against Magical Effects", source: "An Unusually Long Source Identifier" } : item) : spells;
  let draft = { name: "Test wizard", class_id: "wizard", background_id: "soldier", method: options.method || "array", scores: options.scores || scores, boosts: { ...Object.fromEntries(abilities.map(a => [a, 0])), ...options.boosts }, class_skills: [], equipment: {}, spell_ids: [], language_ids: options.language_ids || [], notes: "" };
  const boostOptions = eligible => eligible.flatMap(a => eligible.filter(b => a !== b).map(b => ({ [a]: 2, [b]: 1 }))).concat(eligible.flatMap((a, i) => eligible.slice(i + 1).flatMap((b, j) => eligible.slice(i + j + 2).map(c => ({ [a]: 1, [b]: 1, [c]: 1 })))));
  let revision = 1;
  const preview = () => ({
    errors: [{ step: "abilities", fields: ["boosts.wisdom"], message: "Wisdom is not eligible for this background. Set its background increase to +0." }], review: [],
    selected: { class: lists[0], background: { id: "soldier", name: "Soldier" } }, policy: campaignPolicy,
    class_skill_options: [], eligible_boosts: campaignPolicy.flexible_background_abilities ? abilities : abilities.slice(0, 3),
    boost_options: boostOptions(campaignPolicy.flexible_background_abilities ? abilities : abilities.slice(0, 3)),
    scores: Object.fromEntries(abilities.map(a => [a, draft.scores[a] + draft.boosts[a]])), modifiers: scores,
    spells: availableSpells.filter(spell => draft.spell_ids.includes(spell.id)).map(spell => ({ ...spell, level: spell.metadata.level })),
    spell_limits: { cantrips: 1, level_one: 1 }, spell_eligibility_ready: true,
    languages: languages.filter(item => item.ids.some(id => draft.language_ids.includes(id))),
  });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let value = [];
    if (path === "/api/auth/me") value = { user: { username: "Tester" }, active_campaign_id: 1, campaigns: [{ id: 1, name: "Test campaign", game_system: "dnd", role }] };
    else if (path === "/api/dashboard") value = { role, campaign: { id: 1, name: "Test campaign", game_system: "dnd" }, characters: [], dnd_characters: [], dnd_roster: [], turn_order: [], dnd_rolls: [] };
    else if (path === "/api/battlemap/state") value = { scene: null, tokens: [], annotations: [], presets: [] };
    else if (path === "/api/dnd/reference/meta") value = { version: "v1", kinds: {}, sources: ["XPHB"], all_sources: ["XPHB"], allowed_sources: null };
    else if (path === "/api/dnd/creation/settings") {
      if (route.request().method() === "PUT") campaignPolicy = route.request().postDataJSON();
      value = campaignPolicy;
    }
    else if (path === "/api/dnd/creation/drafts") value = [{ id: "1", name: draft.name, is_own: true, scores, updated_at: "2026-11-17T12:00:00Z" }];
    else if (path.endsWith("/options")) {
      requests.push(Object.fromEntries(url.searchParams));
      if (url.searchParams.get("kind") === "language") {
        const items = languages.filter(item => item.name.toLowerCase().includes((url.searchParams.get("q") || "").toLowerCase()));
        return route.fulfill({ json: { items, total: items.length } });
      }
      const list = url.searchParams.get("spell_list");
      const level = url.searchParams.get("level");
      const school = url.searchParams.get("school");
      const items = url.searchParams.get("kind") !== "spell" ? [] : availableSpells.filter(spell =>
        (list === "all" || (list === "cleric" ? spell.id === "bless" : spell.eligible_for_character)) &&
        (!level || String(spell.metadata.level) === level) && (!school || spell.metadata.school === "Abjuration" && school === "A"));
      value = { items, total: items.length, spell_lists: lists };
    } else if (path.startsWith("/api/dnd/reference/entries/")) {
      value = { ...availableSpells.find(item => item.id === path.split("/").at(-1)), text: "A long spell description with magical effects and additional rules.\n\n".repeat(50) + "End of spell rules." };
    } else if (path === "/api/dnd/creation/drafts/1") {
      if (route.request().method() === "PUT") { draft = route.request().postDataJSON().draft; revision++; }
      value = { id: "1", revision, version: "v1", draft, preview: preview() };
    }
    await route.fulfill({ json: value });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Character creation drafts", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  return requests;
}

test("spell-list and level filters work independently of cantrip completion", async ({ page }) => {
  const requests = await openDraft(page);
  await page.getByRole("button", { name: "Spells", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Spell list", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Details for Shield from XPHB" })).toBeVisible();
  await page.getByRole("combobox", { name: "Level", exact: true }).selectOption("1");
  await expect.poll(() => requests.at(-1)?.level).toBe("1");
  await expect(page.getByRole("button", { name: "Details for Spark from XPHB" })).toHaveCount(0);
  await page.getByRole("row").filter({ has: page.getByRole("button", { name: "Details for Shield from XPHB" }) }).getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".builder-spell-counts").getByText("1 / 1")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Spell list", exact: true }).selectOption("cleric");
  await expect.poll(() => requests.at(-1)?.spell_list).toBe("cleric");
  await expect(page.getByRole("button", { name: "Details for Bless from XPHB" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Other class", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.spell_list).toBe("");
  await expect(page.getByRole("combobox", { name: "Level", exact: true })).toHaveValue("");
  const sparkRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Details for Spark from XPHB" }) });
  await sparkRow.getByRole("button", { name: "Select", exact: true }).click();
  await expect(page.locator(".builder-spell-counts").getByText("1 / 1")).toHaveCount(2);
  const lightRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: "Details for Light from XPHB" }) });
  await expect(lightRow.getByRole("button", { name: "Limit reached", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Remove Spark", exact: true }).click();
  await expect(lightRow.getByRole("button", { name: "Select", exact: true })).toBeEnabled();
  await page.getByRole("combobox", { name: "School", exact: true }).selectOption("A");
  await expect.poll(() => requests.at(-1)?.school).toBe("A");
  await expect(page.getByRole("button", { name: "Details for Shield from XPHB" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Details for Light from XPHB" })).toHaveCount(0);
});

for (const theme of ["fantasy", "crt", "simple"]) {
  test(`${theme}: steppers repair old errors and block invalid new increases`, async ({ page }) => {
    await page.setViewportSize(theme === "simple" ? { width: 390, height: 844 } : { width: 1024, height: 600 });
    await openDraft(page, theme, { restricted: true, boosts: { strength: 2, wisdom: 1 } });
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.locator(".builder-review-issues").getByRole("button", { name: /Wisdom is not eligible/ }).click();
    const wisdom = page.getByRole("group", { name: "wisdom ability increase", exact: true });
    await expect(wisdom).toBeFocused();
    await expect(wisdom).toHaveAttribute("aria-invalid", "true");
    await expect(wisdom).toHaveCSS("border-top-color", "rgb(255, 126, 131)");
    await expect(page.locator("#builder-error-boosts-wisdom")).toContainText("+0");
    await page.getByRole("button", { name: "Decrease wisdom ability increase", exact: true }).click();
    await expect(wisdom).not.toHaveAttribute("aria-invalid");
    await expect(page.getByRole("group", { name: "dexterity ability increase", exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Increase wisdom ability increase", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Increase dexterity ability increase", exact: true }).click();
    await expect(page.locator(".builder-validation")).toHaveCount(0);
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
    // A different valid allocation must also work, even while autosave is pending.
    await page.getByRole("button", { name: "Decrease strength ability increase", exact: true }).click();
    await page.getByRole("button", { name: /Use suggested increases/ }).click();
    await expect(page.locator(".builder-validation")).toHaveCount(0);
    await expect(wisdom.locator("output")).toHaveText("+0");
    await expect(page.locator(".creation-abilities select")).toHaveCount(0);
    await page.getByRole("button", { name: "Decrease strength base score", exact: true }).click();
    await expect(page.getByRole("group", { name: "strength base score", exact: true }).locator("output")).toHaveText("14");
    await expect(page.getByRole("group", { name: "dexterity base score", exact: true }).locator("output")).toHaveText("15");
    const lastControl = page.getByRole("button", { name: "Increase charisma ability increase", exact: true });
    await lastControl.scrollIntoViewIfNeeded();
    await expect(lastControl).toBeInViewport({ ratio: 1 });
  });
}

test("unrestricted placement spends a shared three-point budget and refunds immediately", async ({ page }) => {
  await openDraft(page);
  await page.getByRole("button", { name: "Abilities", exact: true }).click();
  await expect(page.locator(".builder-boost-budget")).toContainText("0 / 3");
  const wisdom = page.getByRole("button", { name: "Increase wisdom ability increase", exact: true });
  await wisdom.click();
  await wisdom.click();
  await expect(wisdom).toBeDisabled();
  await page.getByRole("button", { name: "Increase charisma ability increase", exact: true }).click();
  await expect(page.locator(".builder-boost-budget")).toContainText("3 / 3");
  for (const a of abilities) await expect(page.getByRole("button", { name: `Increase ${a} ability increase`, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Decrease wisdom ability increase", exact: true }).click();
  await page.getByRole("button", { name: "Increase intelligence ability increase", exact: true }).click();
  await expect(page.locator(".builder-boost-budget")).toContainText("All 3 points allocated");
  await expect(page.locator(".builder-validation")).toHaveCount(0);
});

test("abilities fit in a compact six-card desktop layout", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 807 });
  await openDraft(page, "fantasy", { boosts: { strength: 2, dexterity: 1 } });
  await page.getByRole("button", { name: "Abilities", exact: true }).click();
  const cards = page.locator(".creation-abilities article");
  await expect(cards).toHaveCount(6);
  await expect(cards.locator("h4")).toHaveText(["STR", "DEX", "CON", "INT", "WIS", "CHA"]);
  await expect(page.getByText("Campaign ability methods", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Ability increases", { exact: true })).toHaveCount(0);
  await expect(cards.first().locator(".builder-ability-stepper.is-increase output")).toHaveCSS("background-color", "rgb(39, 102, 95)");
  await expect.poll(() => page.locator(".creation-main").evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
});

test("point-buy and manual steppers block unaffordable scores and totals above twenty", async ({ page }) => {
  await openDraft(page, "fantasy", { method: "point_buy", scores: { strength: 15, dexterity: 15, constitution: 14, intelligence: 10, wisdom: 8, charisma: 8 } });
  await page.getByRole("button", { name: "Abilities", exact: true }).click();
  await expect(page.getByRole("button", { name: "Increase constitution base score", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Decrease wisdom base score", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Decrease strength base score", exact: true }).click();
  await page.getByRole("button", { name: "Increase constitution base score", exact: true }).click();
  await expect(page.locator(".builder-point-budget")).toContainText("0 / 27");
  await page.getByRole("combobox", { name: "Generation method", exact: true }).selectOption("manual");
  const strength = page.getByRole("button", { name: "Increase strength base score", exact: true });
  for (let i = 0; i < 5; i++) await strength.click();
  await expect(strength).toBeDisabled();
  await expect(page.getByRole("button", { name: "Increase strength ability increase", exact: true })).toBeDisabled();
});

test("campaign settings expose the enabled unrestricted rule and allow opting into restrictions", async ({ page }) => {
  await openDraft(page, "fantasy", { role: "warden" });
  await page.getByRole("button", { name: "Save & close", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Campaign Settings", exact: true }).click();
  const rule = page.getByRole("checkbox", { name: /Unrestricted ability increases/ });
  await expect(rule).toBeChecked();
  await rule.uncheck();
  await page.getByRole("button", { name: "Save character settings", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Character creation settings now apply");
  await expect(rule).not.toBeChecked();
});

for (const width of [1280, 390]) {
test(`${width}px: languages show unique names without books and remove all legacy duplicate selections`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 });
  await openDraft(page, "fantasy", { language_ids: ["abyssal-xphb", "abyssal-phb"] });
  await page.getByRole("button", { name: "Features", exact: true }).click();
  const picker = page.getByRole("region", { name: "Languages", exact: true });
  await expect(picker.getByRole("button", { name: "Abyssal", exact: true })).toHaveCount(1);
  await expect(picker.getByRole("button", { name: "Abyssal", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(picker.getByRole("status")).toContainText("1 / 2");
  await expect(picker.getByRole("combobox")).toHaveCount(0);
  await expect(picker).not.toContainText("XPHB");
  await expect(picker).not.toContainText("PHB");
  await picker.getByRole("button", { name: "Elvish", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Dwarvish", exact: true })).toBeDisabled();
  await picker.getByRole("button", { name: "Abyssal", exact: true }).click();
  await expect(picker.getByRole("status")).toContainText("1 / 2");
  const saved = page.waitForRequest(request => request.method() === "PUT" && request.url().endsWith("/creation/drafts/1") && request.postDataJSON().draft.language_ids.includes("dwarvish"));
  await picker.getByRole("button", { name: "Dwarvish", exact: true }).click();
  expect((await saved).postDataJSON().draft.language_ids.sort()).toEqual(["dwarvish", "elvish-xphb"]);
  await picker.getByRole("searchbox", { name: "Search languages", exact: true }).fill("abyss");
  await expect(picker.locator(".builder-language-list button")).toHaveCount(1);
  await picker.getByRole("button", { name: "Remove Dwarvish", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Abyssal", exact: true })).toBeEnabled();
  await picker.getByRole("button", { name: "Abyssal", exact: true }).click();
  await expect(picker.getByRole("status")).toContainText("2 / 2");
});
}

async function spellTableFits(page) {
  const failures = await page.locator("#builder-options").evaluate(main => {
    const failures = [];
    const bounds = main.getBoundingClientRect();
    for (const node of [main, ...main.querySelectorAll(".builder-result-list, table, tbody td, tbody button, .builder-filter-bar select, .builder-filter-bar input")]) {
      if (!node.getClientRects().length) continue;
      const rect = node.getBoundingClientRect();
      if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || node.scrollWidth > node.clientWidth + 2) failures.push(node.className || node.tagName);
    }
    return failures;
  });
  expect(failures).toEqual([]);
}

for (const theme of ["fantasy", "crt", "simple"]) {
  test(`${theme}: resize spell panes with pointer and keyboard without clipping columns`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => localStorage.setItem("table-columns:/:builder-result-table", JSON.stringify([900, 300, 400, 300, 300])));
    await openDraft(page, theme, { longSpells: true });
    await page.getByRole("button", { name: "Spells", exact: true }).click();
    const separator = page.getByRole("separator", { name: "Resize options and details panels" });
    await expect(separator).toBeVisible();
    await expect(page.getByRole("button", { name: /Details for Mordenkainen/ })).toBeVisible();
    await expect(page.locator(".builder-result-table")).not.toHaveClass(/resizable-table/);
    await spellTableFits(page);
    const before = await page.locator("#builder-options").boundingBox();
    const handle = await separator.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x - 180, handle.y + handle.height / 2, { steps: 6 });
    await page.mouse.up();
    const after = await page.locator("#builder-options").boundingBox();
    expect(after.width).toBeLessThan(before.width - 100);
    await separator.press("Home");
    await expect(separator).toHaveAttribute("aria-valuenow", "25");
    await spellTableFits(page);
    await page.getByRole("button", { name: /Details for Mordenkainen/ }).click();
    await expect(page.locator(".builder-source-text")).toContainText("End of spell rules.");
    await expect(separator).toHaveAttribute("aria-valuenow", "25");
    await spellTableFits(page);
    await separator.press("End");
    await expect(separator).toHaveAttribute("aria-valuenow", "75");
    await spellTableFits(page);
    expect(await page.locator("#builder-details").evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
    const detailScroll = page.locator(".builder-source-scroll");
    await detailScroll.evaluate(panel => panel.scrollTop = panel.scrollHeight);
    expect(await detailScroll.evaluate(panel => panel.scrollTop > 0 && panel.scrollHeight - panel.scrollTop <= panel.clientHeight + 1)).toBe(true);
    await page.getByRole("button", { name: "Expand", exact: true }).click();
    await expect(separator).toHaveCount(0);
    await page.getByRole("button", { name: "Show choices", exact: true }).click();
    await expect(separator).toHaveAttribute("aria-valuenow", "75");
    await separator.press("ArrowLeft");
    await expect(separator).toHaveAttribute("aria-valuenow", "73");
    await page.getByRole("button", { name: "Save & close", exact: true }).click();
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.getByRole("button", { name: "Spells", exact: true }).click();
    await expect(separator).toHaveAttribute("aria-valuenow", "73");
    await separator.dblclick();
    await expect(separator).toHaveAttribute("aria-valuenow", "55");
    await spellTableFits(page);
    if (theme === "fantasy") {
      await page.getByRole("button", { name: /Details for Mordenkainen/ }).click();
      await expect(page.locator(".builder-source-text")).toContainText("End of spell rules.");
      await expect(page.locator("#builder-details")).toHaveCSS("background-color", "rgb(35, 49, 56)");
      const longRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: /Details for Mordenkainen/ }) });
      await longRow.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("resizable-spell-panes.png") });
      await separator.press("Home");
      await longRow.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("compact-spell-pane.png") });
    }
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`${viewport.width}px: narrow spell rows fit and details remain readable`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openDraft(page, "fantasy", { longSpells: true });
    await page.getByRole("button", { name: "Spells", exact: true }).click();
    await expect(page.getByRole("button", { name: /Details for Mordenkainen/ })).toBeVisible();
    await expect(page.getByRole("separator", { name: "Resize options and details panels" })).toBeHidden();
    await spellTableFits(page);
    const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: /Details for Mordenkainen/ }) });
    await row.getByRole("button", { name: "Select", exact: true }).click();
    await expect(row.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Details for Mordenkainen/ }).click();
    await expect(page.locator(".builder-source-text")).toContainText("End of spell rules.");
    await expect(page.locator("#builder-options")).toBeHidden();
    expect(await page.locator("#builder-details").evaluate(panel => panel.scrollWidth <= panel.clientWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await expect(page.locator("#builder-options")).toBeVisible();
    await spellTableFits(page);
  });
}
