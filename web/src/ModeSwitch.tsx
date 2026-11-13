import { useState } from "react";
import type { Mode } from "@osu-pp/shared";
import { useAccount } from "./account";
import { useI18n } from "./i18n";

/**
 * The game mode of the player pages (My profile, Maps for you): the player's main mode on
 * osu! until they pick another, then the same pick on both pages.
 */

const MODES: { id: Mode; label: string }[] = [
  { id: "osu", label: "osu!" },
  { id: "taiko", label: "taiko" },
  { id: "catch", label: "catch" },
  { id: "mania", label: "mania" },
];

let picked: Mode | null = null;

export function usePlayerMode(): [Mode, (mode: Mode) => void] {
  const account = useAccount();
  const [mode, setMode] = useState<Mode>(picked ?? account.profile?.mode ?? "osu");
  const current = picked ?? mode ?? account.profile?.mode ?? "osu";
  return [
    current,
    (next) => {
      picked = next;
      setMode(next);
    },
  ];
}

export function ModeSwitch(props: { value: Mode; onChange: (mode: Mode) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mode-switch" role="tablist" aria-label={t.modeSwitch}>
      {MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={props.value === item.id}
          className={props.value === item.id ? "is-on" : undefined}
          disabled={props.disabled}
          onClick={() => props.value !== item.id && props.onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
