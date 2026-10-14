// Type checks for the tables that modules export to each other. Each table
// is read-only, so no importer can change what another importer reads. A
// type equals Readonly<> of itself only when its top level is already
// read-only. Each check compares the two, so `npm run typecheck:test` fails
// when a table loses its readonly. The imports are types only, so the suite
// loads none of the DOM modules it names.

import { describe, expectTypeOf, it } from "vitest";

import type * as audio from "./audio";
import type { MASK_COLORS, PALETTE, PALETTE_BRIGHT } from "./shell/ansi";
import type { ALL_COMMANDS } from "./shell/commands/all";
import type { TEST_DATA } from "./shell/testkit";
import type { TABLE_BUTTONS, TOOLBAR_ACTIONS } from "./solitaire/controls";
import type { RANK_LABELS, SUITS } from "./solitaire/klondike";
import type { ICONS, IconName, PAL } from "./solitaire/sprites";

describe("exported tables", () => {
  it("are read-only", () => {
    expectTypeOf<typeof audio.PARAM_DEFAULTS>().toEqualTypeOf<Readonly<typeof audio.PARAM_DEFAULTS>>();
    expectTypeOf<typeof audio.PATCHES>().toEqualTypeOf<Readonly<typeof audio.PATCHES>>();
    expectTypeOf<typeof PALETTE>().toEqualTypeOf<Readonly<typeof PALETTE>>();
    expectTypeOf<typeof PALETTE_BRIGHT>().toEqualTypeOf<Readonly<typeof PALETTE_BRIGHT>>();
    expectTypeOf<typeof MASK_COLORS>().toEqualTypeOf<Readonly<typeof MASK_COLORS>>();
    expectTypeOf<typeof ALL_COMMANDS>().toEqualTypeOf<Readonly<typeof ALL_COMMANDS>>();
    expectTypeOf<typeof TEST_DATA>().toEqualTypeOf<Readonly<typeof TEST_DATA>>();
    expectTypeOf<typeof SUITS>().toEqualTypeOf<Readonly<typeof SUITS>>();
    expectTypeOf<typeof RANK_LABELS>().toEqualTypeOf<Readonly<typeof RANK_LABELS>>();
    expectTypeOf<typeof PAL>().toEqualTypeOf<Readonly<typeof PAL>>();
    expectTypeOf<typeof ICONS>().toEqualTypeOf<Readonly<typeof ICONS>>();
    expectTypeOf<typeof TABLE_BUTTONS>().toEqualTypeOf<Readonly<typeof TABLE_BUTTONS>>();
    expectTypeOf<typeof TOOLBAR_ACTIONS>().toEqualTypeOf<Readonly<typeof TOOLBAR_ACTIONS>>();
  });

  it("hold read-only icon rows", () => {
    type Rows = (typeof ICONS)[IconName];
    expectTypeOf<Rows>().toEqualTypeOf<Readonly<Rows>>();
  });
});

describe("getParams", () => {
  it("returns the params read-only, so setParam is the only writer", () => {
    type Params = ReturnType<typeof audio.getParams>;
    expectTypeOf<Params>().toEqualTypeOf<Readonly<audio.SynthParams>>();
  });
});
