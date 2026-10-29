# `/roll` command and postfix guide

This bot uses Discord's `/roll` slash command. Do not type `!roll`.

## Using the command

1. Type `/roll` in a Discord channel and select the bot's command.
2. Discord displays a fixed input box for the roll expression.
3. Enter only the dice expression in that box, such as `2d6/dl:1`.
4. Submit the command.

For example, select `/roll` and enter:

```text
2d6/dl:1
```

## Basic dice syntax

Use `d` between the number of dice and the number of sides:

```text
<number-of-dice>d<number-of-sides>
```

| Input-box value | Meaning |
|---|---|
| `d20` | Roll one 20-sided die |
| `2d6` | Roll two 6-sided dice |
| `4d10` | Roll four 10-sided dice |
| `4dF` | Roll four Fate/Fudge dice |

The number before `d` is optional, so `d20` means the same thing as `1d20`.

### Modifiers

Add or subtract a fixed number after a dice expression:

```text
2d6+3
3d8-2
```

Dice expressions can also be combined:

```text
3d8+d4-1
```

### Multiple roll groups

Separate independent roll groups with spaces in the same input box:

```text
2d4-1 d8 3d20-3d2
```

The bot accepts up to 12 space-separated groups in one command.

## Postfix syntax

A postfix changes how a dice expression is evaluated. Place it directly after the dice:

```text
<dice>/<postfix>:<value>
```

For example:

```text
2d6/dl:1
```

This rolls two six-sided dice and drops the lowest one.

The `:value` portion may be omitted when the postfix has a useful default:

```text
4d6/dl
2d20/exp
```

A normal `+` or `-` modifier comes after the postfix:

```text
4d6/dl:1+3
2d20/kh:1-2
```

Only one postfix can be applied to each dice expression. Postfixes are not supported on Fate/Fudge dice such as `4dF`.

## Available postfixes

### Keeping and dropping dice

| Postfix | Purpose | Input-box example |
|---|---|---|
| `dl` | Drop the specified number of lowest dice; default `1` | `4d6/dl:1` |
| `dh` | Drop the specified number of highest dice; default `1` | `5d10/dh:2` |
| `kl` | Keep the specified number of lowest dice; default `1` | `4d100/kl:1` |
| `kh` | Keep the specified number of highest dice; default `1` | `2d20/kh:1` |

The value must be smaller than the number of dice rolled. For example, `2d6/dl:2` is invalid because it would drop every die.

### Rerolling and changing individual dice

| Postfix | Purpose | Input-box example |
|---|---|---|
| `rr` | Reroll each die whose result is equal to or below the value | `4d6/rr:1` |
| `min` | Raise every result below the value to that value | `6d20/min:10` |
| `luc` | Change results equal to or below the value to the die's maximum; default `1` | `2d20/luc:3` |
| `cur` | Change results in the highest value range to `1`; default `1` | `3d10/cur:2` |

### Exploding dice

| Postfix | Purpose | Input-box example |
|---|---|---|
| `exp` | Roll an additional die when a result is equal to or above the threshold | `2d20/exp` |
| `pen` | As above, but subtract `1` from each additional roll | `2d20/pen` |

Without `:value`, the explosion threshold is the die's maximum. An explicit threshold can also be supplied:

```text
5d10/exp:9
5d10/pen:9
```

### Counting results

| Postfix | Purpose | Input-box example |
|---|---|---|
| `c` | Count results equal to or above the value | `10d8/c:7` |
| `suc` | Count results equal to or above the value as successes and subtract one success for every natural `1` | `7d12/suc:10` |
| `trg` | Count results equal to or below the value | `5d20/trg:10` |
| `hit` | Count results equal to or below the value and report higher results as misses | `3d8/hit:3` |

For `c` and `suc`, omitting the value uses the die's maximum:

```text
6d6/c
6d6/suc
```

### Arithmetic on every die

| Postfix | Purpose | Input-box example |
|---|---|---|
| `add` | Add the value to every die | `2d100/add:50` |
| `sub` | Subtract the value from every die | `5d20/sub:3` |
| `mul` | Multiply every die by the value | `5d2/mul:6` |
| `div` | Divide every die by the value and round up | `4d8/div:2` |

These postfixes operate on each individual die, which can differ from applying one normal modifier to the final total.

### World of Darkness systems

| Postfix | Purpose | Input-box example |
|---|---|---|
| `cod` | Chronicles of Darkness: count results of `8` or higher and explode at the supplied threshold | `7d10/cod:9` |
| `wod` | World of Darkness: count results at or above the target, explode on `10`, and subtract for natural `1`s | `5d10/wod:4` |

Both postfixes require ten-sided dice. With `cod`, omitting the value makes dice explode on `10`:

```text
7d10/cod
```

## Complete examples

In each case, first select `/roll`, then put the shown text in its input box.

Roll four six-sided dice and drop the lowest:

```text
4d6/dl:1
```

Roll with advantage and add `5`:

```text
2d20/kh:1+5
```

Roll ten dice and count results of `7` or higher:

```text
10d8/c:7
```

Roll three different groups at once:

```text
4d6/dl:1 2d20/kh:1+5 10d8/c:7
```

## Quick reference

```text
Basic roll:       2d6
With modifier:    2d6+3
With postfix:     2d6/dl:1
Postfix + bonus:  2d20/kh:1+5
Multiple groups:  4d6/dl:1 2d20/kh:1+5
```
