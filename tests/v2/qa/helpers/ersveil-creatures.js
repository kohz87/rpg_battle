// The Ersveil pack's creatures (Story Block examples/packs/ersveil-bluewatch/pack.json, `content.creatures`,
// v2 branch), copied for the balance simulation and QA: a chat that plays Ersveil keeps them in its
// bestiary as RPG Battle's templates clean them (templates.cleanCreature). Test data only.
export const ERSVEIL_CREATURES = Object.freeze([
    {
        "name": "Starved Crag Wolf",
        "aliases": [
            "Crag Wolf",
            "Starved Wolf"
        ],
        "template": "beast",
        "level": 3,
        "role": "skirmisher",
        "talks": false,
        "coins": false,
        "temperament": "wild",
        "traits": [
            "swift",
            "frail"
        ],
        "moves": [
            {
                "name": "Bite",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "bleed"
                ],
                "cooldown": 2,
                "description": "Teeth that tear."
            },
            {
                "name": "Pounce",
                "type": "physical",
                "stat": "AGI",
                "target": "one",
                "effect": [
                    "stun"
                ],
                "cooldown": 3,
                "description": "A leap off the rocks."
            },
            {
                "name": "Howl",
                "type": "debuff",
                "stat": "CHA",
                "target": "all",
                "effect": [
                    "weaken"
                ],
                "cooldown": 4,
                "description": "A howl from the bluff."
            }
        ],
        "loot": [
            {
                "name": "Crag Wolf Pelt",
                "chance": 60,
                "qty": [
                    1,
                    1
                ],
                "kind": "material"
            },
            {
                "name": "Crag Wolf Fang",
                "chance": 40,
                "qty": [
                    1,
                    2
                ],
                "kind": "material"
            },
            {
                "name": "Small Monster Core",
                "chance": 5,
                "qty": [
                    1,
                    1
                ],
                "kind": "material"
            }
        ],
        "look": "Gaunt grey wolf of the bluffs, ribs showing through a patchy coat; hunger has made it bold."
    },
    {
        "name": "Crag Wolf Matriarch",
        "template": "beast",
        "level": 5,
        "role": "brute",
        "talks": false,
        "coins": false,
        "temperament": "proud",
        "traits": [
            "leader",
            "fierce"
        ],
        "moves": [
            {
                "name": "Bite",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "bleed"
                ],
                "cooldown": 2,
                "description": "Teeth that tear."
            },
            {
                "name": "Rend",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [],
                "cooldown": 1,
                "description": "A raking swipe."
            },
            {
                "name": "Howl",
                "type": "debuff",
                "stat": "CHA",
                "target": "all",
                "effect": [
                    "weaken"
                ],
                "cooldown": 4,
                "description": "The pack answers her."
            }
        ],
        "loot": [
            {
                "name": "Crag Wolf Pelt",
                "chance": 80,
                "qty": [
                    1,
                    1
                ],
                "kind": "material"
            },
            {
                "name": "Crag Wolf Fang",
                "chance": 60,
                "qty": [
                    1,
                    2
                ],
                "kind": "material"
            },
            {
                "name": "Small Monster Core",
                "chance": 20,
                "qty": [
                    1,
                    1
                ],
                "kind": "material"
            }
        ],
        "look": "The pack's grey-muzzled leader, scarred and less starved than the rest."
    },
    {
        "name": "Cellar Rat Swarm",
        "aliases": [
            "Cellar Rat",
            "Granary Rat",
            "Plague Rat"
        ],
        "template": "beast",
        "level": 1,
        "role": "skirmisher",
        "talks": false,
        "coins": false,
        "temperament": "cowardly",
        "traits": [
            "frail",
            "swift"
        ],
        "moves": [
            {
                "name": "Bite",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "poison"
                ],
                "cooldown": 2,
                "description": "Dirty teeth; the bite festers."
            },
            {
                "name": "Swarm",
                "type": "physical",
                "stat": "AGI",
                "target": "all",
                "effect": [],
                "cooldown": 3,
                "description": "A squealing rush out of the bins."
            }
        ],
        "loot": [
            {
                "name": "Rat Tail",
                "chance": 80,
                "qty": [
                    1,
                    2
                ],
                "kind": "material"
            }
        ],
        "look": "Fat brown rats boiling out of the grain bins, bold in the dark."
    },
    {
        "name": "Sluice Leech",
        "aliases": [
            "Culvert Leech",
            "Giant Leech"
        ],
        "template": "insect",
        "level": 2,
        "role": "tank",
        "talks": false,
        "coins": false,
        "temperament": "mindless",
        "traits": [
            "slow",
            "savage"
        ],
        "moves": [
            {
                "name": "Latch",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "bleed"
                ],
                "cooldown": 2,
                "description": "A sucker clamps on and drinks."
            },
            {
                "name": "Drain",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "weaken"
                ],
                "cooldown": 3,
                "description": "It swells as you weaken."
            }
        ],
        "loot": [
            {
                "name": "Live Leech",
                "chance": 70,
                "qty": [
                    1,
                    2
                ],
                "kind": "material"
            }
        ],
        "look": "Arm-long black leeches clotted on the culvert grate, swaying toward warmth."
    },
    {
        "name": "River Drake",
        "template": "drake",
        "level": 12,
        "role": "brute",
        "talks": false,
        "coins": false,
        "temperament": "proud",
        "traits": [
            "armoured"
        ],
        "moves": [
            {
                "name": "Rending Bite",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "bleed"
                ],
                "cooldown": 2,
                "description": "Teeth like knives."
            },
            {
                "name": "Tail Lash",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "stun"
                ],
                "cooldown": 3,
                "description": "A tail like a club."
            },
            {
                "name": "Drag Under",
                "type": "physical",
                "stat": "STR",
                "target": "one",
                "effect": [
                    "slow"
                ],
                "cooldown": 3,
                "description": "It rolls into the current with its prey."
            }
        ],
        "loot": [
            {
                "name": "River Drake Scale",
                "chance": 60,
                "qty": [
                    1,
                    2
                ],
                "kind": "material"
            },
            {
                "name": "Small Monster Core",
                "chance": 20,
                "qty": [
                    1,
                    1
                ],
                "kind": "material"
            }
        ],
        "look": "A long armoured river lizard of the Bluewatch Branch; it takes ferrymen and swimmers."
    },
    {
        "name": "Salt-crew Tough",
        "aliases": [
            "Brecht's man",
            "Smuggler"
        ],
        "template": "humanoid",
        "level": 3,
        "role": "skirmisher",
        "talks": true,
        "coins": true,
        "temperament": "cunning",
        "traits": [],
        "moves": [
            {
                "name": "Quick Cut",
                "type": "physical",
                "stat": "DEX",
                "target": "one",
                "effect": [
                    "bleed"
                ],
                "cooldown": 2,
                "description": "A fast, mean cut."
            },
            {
                "name": "Dirty Trick",
                "type": "debuff",
                "stat": "DEX",
                "target": "one",
                "effect": [
                    "weaken"
                ],
                "cooldown": 3,
                "description": "Salt in the eyes."
            }
        ],
        "loot": [
            {
                "name": "Coarse Salt",
                "chance": 50,
                "qty": [
                    1,
                    3
                ],
                "kind": "material"
            },
            {
                "name": "Knife",
                "chance": 15,
                "qty": [
                    1,
                    1
                ],
                "kind": "material"
            }
        ],
        "look": "One of Brecht's smugglers from the salt sheds: knife on the belt, counting newcomers."
    }
]);
