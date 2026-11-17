# D&D 5e — 2024 rules matrix

Pinned reusable source: **System Reference Document 5.2.1**, released under CC BY 4.0. Source/version manifest: `rules/srd-5.2.1-manifest.json`. This repository records section pointers and short adaptations, not a copied rules corpus.

| Topic | Pinned SRD 5.2.1 section | Release 1 behavior | Manual boundary | Regression evidence |
| --- | --- | --- | --- | --- |
| D20 tests; advantage/disadvantage | Playing the Game → D20 Tests | Explicit mode rolls one or two d20 and selects high/low; modes cannot stack | DM sets modifier and outcome | `test_advantage_and_disadvantage_select_one_d20` |
| Heroic Inspiration | Rules Glossary → Heroic Inspiration | Boolean resource; retry-safe linked reroll preserves original event and consumes once | Player decides when eligible and uses new result | `test_inspiration_reroll_is_linked_and_idempotent` |
| Concentration | Rules Glossary → Concentration | Visible reminder; saves can be rolled from the card | DC, failure, and effect ending are manual | UI label/reference review |
| Exhaustion | Rules Glossary → Exhaustion | Numeric level 0–6; no 2014 penalty automation | Apply current rules at table | Bounds test in card update |
| Surprise / Initiative | Rules Glossary → Surprise; Combat → Initiative | Initiative modifier/roll; existing tracker remains manual | DM applies surprise Initiative effect; no surprise round | UI reference review |
| Grappling / Shoving | Rules Glossary → Unarmed Strike | Reference points to 2024 save procedure | Target/save/escape adjudication manual | UI reference review |
| Hide | Rules Glossary → Hide | Searchable reference reminder | Visibility, DC, and line of sight manual | UI reference review |
| Conditions | Rules Glossary → Conditions | Named standard picker; Exhaustion and Concentrating are distinct state | Consequences are not globally applied | token serialization/permission tests |
| Weapon Mastery | Equipment → Weapon Mastery Properties | Custom feature/reminder fields | Eligibility and effects manual | combat-card persistence test |
| Areas of Effect | Rules Glossary → Area of Effect | Existing circle/cone/line/rectangle tools use scene units | Targets and obstruction manual | battlemap geometry tests |

No ability check is treated as an automatic critical success/failure. The D&D roll engine reports dice and totals only.
