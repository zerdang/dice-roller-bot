export const RULES_URL = "https://www.dndbeyond.com/sources/dnd/br-2024/rules-glossary";
export const EQUIPMENT_URL = "https://www.dndbeyond.com/sources/dnd/br-2024/equipment";
const normalize = value => String(value || "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();

// Brief reminders; full requirements remain in the linked 2024 rules.
export const COMMON_ACTIONS = [
  ["attack", "Attack", "Action", "Attack with a weapon or an Unarmed Strike; the latter can damage, grapple, or shove."],
  ["dash", "Dash", "Action", "Gain extra movement based on your Speed."],
  ["disengage", "Disengage", "Action", "Move without provoking Opportunity Attacks this turn."],
  ["dodge", "Dodge", "Action", "Defend until your next turn; movement and awareness matter."],
  ["help", "Help", "Action", "Aid an ally’s proficient check, or distract an enemy within 5 feet for an ally’s attack."],
  ["hide", "Hide", "Action", "Seek concealment with Dexterity (Stealth); cover and sight matter."],
  ["influence", "Influence", "Action", "Use social skills to sway another creature."],
  ["magic", "Magic", "Action", "Cast an action spell or activate a suitable magical feature or item."],
  ["ready", "Ready", "Action", "Choose a trigger and response; release it with your Reaction. Readied spells require Concentration."],
  ["search", "Search", "Action", "Look for clues with an appropriate Wisdom skill."],
  ["study", "Study", "Action", "Recall or investigate information using an Intelligence skill."],
  ["utilize", "Utilize", "Action", "Operate an object whose use requires an action."],
  ["opportunity", "Opportunity Attack", "Reaction", "React when a visible enemy leaves your reach; check exceptions."],
  ["interact", "Object interaction", "Interaction", "One simple interaction during your move or action; extra interactions may require Utilize."],
].map(([id, name, category, notes]) => ({ id, name, category, notes, origin: "Common" }));

export function actionCategory(value) {
  const text = normalize(value);
  if (/^(?:1 )?bonus action\b/.test(text)) return "Bonus Action";
  if (/^(?:1 )?reaction\b/.test(text)) return "Reaction";
  if (/^(?:1 )?(?:action|magic action|utilize action)\b/.test(text) || text === "attack") return "Action";
  if (text === "interaction") return "Interaction";
  return "Other";
}

export function actionSlot(category) {
  return ({ Action: "action", Attack: "action", "Bonus Action": "bonus", Reaction: "reaction", Interaction: "interaction" })[category] || null;
}

const WEAPONS = new Set("club,dagger,greatclub,handaxe,javelin,light hammer,mace,quarterstaff,sickle,spear,dart,light crossbow,shortbow,sling,battleaxe,flail,glaive,greataxe,greatsword,halberd,lance,longsword,maul,morningstar,pike,rapier,scimitar,shortsword,trident,warhammer,war pick,whip,blowgun,hand crossbow,heavy crossbow,longbow,musket,pistol".split(","));

export function characterActions(card) {
  const result = [];
  for (const [index, spell] of (card.spells || []).entries()) {
    if (!spell.name) continue;
    const longerCasting = /^\d+\s+(?:minute|hour|min\b)/.test(normalize(spell.casting_time));
    result.push({ id: `spell:${spell.id || index}`, name: spell.name, origin: "Spell", category: longerCasting ? "Action" : actionCategory(spell.casting_time), tab: "Spells",
      notes: [spell.casting_time || "Check casting time", spell.range, longerCasting ? "Magic each turn; Concentration required" : "", spell.prepared === false || spell.prepared === 0 ? "Check preparation" : "", "Check slots, components, and the spell’s requirements."].filter(Boolean).join(" · ") });
  }
  const configuredAttacks = new Set((card.attacks || []).map(item => normalize(item.name)));
  const equipment = (card.inventory || []).filter(item => item.name && (item.quantity == null || Number(item.quantity) > 0));
  const hasTinderbox = equipment.some(item => normalize(item.name) === "tinderbox");
  for (const [index, item] of equipment.entries()) {
    const name = normalize(item.name).replace(/ \+\d+$/, "");
    if (WEAPONS.has(name) && configuredAttacks.has(normalize(item.name))) continue;
    let category = actionCategory(item.activation || item.action_type || item.category);
    let notes = "Check the item’s activation, requirements, and remaining uses.";
    let label = item.name;
    if (WEAPONS.has(name)) { category = "Action"; label = `Attack: ${item.name}`; notes = "Check reach, proficiency, and whether the weapon is ready to use."; }
    else if (/^(?:(?:greater|superior|supreme) )?healing potion$|^potion of (?:(?:greater|superior|supreme) )?healing$/.test(name)) {
      category = "Bonus Action"; notes = "Drink or administer within 5 feet; check healing and quantity.";
    } else if (name === "healers kit") { category = "Action"; notes = "Utilize to stabilize a dying creature; spend a kit use."; }
    else if (name === "rope" || name === "rope, hempen" || name === "rope, silk") { category = "Action"; notes = "Utilize to tie a knot; binding an unwilling creature has prerequisites."; }
    else if (name === "grappling hook") { category = "Action"; notes = "Utilize to throw the hook; check range and the Acrobatics check."; }
    else if (name === "torch" && hasTinderbox) { category = "Bonus Action"; label = "Light a torch"; notes = "Use your Tinderbox with exposed fuel."; }
    result.push({ id: `item:${item.id || index}`, name: label, origin: "Equipment", category, notes, tab: "Inventory" });
  }
  for (const [index, feature] of (card.features || []).entries()) {
    const category = actionCategory(feature.activation || feature.action_type || feature.category);
    if (!feature.name || category === "Other") continue;
    result.push({ id: `feature:${feature.id || index}`, name: feature.name, category, origin: "Feature", notes: feature.notes || "Check feature requirements and remaining uses.", tab: "Features & Traits" });
  }
  const seen = new Set();
  return result.filter(item => { const key = `${item.origin}:${normalize(item.name)}:${item.category}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

export function readTurn(reminders) {
  try {
    const value = JSON.parse(reminders?.turn_2024 || "{}");
    return Object.fromEntries(["action", "bonus", "reaction", "interaction"].map(key => [key, value?.[key] === true]));
  } catch { return { action: false, bonus: false, reaction: false, interaction: false }; }
}
