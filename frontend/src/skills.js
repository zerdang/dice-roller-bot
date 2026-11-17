export const SKILL_TIERS = [
  {
    id: "trained", label: "TRAINED", bonus: 10, skills: [
      ["chemistry", "Chemistry", "Chemical composition, reactions, compounds, and laboratory practice."],
      ["athletics", "Athletics", "Running, climbing, jumping, swimming, and sustained physical effort."],
      ["rimwise", "Rimwise", "People, customs, hazards, and informal networks on the frontier."],
      ["theology", "Theology", "Religions, doctrines, rituals, cults, and belief systems."],
      ["archaeology", "Archaeology", "Recovering and interpreting material remains of past cultures."],
      ["art", "Art", "Creating, evaluating, and understanding visual or performance art."],
      ["mathematics", "Mathematics", "Calculation, formal logic, statistics, and abstract models."],
      ["zero-g", "Zero-G", "Moving and working safely in microgravity and free fall."],
      ["computers", "Computers", "Operating, diagnosing, and using computer systems and software."],
      ["jury-rigging", "Jury-Rigging", "Fast, temporary repairs made from whatever is available."],
      ["industrial-equipment", "Industrial Equipment", "Operating heavy tools, machinery, loaders, and industrial systems."],
      ["geology", "Geology", "Rocks, minerals, planetary strata, and geological processes."],
      ["botany", "Botany", "Plant life, cultivation, identification, and plant biology."],
      ["zoology", "Zoology", "Animal behavior, anatomy, identification, and biology."],
      ["linguistics", "Linguistics", "Languages, communication systems, translation, and deciphering."],
      ["pharmacology", "Pharmacology", "Drugs, dosages, interactions, toxins, and medical compounds."],
      ["wilderness-survival", "Wilderness Survival", "Finding shelter, food, routes, and safety in hostile environments."],
      ["hand-to-hand", "Hand-to-Hand Combat", "Fighting effectively at grappling and melee distance."],
      ["firearms", "Firearms", "Safe, accurate use and maintenance of personal firearms."],
    ].map(([id, name, description]) => ({ id, name, description, requires: [] })),
  },
  {
    id: "expert", label: "EXPERT", bonus: 15, skills: [
      ["physics", "Physics", "Forces, energy, radiation, matter, and predictive physical models.", ["mathematics"]],
      ["piloting", "Piloting", "Controlling spacecraft and other complex vehicles under pressure.", ["zero-g"]],
      ["hacking", "Hacking", "Bypassing digital security and exploiting networked systems.", ["computers"]],
      ["mechanical-repair", "Mechanical Repair", "Diagnosing and repairing engines, mechanisms, and machinery.", ["jury-rigging", "industrial-equipment"]],
      ["asteroid-mining", "Asteroid Mining", "Surveying and extracting useful material in low-gravity environments.", ["industrial-equipment", "geology"]],
      ["ecology", "Ecology", "Understanding organisms as parts of environments and food webs.", ["botany", "zoology"]],
      ["field-medicine", "Field Medicine", "Emergency diagnosis and treatment outside a clinical facility.", ["wilderness-survival", "pharmacology"]],
      ["pathology", "Pathology", "Identifying disease, injury, and causes of death from biological evidence.", ["chemistry", "pharmacology"]],
      ["psychology", "Psychology", "Behavior, cognition, trauma, motivation, and mental illness.", ["linguistics"]],
      ["military-training", "Military Training", "Unit tactics, combat procedure, discipline, and battlefield awareness.", ["athletics", "hand-to-hand", "firearms"]],
      ["mysticism", "Mysticism", "Esoteric traditions, occult practice, symbols, and anomalous belief.", ["theology", "art", "archaeology", "rimwise"]],
    ].map(([id, name, description, requires]) => ({ id, name, description, requires })),
  },
  {
    id: "master", label: "MASTER", bonus: 20, skills: [
      ["hyperspace", "Hyperspace", "Navigation theory and practical operation beyond conventional space.", ["physics", "piloting"]],
      ["artificial-intelligence", "Artificial Intelligence", "Designing, analyzing, and controlling synthetic intelligence.", ["hacking"]],
      ["engineering", "Engineering", "Designing and rebuilding complex mechanical or structural systems.", ["physics", "mechanical-repair"]],
      ["robotics", "Robotics", "Designing, programming, diagnosing, and repairing robots.", ["mechanical-repair", "hacking"]],
      ["cybernetics", "Cybernetics", "Interfacing biological organisms with machines and synthetic components.", ["mechanical-repair", "field-medicine"]],
      ["command", "Command", "Coordinating personnel and making effective decisions under pressure.", ["military-training", "psychology"]],
      ["planetology", "Planetology", "Integrated analysis of planetary formation, terrain, climate, and resources.", ["geology", "ecology"]],
      ["surgery", "Surgery", "Invasive treatment, trauma surgery, and complex medical procedures.", ["field-medicine", "pathology"]],
      ["exobiology", "Exobiology", "Studying organisms that evolved outside known terrestrial biology.", ["ecology", "pathology"]],
      ["sophontology", "Sophontology", "Studying intelligent beings, cultures, cognition, and communication.", ["psychology", "linguistics"]],
      ["explosives", "Explosives", "Building, placing, identifying, and safely disarming explosive devices.", ["chemistry", "military-training", "asteroid-mining"]],
      ["xenoesotericism", "Xenoesotericism", "Interpreting alien ritual, metaphysics, symbols, and impossible phenomena.", ["mysticism", "archaeology"]],
    ].map(([id, name, description, requires]) => ({ id, name, description, requires })),
  },
];

export const ALL_SKILLS = SKILL_TIERS.flatMap((tier) => tier.skills.map((skill) => ({ ...skill, tier: tier.id, bonus: tier.bonus })));
export const SKILL_BY_ID = Object.fromEntries(ALL_SKILLS.map((skill) => [skill.id, skill]));

export const CLASS_SKILLS = {
  marine: ["military-training", "athletics"],
  android: ["linguistics", "computers", "mathematics"],
  teamster: ["industrial-equipment", "zero-g"],
  scientist: [],
};

export function canSelectSkill(skill, selected) {
  return !skill.requires.length || skill.requires.some((id) => selected.includes(id));
}

export function pruneInvalidSkills(selected) {
  let current = [...new Set(selected.filter((id) => SKILL_BY_ID[id]))];
  let next = current.filter((id) => canSelectSkill(SKILL_BY_ID[id], current));
  while (next.length !== current.length) {
    current = next;
    next = current.filter((id) => canSelectSkill(SKILL_BY_ID[id], current));
  }
  return next;
}
