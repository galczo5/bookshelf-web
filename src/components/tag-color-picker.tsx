"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import { TAG_COLORS } from "@/lib/tag-colors";

interface TagColorPickerProps {
  currentColor: string;
  onSelect: (color: string) => void;
  disabled?: boolean;
}

export function TagColorPicker({
  currentColor,
  onSelect,
  disabled,
}: TagColorPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);

  function handleSelect(color: string) {
    onSelect(color);
    setOpen(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="Change tag color"
          className="h-5 w-5 rounded-full border border-white shadow-sm ring-1 ring-zinc-300 transition hover:ring-zinc-400 disabled:opacity-50"
          style={{ backgroundColor: currentColor }}
        />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-50 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg"
          sideOffset={6}
          align="start"
        >
          <div className="grid grid-cols-4 gap-1.5">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Color ${color}`}
                onClick={() => handleSelect(color)}
                className="h-6 w-6 rounded-full border border-white shadow-sm transition hover:scale-110"
                style={{
                  backgroundColor: color,
                  boxShadow:
                    color === currentColor ? `0 0 0 2px white, 0 0 0 3.5px ${color}` : undefined,
                }}
              />
            ))}
          </div>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
