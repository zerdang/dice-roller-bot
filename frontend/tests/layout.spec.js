import { test, expect } from "@playwright/test";

const abilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const scores = Object.fromEntries(abilities.map(name => [name, 12]));
const sources = Array.from({ length: 60 }, (_, i) => `Book ${String(i + 1).padStart(2, "0")}`);
const policy = { revision: 1, methods: ["array", "point_buy", "rolled"], manual_review_required: true, flexible_background_abilities: false };
const card = {
  id: 1, name: "Test hero", revision: 1, hp: 10, max_hp: 12, temp_hp: 0, speed: 30, armor_class: 12,
  ability_scores: scores, proficiency_bonus: 2, identity: {}, conditions: [], attacks: [], spells: [],
  inventory: Array.from({ length: 40 }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 1, notes: "Inventory description" })),
  features: [], background: {}, resources: [], notes: "Long character notes", can_open: true,
};
const drafts = Array.from({ length: 30 }, (_, i) => ({ id: String(i + 1), name: `Draft ${i + 1}`, is_own: true, updated_at: "2026-11-16T12:00:00Z", scores, class_name: "Wizard", species_name: "Elf" }));
const scene = { id: 1, name: "Test scene", is_active: true, revision: 1, width: 1000, height: 1000, grid_size: 50, grid_offset_x: 0, grid_offset_y: 0, units_per_square: 5, unit_label: "ft", grid_visible: true, snap_enabled: true };

async function mockCampaign(page, role, hasScene) {
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let value = [];
    if (path === "/api/auth/me") value = { user: { username: "Tester" }, active_campaign_id: 1, campaigns: [{ id: 1, name: "Test campaign", game_system: "dnd", role }] };
    else if (path === "/api/dashboard") value = {
      role, campaign: { id: 1, name: "Test campaign", game_system: "dnd" }, characters: [card], dnd_characters: [card],
      dnd_roster: Array.from({ length: 40 }, (_, i) => ({ ...card, id: i + 1, name: `Hero ${i + 1}`, controller_key: "tester", controller_name: "Tester", is_active: i === 0 })), turn_order: [],
      dnd_rolls: Array.from({ length: 40 }, (_, i) => ({ id: i, actor_name: "Tester", label: `Roll ${i}`, total: 10, expression: "1d20", dice: [10], selected: [10], audience: "public", created_at: "2026-11-16T12:00:00Z" })),
    };
    else if (path === "/api/battlemap/state") value = { scene: hasScene ? scene : null, tokens: [], annotations: [], presets: [] };
    else if (path === "/api/battlemap/scenes") value = hasScene ? Array.from({ length: 40 }, (_, i) => ({ ...scene, id: i + 1, name: `Scene ${i + 1}` })) : [];
    else if (path === "/api/dnd/creation/settings") value = policy;
    else if (path === "/api/dnd/reference/meta") value = { version: "v1", kinds: { item: "Item" }, editions: ["2024"], sources, all_sources: sources, allowed_sources: null };
    else if (path === "/api/dnd/reference") value = { version: "v1", total: 90, items: Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `Reference ${i + 1}`, source: "TEST", kind: "item", warnings: [] })) };
    else if (path === "/api/dnd/creation/drafts") value = drafts;
    else if (path.endsWith("/options")) value = { items: [], total: 0 };
    else if (path.startsWith("/api/dnd/creation/drafts/")) value = {
      id: "1", revision: 1, version: "v1", controllers: [{ id: "dm", name: "DM" }], owner_controller_id: "dm",
      draft: { name: "Draft 1", method: "array", scores, boosts: Object.fromEntries(abilities.map(name => [name, 0])), equipment: {}, notes: "Review notes", class_skills: [] },
      preview: { errors: [], review: [], selected: {}, policy, class_skill_options: [], eligible_boosts: abilities, scores, modifiers: scores },
    };
    if (path.endsWith("/portrait")) return route.fulfill({ status: 404, body: "No portrait" });
    await route.fulfill({ json: value });
  });
}

