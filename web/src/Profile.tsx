import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { MapStyle, ProfileChoke, ProfileInsights } from "@osu-pp/shared";
import { useAccount } from "./account";
import { fetchProfile } from "./api";
import { ModBadges, StarPill } from "./Badges";
import { fill, useI18n } from "./i18n";
import { tierOf } from "./Recommend";
import { trackEvent } from "./track";

/**
 * "My profile": a player card (skills radar, map types, mods) that can be saved as an
 * image, and "if I had FC'd": every choke of the top 100 played as a full combo.
 */

const TIER_COLOR: Record<string, [string, string]> = {
  iron: ["#bab3ab", "#5d5650"],
  bronze: ["#d6a26b", "#6b4521"],
  silver: ["#dfe4ea", "#6f7a86"],
  gold: ["#f0c95c", "#8a6512"],
  platinum: ["#8fd8e8", "#2f7484"],
  rhodium: ["#c7e8e3", "#4f8a80"],
  radiant: ["#a7f0ff", "#5a63ff"],
  lustrous: ["#ffe58c", "#ff6fb1"],
};

const STYLE_COLOR: Record<string, string> = {
  jump: "#ff66b3",
  stream: "#66ccff",
  hybrid: "#ff8c7a",
  speed: "#ffad4d",
  tech: "#b28cff",
  alt: "#4fe0bd",
  fingercontrol: "#f2df5e",
};

const SKILLS = ["aim", "speed", "accuracy", "reading"] as const;
type Skill = (typeof SKILLS)[number];

let kept: { player: number; data: ProfileInsights } | null = null;

/** A number that counts up to its value when it appears. */
function useCountUp(target: number, ms = 1400, start = 0): number {
  const [value, setValue] = useState(start);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(target);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / ms);
      const eased = 1 - (1 - progress) ** 4;
      setValue(start + (target - start) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms, start]);
  return value;
}

/** Each skill as its share of the strongest one (the shape is what tells a player apart). */
function skillShape(skills: ProfileInsights["skills"]): Record<Skill, number> {
  const top = Math.max(1, ...SKILLS.map((skill) => skills[skill]));
  return Object.fromEntries(SKILLS.map((skill) => [skill, Math.max(0.08, skills[skill] / top)])) as Record<Skill, number>;
}

