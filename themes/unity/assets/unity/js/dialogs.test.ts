// Type checks for the result of window.uiDialog. tsc infers the result
// from the ids in a call's `buttons`, so `npm run typecheck:test` fails
// when a call's result widens back to string. The suite opens no dialog,
// because the dialog layer needs a DOM. Each check reads the type of a
// function that never runs.

import { describe, expectTypeOf, it } from "vitest";

import type { UPDialogOptions } from "./types";

type UIDialog = NonNullable<Window["uiDialog"]>;

describe("uiDialog", () => {
  it("resolves to one of the call's button ids or null", () => {
    const confirm = (dialog: UIDialog) =>
      dialog({
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "delete", label: "Delete", primary: true, danger: true },
        ],
      });
    expectTypeOf(confirm).returns.resolves.toEqualTypeOf<"cancel" | "delete" | null>();
  });

  it("resolves to the default button's id without buttons", () => {
    const info = (dialog: UIDialog) => dialog({ title: "Information" });
    expectTypeOf(info).returns.resolves.toEqualTypeOf<"ok" | null>();
  });

  it("rejects a comparison with an id the call does not pass", () => {
    const typo = async (dialog: UIDialog) => {
      const r = await dialog({
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "empty", label: "Empty Trash", primary: true },
        ],
      });
      // @ts-expect-error -- "empyt" is not one of the call's button ids.
      return r === "empyt";
    };
    expectTypeOf(typo).returns.resolves.toBeBoolean();
  });

  it("resolves to any string for options typed without ids", () => {
    const preset = (dialog: UIDialog, opts: UPDialogOptions) => dialog(opts);
    expectTypeOf(preset).returns.resolves.toEqualTypeOf<string | null>();
  });
});
