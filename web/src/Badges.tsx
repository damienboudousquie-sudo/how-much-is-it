import { formatStars, starColors } from "./format";

/** Star rating pill coloured with the osu! difficulty spectrum. */
export function StarPill(props: { stars: number }) {
  const colors = starColors(props.stars);
  return (
    <span className="star-pill" style={{ background: colors.background, color: colors.text }}>
      ★ {formatStars(props.stars)}
    </span>
  );
}

export function ModBadges(props: { mods: readonly string[]; nm: string }) {
  if (props.mods.length === 0) return <span className="mod-badge mod-NM">{props.nm}</span>;
  return (
    <>
      {props.mods.map((mod) => (
        <span key={mod} className={`mod-badge mod-${mod}`}>
          {mod}
        </span>
      ))}
    </>
  );
}