// Scroll normally, then verify the entire target is inside every clipping
// ancestor and can receive pointer input. Being in the DOM is not sufficient.
async function reachable(locator) {
  // Search results can finish rendering after a scroll. Retry the whole
  // scroll-and-measure operation rather than measuring stale geometry.
  await expect(async () => {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport({ ratio: 0.99, timeout: 1000 });
    const clippedBy = await locator.evaluate(element => {
      const target = element.getBoundingClientRect();
      const failures = [];
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
        const bounds = parent.getBoundingClientRect();
        const top = bounds.top + parent.clientTop;
        if (target.top < top - 2 || target.bottom > top + parent.clientHeight + 2) failures.push(parent.className || parent.tagName);
      }
      return failures;
    });
    expect(clippedBy).toEqual([]);
  }).toPass({ timeout: 5000 });
  if (await locator.evaluate(element => element.matches("button,input,select"))) await locator.click({ trial: true });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  for (const theme of ["crt", "simple", "fantasy"]) {
    test(`${theme} ${viewport.width}x${viewport.height}: all bottom controls remain reachable`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(theme => localStorage.setItem("tabletop-theme", theme), theme);
      await mockCampaign(page, "warden", true);
      await page.goto("/");
      const dock = page.locator(".table-sidebar");
      await expect(dock).toBeVisible();
      await dock.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
      await reachable(page.getByRole("button", { name: "Reset view", exact: true }));
      await page.getByRole("button", { name: "Draw shapes", exact: true }).click();
      await reachable(page.getByRole("button", { name: "rectangle", exact: true }));
      await dock.getByRole("button", { name: "Expand sidebar", exact: true }).click();
      for (const expanded of [false, true]) {
        if (expanded) await page.getByRole("button", { name: "Controls", exact: true }).click();
        await dock.getByRole("button", { name: "Campaign Settings", exact: true }).click();
        await reachable(page.getByRole("button", { name: "Allow all sources", exact: true }));
        await reachable(page.getByRole("checkbox", { name: "Enable Book 60", exact: true }));
      }
      for (const [tab, target] of [
        ["Party", ".party-card:last-child .party-actions button:last-child"],
        ["Scenes", ".scene-folder-group:last-child .scene-sidebar-row:last-child button:last-child"],
        ["Selection", ".selection-scroll label:last-child input"],
        ["Reference", ".reference-pagination button:last-child"],
        ["Game Log", ".dice-shortcuts button:last-child"],
      ]) {
        await dock.getByRole("button", { name: tab, exact: true }).click();
        if (tab === "Party") await page.locator(".party-player-toggle").click();
        await reachable(page.locator(target));
        if (theme === "fantasy" && viewport.width === 1440 && tab === "Game Log") await page.screenshot({ path: testInfo.outputPath("atlas-tabletop.png") });
      }
      await dock.getByRole("button", { name: "Party", exact: true }).click();
      await page.locator(".party-player-toggle").click();
      await page.locator(".party-card").first().getByRole("button", { name: "Inspect", exact: true }).click();
      await reachable(page.getByRole("button", { name: "Place token", exact: true }));
      await page.getByRole("button", { name: "Open full sheet", exact: true }).click();
      await page.getByRole("button", { name: "Inventory", exact: true }).click();
      await reachable(page.locator(".inventory-sheet-list article:last-child"));
      await page.locator(".sheet-header").getByRole("button", { name: "Close", exact: true }).click();
      await dock.getByRole("button", { name: "Character creation drafts", exact: true }).click();
      await reachable(page.locator(".draft-summary-list article:last-child").getByRole("button", { name: "Resume" }));
      await page.locator(".draft-summary-list article:first-child").getByRole("button", { name: "Resume" }).click();
      await reachable(page.getByRole("button", { name: "Next step", exact: true }));
      await page.getByRole("button", { name: "Review", exact: true }).click();
      await reachable(page.getByRole("button", { name: "Save draft", exact: true }));
    });
  }
}

test("player dock without an active scene and future panes have a scroll fallback", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await mockCampaign(page, "player", false);
  await page.goto("/");
  await reachable(page.getByRole("button", { name: "Locate token", exact: true }));
  await page.getByRole("button", { name: "Open sheet", exact: true }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await reachable(page.locator(".inventory-sheet-list article:last-child"));
  await page.locator(".sheet-header").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Character creation drafts", exact: true }).click();
  await page.locator(".draft-summary-list article:first-child").getByRole("button", { name: "Resume" }).click();
  await reachable(page.getByRole("button", { name: "Next step", exact: true }));
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await reachable(page.getByRole("button", { name: "Save draft", exact: true }));
  await page.getByRole("button", { name: "Save & close", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator(".sidebar-content").evaluate(content => {
    content.replaceChildren();
    const pane = document.createElement("section");
    pane.className = "sidebar-pane future-pane";
    pane.innerHTML = '<header>Future pane</header><div class="sidebar-scroll">' + '<p>Long content</p>'.repeat(100) + '<button>Bottom action</button></div>';
    content.append(pane);
  });
  await reachable(page.getByRole("button", { name: "Bottom action", exact: true }));
});
