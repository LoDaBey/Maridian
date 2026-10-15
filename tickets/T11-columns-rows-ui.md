# T11: Column and row management UI

> Read `tickets/00-README.md` first. **Scope rule:** change only what this ticket asks. Touch only the files under "Allowed changes". If something else seems needed, stop and ask in the hand-off.

## Goal
Editable columns and rows from the grid itself: add, rename, retype, reorder and delete columns, edit status labels and colours, and insert, duplicate, move and delete rows. All of it goes through T08 `dispatch` (so it's realtime and permission-checked on the server), and the UI hides what the role can't do (T04).

## Allowed changes
`components/grid/HeaderCell.tsx`, `components/grid/ColumnMenu.tsx` (new), `components/grid/AddColumnButton.tsx` (new), `components/grid/StatusOptionsEditor.tsx` (new), `components/grid/RowContextMenu.tsx` (new), `components/grid/RowGutter.tsx`, `components/grid/Grid.tsx` (wiring only), `components/ui/*` (new: Dialog, Menu, ConfirmDialog, ColorSwatchPicker, built on native `<dialog>`/popover + Tailwind. **No new dependencies**).

## Spec
1. **Column header menu** (a chevron on hover; right-click on the header too), shown if `column.manage`:
   - **Rename:** inline input in the header. Enter/blur commits `column.update {name}`, Escape cancels.
   - **Change type:** submenu of the 8 types with icons. A confirm dialog shows "Existing values will be converted. Values that can't be converted will be cleared." Before confirming, show a client-side preview count using `convertValue`.
   - **Edit labels** (status only): `StatusOptionsEditor`. Each option has a label input and a colour swatch (the 12 colours from `lib/colors.ts`). Add an option, delete an option (confirm: "N cells use this label and will be cleared"), and drag or up/down to reorder. It saves as one `column.update {settings}` when you press **Done**.
   - **Person settings:** an "Allow multiple people" toggle.
   - Insert column left / right (direction-aware in RTL), Move left / right → `column.move` with a fractional position, and **Delete column** (confirm, with the column name in the dialog) → `column.delete`. A toast offers **Undo** for 8s → `column.restore`.
2. **Add column** "+" button after the last header (`column.manage`): a menu of types → creates the column with the default name "New column" (type-specific defaults: status gets 3 starter options "Done" `#00c875`, "Working on it" `#fdab3d`, "Stuck" `#e2445c`) and immediately opens rename.
3. **Row actions** (right-click a cell or the gutter, or the gutter's kebab on hover):
   - Insert row above / below (`row.insert`, position between neighbours).
   - Duplicate row (`row.insert` with a copy of the data, placed below).
   - Delete row(s), for the selected rows. The menu item is disabled with a tooltip when `canDeleteRow` fails for **any** selected row. A toast offers **Undo** for 8s → `row.restore`.
   - **Drag to reorder** (`row.move`): a drag handle in the gutter (TL+), pointer events only, auto-scroll near the edges, and a drop indicator line. **Disabled while a sort or filter is active** (T12 will set a flag. For now, read `useViewState().isTransformed` with default false, and define that hook stub in `Grid.tsx` if needed).
4. **Optimistic + realtime:** everything goes through `dispatch`, so other users see column and row changes live, and their presence overlays update when a column they're on is deleted (overlays drop silently).
5. **Accessibility:** menus are keyboard navigable, dialogs trap focus, and Escape closes.

## Acceptance criteria
- [ ] A PM can add, rename, retype, reorder and delete columns and edit status labels. A second browser sees each change live.
- [ ] An employee doesn't see the column menu, and forged ops are rejected (T07).
- [ ] An employee can delete **their own** row but not someone else's (the menu is disabled and the server rejects it).
- [ ] Undo for column and row delete works within 8s, for everyone.
- [ ] Row drag-reorder works in RTL and LTR and syncs.
- [ ] Deleting a status label clears exactly the cells that used it.

## Out of scope
Column-level permissions, formulas, grouping.
