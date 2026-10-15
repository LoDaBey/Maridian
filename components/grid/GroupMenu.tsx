"use client";

import { useState } from "react";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ColorPicker } from "./ColorPicker";

export function GroupMenu({
  open,
  x,
  y,
  name,
  color,
  canDelete,
  onClose,
  onRename,
  onRecolor,
  onDuplicate,
  onDelete,
}: {
  open: boolean;
  x: number;
  y: number;
  name: string;
  color: string;
  canDelete: boolean;
  onClose: () => void;
  onRename: () => void;
  onRecolor: (color: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [colorsOpen, setColorsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <Menu open={open && !colorsOpen} x={x} y={y} label={`Group menu for ${name}`} onClose={onClose}>
        <MenuItem
          label="Rename"
          onSelect={() => {
            onClose();
            onRename();
          }}
        />
        <MenuItem label="Change color" onSelect={() => setColorsOpen(true)} />
        <MenuItem
          label="Duplicate group"
          onSelect={() => {
            onClose();
            onDuplicate();
          }}
        />
        <MenuItem
          label="Delete group"
          danger
          disabled={!canDelete}
          title={canDelete ? undefined : "Keep at least one group."}
          onSelect={() => {
            setDeleteOpen(true);
          }}
        />
      </Menu>
      <Menu
        open={open && colorsOpen}
        x={x + 200}
        y={y + 36}
        label={`Color for ${name}`}
        onClose={() => setColorsOpen(false)}
      >
        <ColorPicker
          value={color}
          onChange={(next) => {
            onRecolor(next);
            setColorsOpen(false);
            onClose();
          }}
        />
      </Menu>
      <ConfirmDialog
        open={deleteOpen}
        title={`Delete ${name}`}
        message={`Delete group ${name}? Items in this group will be deleted.`}
        confirmLabel="Delete group"
        danger
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          onDelete();
          setDeleteOpen(false);
          onClose();
        }}
      />
    </>
  );
}