function radarPoint(index: number, radius: number, cx: number, cy: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / SKILLS.length;
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function Radar(props: { skills: ProfileInsights["skills"]; color: string; labels: Record<Skill, string> }) {
  const { lang } = useI18n();
  const shape = skillShape(props.skills);
  const size = 260;
  const c = size / 2;
  const r = 92;
  const polygon = SKILLS.map((skill, index) => radarPoint(index, r * shape[skill], c, c).join(",")).join(" ");
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={SKILLS.map((skill) => `${props.labels[skill]} ${props.skills[skill]}`).join(", ")}>
      <defs>
        <radialGradient id="radar-fill" cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor={props.color} stopOpacity="0.15" />
          <stop offset="100%" stopColor={props.color} stopOpacity="0.55" />
        </radialGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} className="radar-ring" points={SKILLS.map((_, index) => radarPoint(index, r * ring, c, c).join(",")).join(" ")} />
      ))}
      {SKILLS.map((skill, index) => {
        const [x, y] = radarPoint(index, r, c, c);
        return <line key={skill} className="radar-axis" x1={c} y1={c} x2={x} y2={y} />;
      })}
      <g className="radar-shape" style={{ transformOrigin: `${c}px ${c}px` }}>
        <polygon points={polygon} fill="url(#radar-fill)" stroke={props.color} strokeWidth="2.5" strokeLinejoin="round" />
        {SKILLS.map((skill, index) => {
          const [x, y] = radarPoint(index, r * shape[skill], c, c);
          return <circle key={skill} cx={x} cy={y} r="4.5" fill="#fff" stroke={props.color} strokeWidth="2.5" />;
        })}
      </g>
      {SKILLS.map((skill, index) => {
        const [x, y] = radarPoint(index, r + 28, c, c);
        return (
          <g key={skill} className="radar-label">
            <text x={x} y={y - 6} textAnchor="middle">
              {props.labels[skill]}
            </text>
            <text x={x} y={y + 11} textAnchor="middle" className="radar-value">
              {Math.round(props.skills[skill]).toLocaleString(lang)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function StyleBar(props: { styles: ProfileInsights["styles"]; names: (style: string) => string }) {
  if (props.styles.length === 0) return null;
  return (
    <div className="style-mix">
      <div className="style-bar">
        {props.styles.map((item) => (
          <span key={item.style} style={{ flexGrow: item.share, background: STYLE_COLOR[item.style] ?? "#999" }} title={`${props.names(item.style)} ${Math.round(item.share * 100)} %`} />
        ))}
      </div>
      <div className="style-legend">
        {props.styles.map((item) => (
          <span key={item.style}>
            <i style={{ background: STYLE_COLOR[item.style] ?? "#999" }} />
            {props.names(item.style)} <b>{Math.round(item.share * 100)} %</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function duration(seconds: number | null): string {
  if (!seconds) return "—";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ---------- PNG export ---------- */

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawCard(data: ProfileInsights, userId: number, labels: Record<Skill, string>, text: { styles: (s: string) => string; ifFc: string; mods: string; acc: string; site: string; nm: string }, lang: string): Promise<Blob | null> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const tier = tierOf(data.rank);
  const [light, deep] = TIER_COLOR[tier];
  const font = getComputedStyle(document.body).fontFamily;
  const num = (value: number) => Math.round(value).toLocaleString(lang);

  // Background: dark base, two tier-coloured glows, fine diagonal lines.
  ctx.fillStyle = "#120d10";
  ctx.fillRect(0, 0, W, H);
  const glow = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  };
  glow(180, 120, 520, deep, 0.75);
  glow(1050, 560, 520, "#ff66b3", 0.35);
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let x = -H; x < W; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  roundRect(ctx, 20, 20, W - 40, H - 40, 28);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Avatar.
  const avatar = await loadImage(`/api/avatar/${userId}`);
  ctx.save();
  roundRect(ctx, 64, 64, 150, 150, 32);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, 64, 64, 150, 150);
  else {
    ctx.fillStyle = "#2f272b";
    ctx.fillRect(64, 64, 150, 150);
  }
  ctx.restore();
  roundRect(ctx, 64, 64, 150, 150, 32);
  ctx.strokeStyle = light;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = `800 58px ${font}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(data.username, 244, 128, 560);
  ctx.font = `600 22px ${font}`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(`${data.country ?? ""}${data.countryRank ? `  ·  #${num(data.countryRank)}` : ""}  ·  ${tier.toUpperCase()}`, 246, 166);

  // Rank and pp.
  const rankGrad = ctx.createLinearGradient(244, 180, 640, 240);
  rankGrad.addColorStop(0, light);
  rankGrad.addColorStop(1, "#fff");
  ctx.fillStyle = rankGrad;
  ctx.font = `900 64px ${font}`;
  ctx.fillText(data.rank ? `#${num(data.rank)}` : "—", 244, 246);
  const rankWidth = ctx.measureText(data.rank ? `#${num(data.rank)}` : "—").width;
  ctx.fillStyle = "#ff99cc";
  ctx.font = `800 40px ${font}`;
  ctx.fillText(`${num(data.pp)}pp`, 244 + rankWidth + 28, 244);

  // Stat chips.
  let chipX = 64;
  const chip = (label: string, value: string) => {
    ctx.font = `700 18px ${font}`;
    const lw = ctx.measureText(label).width;
    ctx.font = `800 24px ${font}`;
    const vw = ctx.measureText(value).width;
    const w = Math.max(lw, vw) + 40;
    roundRect(ctx, chipX, 290, w, 78, 16);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `700 18px ${font}`;
    ctx.fillText(label, chipX + 20, 320);
    ctx.fillStyle = "#fff";
    ctx.font = `800 24px ${font}`;
    ctx.fillText(value, chipX + 20, 352);
    chipX += w + 14;
  };
  if (data.averageAccuracy != null) chip(text.acc, `${data.averageAccuracy.toFixed(2)} %`);
  chip(text.mods, data.mods.slice(0, 2).map((item) => (item.mods === "NM" ? text.nm : item.mods)).join(" · ") || text.nm);
  if (data.ifFc.chokes.length) chip(text.ifFc, `${num(data.ifFc.pp)}pp`);

  // Style mix bar.
  let barX = 64;
  const barW = 640;
  for (const item of data.styles) {
    const w = barW * item.share;
    ctx.fillStyle = STYLE_COLOR[item.style] ?? "#999";
    roundRect(ctx, barX, 410, Math.max(2, w - 4), 16, 8);
    ctx.fill();
    barX += w;
  }
  let legendX = 64;
  ctx.font = `700 20px ${font}`;
  for (const item of data.styles.slice(0, 4)) {
    const label = `${text.styles(item.style)} ${Math.round(item.share * 100)}%`;
    ctx.fillStyle = STYLE_COLOR[item.style] ?? "#999";
    ctx.beginPath();
    ctx.arc(legendX + 7, 457, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(label, legendX + 22, 464);
    legendX += ctx.measureText(label).width + 52;
  }

  // Radar.
  const shape = skillShape(data.skills);
  const cx = 925;
  const cy = 300;
  const r = 140;
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1.5;
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    SKILLS.forEach((_, index) => {
      const [x, y] = radarPoint(index, r * ring, cx, cy);
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  ctx.beginPath();
  SKILLS.forEach((skill, index) => {
    const [x, y] = radarPoint(index, r * shape[skill], cx, cy);
    if (index) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  fillGrad.addColorStop(0, `${light}33`);
  fillGrad.addColorStop(1, `${light}99`);
  ctx.fillStyle = fillGrad;
  ctx.fill();
  ctx.strokeStyle = light;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.textAlign = "center";
  SKILLS.forEach((skill, index) => {
    const [px, py] = radarPoint(index, r * shape[skill], cx, cy);
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    const [x, y] = radarPoint(index, r + 46, cx, cy);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `700 19px ${font}`;
    ctx.fillText(labels[skill].toUpperCase(), x, y - 4);
    ctx.fillStyle = "#fff";
    ctx.font = `800 24px ${font}`;
    ctx.fillText(num(data.skills[skill]), x, y + 22);
  });
  ctx.textAlign = "left";

  // Footer.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.font = `700 20px ${font}`;
  ctx.fillText(text.site, 64, 572);
  if (data.topPlay) {
    ctx.textAlign = "right";
    ctx.fillText(`★ ${data.topPlay.title} [${data.topPlay.version}] · ${num(data.topPlay.pp)}pp`, W - 64, 572, 700);
    ctx.textAlign = "left";
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/* ---------- page ---------- */

function ChokeRow(props: { choke: ProfileChoke; scale: number; onOpen: (choke: ProfileChoke) => void; index: number }) {
  const { t, lang } = useI18n();
  const { choke } = props;
  const gain = choke.fcPp - choke.pp;
  return (
    <button type="button" className="choke" style={{ animationDelay: `${Math.min(props.index, 12) * 45}ms` }} onClick={() => props.onOpen(choke)}>
      {choke.setId && <span className="choke-cover" style={{ backgroundImage: `url(https://assets.ppy.sh/beatmaps/${choke.setId}/covers/card.jpg)` }} />}
      <span className="choke-main">
        <span className="choke-title">
          {choke.title}
          <small>
            {choke.artist && `${choke.artist} · `}[{choke.version}]
          </small>
        </span>
        <span className="choke-tags">
          {choke.stars != null && <StarPill stars={choke.stars} />}
          <ModBadges mods={choke.mods} nm={t.nm} />
          {choke.accuracy != null && <span className="choke-chip">{choke.accuracy.toFixed(2)} %</span>}
          {choke.misses > 0 && <span className="choke-chip is-miss">{fill(t.chokeMisses, { n: choke.misses })}</span>}
          {choke.combo != null && choke.maxCombo != null && (
            <span className="choke-chip">
              {choke.combo.toLocaleString(lang)}/{choke.maxCombo.toLocaleString(lang)}x
            </span>
          )}
        </span>
      </span>
      <span className="choke-bars" aria-hidden="true">
        <span className="bar-fc" style={{ width: `${(choke.fcPp / props.scale) * 100}%` }} />
        <span className="bar-now" style={{ width: `${(choke.pp / props.scale) * 100}%` }} />
      </span>
      <span className="choke-pp">
        <span className="now">{Math.round(choke.pp).toLocaleString(lang)}</span>
        <span className="arrow">→</span>
        <span className="fc">{Math.round(choke.fcPp).toLocaleString(lang)}pp</span>
        <span className="gain">+{Math.round(gain).toLocaleString(lang)}</span>
      </span>
    </button>
  );
}

function IfFc(props: { data: ProfileInsights; onOpen: (choke: ProfileChoke) => void }) {
  const { t, lang } = useI18n();
  const { data } = props;
  const [all, setAll] = useState(false);
  const fcPp = useCountUp(data.ifFc.pp, 1600, data.pp);
  const fcRank = useCountUp(data.ifFc.rank?.rank ?? data.rank ?? 0, 1600, data.rank ?? 0);
  const chokes = data.ifFc.chokes;
  const scale = Math.max(1, ...chokes.map((choke) => choke.fcPp));
  const shown = all ? chokes : chokes.slice(0, 8);
  return (
    <section className="iffc">
      <header className="iffc-head">
        <h2>{t.ifFcTitle}</h2>
        <p>{t.ifFcLead}</p>
      </header>
      {chokes.length === 0 ? (
        <p className="iffc-none">{t.ifFcNone}</p>
      ) : (
        <>
          <div className="iffc-compare">
            <div className="iffc-side">
              <small>{t.ifFcNow}</small>
              <strong>{Math.round(data.pp).toLocaleString(lang)}pp</strong>
              <span>{data.rank ? `#${data.rank.toLocaleString(lang)}` : "—"}</span>
            </div>
            <div className="iffc-arrow" aria-hidden="true">
              <svg viewBox="0 0 64 24">
                <path d="M2 12h56m-10-9 10 9-10 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <b>+{Math.round(data.ifFc.gain).toLocaleString(lang)}pp</b>
            </div>
            <div className="iffc-side is-fc">
              <small>{t.ifFcAfter}</small>
              <strong>{Math.round(fcPp).toLocaleString(lang)}pp</strong>
              <span>
                {data.ifFc.rank ? `${data.ifFc.rank.exact ? "" : "≈"}#${Math.round(fcRank).toLocaleString(lang)}` : "—"}
                {data.rank && data.ifFc.rank && data.ifFc.rank.rank < data.rank && <em>▲ {(data.rank - data.ifFc.rank.rank).toLocaleString(lang)}</em>}
              </span>
            </div>
          </div>
          <p className="iffc-lost">{fill(t.ifFcLost, { pp: Math.round(data.ifFc.lost).toLocaleString(lang), n: chokes.length })}</p>
          <div className="chokes">
            {shown.map((choke, index) => (
              <ChokeRow key={`${choke.beatmapId}-${choke.mods.join("")}`} choke={choke} scale={scale} index={index} onOpen={props.onOpen} />
            ))}
          </div>
          {chokes.length > 8 && (
            <button type="button" className="chokes-more" onClick={() => setAll((value) => !value)}>
              {all ? t.showLess : fill(t.showAllChokes, { n: chokes.length })}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function HeroCard(props: { data: ProfileInsights; userId: number }) {
  const { t, lang } = useI18n();
  const { data } = props;
  const tier = tierOf(data.rank);
  const [light, deep] = TIER_COLOR[tier];
  const pp = useCountUp(data.pp, 1200);
  const [saving, setSaving] = useState(false);
  const labels: Record<Skill, string> = { aim: t.skillAim, speed: t.skillSpeed, accuracy: t.skillAccuracy, reading: t.skillReading };
  const styleName = (style: string) => t.styles[style as MapStyle] ?? style;
  const country = data.country?.toUpperCase() ?? null;
  let countryName = country ?? "";
  try {
    if (country) countryName = new Intl.DisplayNames([lang], { type: "region" }).of(country) ?? country;
  } catch {
    // Keep the code.
  }
  const strongest = SKILLS.reduce((best, skill) => (data.skills[skill] > data.skills[best] ? skill : best), "aim" as Skill);

  async function save() {
    setSaving(true);
    trackEvent("profile_card_download");
    try {
      const blob = await drawCard(data, props.userId, labels, { styles: styleName, ifFc: t.ifFcTitle, mods: t.cardMods, acc: t.cardAcc, site: "how-much-is-it.com", nm: t.nm }, lang);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${data.username}-osu-card.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`hero-card tier-${tier}`} style={{ "--tier": light, "--tier-deep": deep } as CSSProperties}>
      {data.avatarUrl && <span className="hero-backdrop" style={{ backgroundImage: `url(${data.avatarUrl})` }} />}
      <span className="hero-grain" />
      <div className="hero-left">
        <div className="hero-id">
          {data.avatarUrl && <img className="hero-avatar" src={data.avatarUrl} alt="" width={112} height={112} />}
          <div>
            <h1 className="hero-name">{data.username}</h1>
            <div className="hero-country">
              {country && <img src={`https://flagcdn.com/w40/${country.toLowerCase()}.png`} alt="" width={22} height={16} />}
              {countryName}
              {data.countryRank != null && <b>#{data.countryRank.toLocaleString(lang)}</b>}
              <span className="hero-tier">{tier}</span>
            </div>
          </div>
        </div>
        <div className="hero-rank">
          <span className="rank">{data.rank ? `#${data.rank.toLocaleString(lang)}` : "—"}</span>
          <span className="pp">
            {Math.round(pp).toLocaleString(lang)}
            <small>pp</small>
          </span>
        </div>
        <div className="hero-chips">
          {data.averageAccuracy != null && (
            <span>
              <small>{t.cardAcc}</small>
              {data.averageAccuracy.toFixed(2)} %
            </span>
          )}
          <span>
            <small>{t.cardStrongest}</small>
            {labels[strongest]}
          </span>
          <span>
            <small>{t.cardLength}</small>
            {duration(data.medianLength)}
          </span>
          {data.medianBpm != null && (
            <span>
              <small>{t.cardBpm}</small>
              {Math.round(data.medianBpm)}
            </span>
          )}
        </div>
        <div className="hero-block">
          <small>{t.cardStyles}</small>
          <StyleBar styles={data.styles} names={styleName} />
        </div>
        <div className="hero-block">
          <small>{t.cardMods}</small>
          <div className="hero-mods">
            {data.mods.map((item) => (
              <span key={item.mods} className="hero-mod">
                <ModBadges mods={item.mods === "NM" ? [] : item.mods.match(/../g) ?? []} nm={t.nm} />
                <b>{Math.round(item.share * 100)} %</b>
              </span>
            ))}
          </div>
        </div>
        {data.topPlay && (
          <div className="hero-top">
            <small>{t.cardTopPlay}</small>
            <span>
              {data.topPlay.title} <em>[{data.topPlay.version}]</em>
            </span>
            <b>{Math.round(data.topPlay.pp).toLocaleString(lang)}pp</b>
          </div>
        )}
      </div>
      <div className="hero-right">
        <Radar skills={data.skills} color={light} labels={labels} />
        <p className="radar-note">{t.radarNote}</p>
        <button type="button" className="hero-save" onClick={() => void save()} disabled={saving}>
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
            <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {saving ? t.cardSaving : t.cardDownload}
        </button>
      </div>
    </section>
  );
}

export function ProfilePage(props: { onOpen: (choke: ProfileChoke) => void }) {
  const { t } = useI18n();
  const account = useAccount();
  const player = account.profile?.id ?? 0;
  const [data, setData] = useState<ProfileInsights | null>(kept && kept.player === player ? kept.data : null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!account.ready || !account.profile || started.current) return;
    started.current = true;
    const controller = new AbortController();
    fetchProfile(controller.signal)
      .then((answer) => {
        kept = { player, data: answer };
        setData(answer);
      })
      .catch((caught) => {
        if (!controller.signal.aborted && !data) setError(caught instanceof Error ? caught.message : t.profileError);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.ready, account.profile]);

  const loadingSteps = useMemo(() => [t.profileLoading1, t.profileLoading2, t.profileLoading3], [t]);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (data) return;
    const timer = window.setInterval(() => setStep((value) => (value + 1) % loadingSteps.length), 1800);
    return () => window.clearInterval(timer);
  }, [data, loadingSteps]);

  if (!account.ready) return null;
  if (!account.profile) {
    return (
      <div className="profile-page">
        <div className="profile-empty">
          <p>{t.profileSignIn}</p>
          <a className="login-osu" href="/api/auth/login">
            {t.login}
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="profile-page">
      {data ? (
        <>
          <HeroCard data={data} userId={player} />
          <IfFc data={data} onOpen={props.onOpen} />
        </>
      ) : error ? (
        <p className="profile-error">{error}</p>
      ) : (
        <div className="profile-loading">
          <div className="hero-card is-skeleton">
            <span className="loader-ring" />
          </div>
          <p key={step}>{loadingSteps[step]}</p>
        </div>
      )}
    </div>
  );
}
