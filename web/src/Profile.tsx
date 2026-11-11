import { useEffect, useMemo, useRef, useState } from "react";
import { PROFILE_SKILLS, type MapStyle, type ProfileChoke, type ProfileInsights, type ProfileSkill } from "@osu-pp/shared";
import { useAccount } from "./account";
import { fetchProfile } from "./api";
import { ModBadges, StarPill } from "./Badges";
import { fill, useI18n } from "./i18n";
import { tierOf } from "./Recommend";
import { trackEvent } from "./track";

/**
 * "My profile": a player card in the spirit of the osu! profile header (banner, avatar,
 * ranks, a skills radar next to the usual player) that can be saved as an image, and
 * "if I had FC'd": the ten chokes worth the most, played as full combos.
 */

const TIER_COLOR: Record<string, string> = {
  iron: "#bab3ab",
  bronze: "#d6a26b",
  silver: "#dfe4ea",
  gold: "#f0c95c",
  platinum: "#8fd8e8",
  rhodium: "#c7e8e3",
  radiant: "#a7f0ff",
  lustrous: "#ffe58c",
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

const PINK = "#ff66b3";
const SKILLS = PROFILE_SKILLS;
type Skill = ProfileSkill;
/** Radar edge: 60 % more weight on a skill than the usual player. */
const RADAR_MAX = 1.6;

let kept: { player: number; data: ProfileInsights } | null = null;

function radius(index: number): number {
  return Math.min(1, Math.max(0.12, index / RADAR_MAX));
}

function radarPoint(index: number, r: number, cx: number, cy: number): [number, number] {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / SKILLS.length;
  return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
}

function Radar(props: { data: ProfileInsights; labels: Record<Skill, string>; average: string }) {
  const { skillIndex } = props.data;
  const size = 320;
  const c = size / 2;
  const r = 96;
  const ring = (scale: number) => SKILLS.map((_, index) => radarPoint(index, r * scale, c, c).join(",")).join(" ");
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={SKILLS.map((skill) => props.labels[skill]).join(", ")}>
      <polygon className="radar-ring" points={ring(1)} />
      <polygon className="radar-ring" points={ring(0.5)} />
      <polygon className="radar-avg" points={ring(1 / RADAR_MAX)}>
        <title>{props.average}</title>
      </polygon>
      {SKILLS.map((skill, index) => {
        const [x, y] = radarPoint(index, r, c, c);
        return <line key={skill} className="radar-axis" x1={c} y1={c} x2={x} y2={y} />;
      })}
      <g className="radar-shape" style={{ transformOrigin: `${c}px ${c}px` }}>
        <polygon points={SKILLS.map((skill, index) => radarPoint(index, r * radius(skillIndex[skill]), c, c).join(",")).join(" ")} />
        {SKILLS.map((skill, index) => {
          const [x, y] = radarPoint(index, r * radius(skillIndex[skill]), c, c);
          return <circle key={skill} cx={x} cy={y} r="3.5" />;
        })}
      </g>
      {SKILLS.map((skill, index) => {
        const [x, y] = radarPoint(index, r + 24, c, c);
        return (
          <text key={skill} x={x} y={y + 4} textAnchor="middle" className="radar-label">
            {props.labels[skill]}
          </text>
        );
      })}
    </svg>
  );
}

function StyleBar(props: { styles: ProfileInsights["styles"]; names: (style: string) => string }) {
  if (props.styles.length === 0) return <span className="pcard-none">—</span>;
  return (
    <div className="style-mix">
      <div className="style-bar">
        {props.styles.map((item) => (
          <span key={item.style} style={{ flexGrow: item.share, background: STYLE_COLOR[item.style] ?? "#999" }} />
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

/** Draws an image like CSS background-size: cover. */
function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

interface CardText {
  labels: Record<Skill, string>;
  styles: (style: string) => string;
  globalRank: string;
  countryRank: string;
  acc: string;
  ifFc: string;
  average: string;
}

async function drawCard(data: ProfileInsights, userId: number, text: CardText, lang: string): Promise<Blob | null> {
  const W = 1200;
  const H = 630;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const tierColor = TIER_COLOR[tierOf(data.rank)];
  const font = getComputedStyle(document.body).fontFamily;
  const num = (value: number) => Math.round(value).toLocaleString(lang);

  ctx.fillStyle = "#1c1719";
  ctx.fillRect(0, 0, W, H);

  // Banner.
  const BANNER = 250;
  const [cover, avatar] = await Promise.all([data.coverUrl ? loadImage("/api/profile/cover") : Promise.resolve(null), loadImage(`/api/avatar/${userId}`)]);
  if (cover) drawCover(ctx, cover, 0, 0, W, BANNER);
  else {
    const g = ctx.createLinearGradient(0, 0, W, BANNER);
    g.addColorStop(0, "#3d3338");
    g.addColorStop(1, "#5a2a45");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, BANNER);
  }
  const fade = ctx.createLinearGradient(0, BANNER * 0.35, 0, BANNER);
  fade.addColorStop(0, "rgba(28,23,25,0.15)");
  fade.addColorStop(1, "rgba(28,23,25,1)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, BANNER);

  // Avatar over the banner edge.
  const AX = 56;
  const AY = 160;
  const AS = 150;
  roundRect(ctx, AX - 6, AY - 6, AS + 12, AS + 12, 30);
  ctx.fillStyle = "#1c1719";
  ctx.fill();
  ctx.save();
  roundRect(ctx, AX, AY, AS, AS, 26);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, AX, AY, AS, AS);
  else {
    ctx.fillStyle = "#3d3338";
    ctx.fillRect(AX, AY, AS, AS);
  }
  ctx.restore();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.font = `800 54px ${font}`;
  ctx.fillText(data.username, AX + AS + 30, 262, 560);
  ctx.fillStyle = "#a3919a";
  ctx.font = `600 22px ${font}`;
  ctx.fillText(data.country ?? "", AX + AS + 32, 298);

  // Figures.
  const figures: [string, string, string][] = [
    [text.globalRank, data.rank ? `#${num(data.rank)}` : "—", tierColor],
    [text.countryRank, data.countryRank ? `#${num(data.countryRank)}` : "—", "#fff"],
    ["pp", num(data.pp), "#fff"],
  ];
  if (data.averageAccuracy != null) figures.push([text.acc, `${data.averageAccuracy.toFixed(2)} %`, "#fff"]);
  let fx = AX;
  for (const [label, value, color] of figures) {
    ctx.fillStyle = "#a3919a";
    ctx.font = `600 19px ${font}`;
    ctx.fillText(label, fx, 380);
    ctx.fillStyle = color;
    ctx.font = `800 40px ${font}`;
    ctx.fillText(value, fx, 424);
    fx += Math.max(ctx.measureText(value).width, 120) + 44;
  }

  // Map types.
  let bx = AX;
  const barW = 600;
  for (const item of data.styles) {
    const w = barW * item.share;
    ctx.fillStyle = STYLE_COLOR[item.style] ?? "#999";
    roundRect(ctx, bx, 476, Math.max(3, w - 4), 12, 6);
    ctx.fill();
    bx += w;
  }
  let lx = AX;
  ctx.font = `700 20px ${font}`;
  for (const item of data.styles.slice(0, 4)) {
    const label = `${text.styles(item.style)} ${Math.round(item.share * 100)} %`;
    ctx.fillStyle = STYLE_COLOR[item.style] ?? "#999";
    ctx.beginPath();
    ctx.arc(lx + 6, 524, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e9e1e5";
    ctx.fillText(label, lx + 20, 531);
    lx += ctx.measureText(label).width + 48;
  }

  // Radar.
  const cx = 975;
  const cy = 390;
  const r = 98;
  const path = (scale: (skill: Skill) => number) => {
    ctx.beginPath();
    SKILLS.forEach((skill, index) => {
      const [x, y] = radarPoint(index, r * scale(skill), cx, cy);
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  };
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1.5;
  path(() => 1);
  ctx.stroke();
  path(() => 0.5);
  ctx.stroke();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  path(() => 1 / RADAR_MAX);
  ctx.stroke();
  ctx.setLineDash([]);
  path((skill) => radius(data.skillIndex[skill]));
  ctx.fillStyle = "rgba(255,102,179,0.3)";
  ctx.fill();
  ctx.strokeStyle = PINK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.textAlign = "center";
  SKILLS.forEach((skill, index) => {
    const [x, y] = radarPoint(index, r + 34, cx, cy);
    ctx.fillStyle = "#e9e1e5";
    ctx.font = `700 19px ${font}`;
    ctx.fillText(text.labels[skill], x, y + 7, 190);
  });
  ctx.textAlign = "left";

  ctx.fillStyle = "#6f6168";
  ctx.font = `700 18px ${font}`;
  ctx.fillText("how-much-is-it.com", AX, 596);
  if (data.ifFc.chokes.length) {
    ctx.textAlign = "right";
    ctx.fillText(`${text.ifFc} · ${num(data.ifFc.pp)}pp`, 740, 596);
    ctx.textAlign = "left";
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/* ---------- page ---------- */

function PlayerCard(props: { data: ProfileInsights; userId: number }) {
  const { t, lang } = useI18n();
  const { data } = props;
  const tierColor = TIER_COLOR[tierOf(data.rank)];
  const [saving, setSaving] = useState(false);
  const labels: Record<Skill, string> = {
    accuracy: t.skillAccuracy,
    aim: t.skillAim,
    reading: t.skillReading,
    precision: t.skillPrecision,
    tapping: t.skillTapping,
    speed: t.skillSpeed,
    fingercontrol: t.skillFingercontrol,
  };
  const styleName = (style: string) => t.styles[style as MapStyle] ?? style;
  const country = data.country?.toUpperCase() ?? null;
  let countryName = country ?? "";
  try {
    if (country) countryName = new Intl.DisplayNames([lang], { type: "region" }).of(country) ?? country;
  } catch {
    // Keep the code.
  }
  const strongest = SKILLS.reduce((best, skill) => (data.skillIndex[skill] > data.skillIndex[best] ? skill : best), "aim" as Skill);
  const number = (value: number) => Math.round(value).toLocaleString(lang);

  async function save() {
    setSaving(true);
    trackEvent("profile_card_download");
    try {
      const blob = await drawCard(
        data,
        props.userId,
        { labels, styles: styleName, globalRank: t.globalRank, countryRank: t.countryRank, acc: t.cardAcc, ifFc: t.ifFcTitle, average: t.radarAverage },
        lang,
      );
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
    <section className="pcard">
      <div className="pcard-banner" style={data.coverUrl ? { backgroundImage: `url(${data.coverUrl})` } : undefined}>
        <button type="button" className="pcard-save" onClick={() => void save()} disabled={saving} title={t.cardDownload}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 3v12m0 0-5-5m5 5 5-5M4 19h16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {saving ? t.cardSaving : t.cardDownload}
        </button>
      </div>
      <div className="pcard-head">
        {data.avatarUrl && <img className="pcard-avatar" src={data.avatarUrl} alt="" width={104} height={104} />}
        <div className="pcard-who">
          <h1>{data.username}</h1>
          {country && (
            <span className="pcard-country">
              <img src={`https://flagcdn.com/w40/${country.toLowerCase()}.png`} alt="" width={20} height={15} />
              {countryName}
            </span>
          )}
        </div>
      </div>
      <dl className="pcard-figures">
        <div>
          <dt>{t.globalRank}</dt>
          <dd style={{ color: tierColor }}>{data.rank ? `#${number(data.rank)}` : "—"}</dd>
        </div>
        <div>
          <dt>{t.countryRank}</dt>
          <dd>{data.countryRank ? `#${number(data.countryRank)}` : "—"}</dd>
        </div>
        <div>
          <dt>pp</dt>
          <dd>{number(data.pp)}</dd>
        </div>
        {data.averageAccuracy != null && (
          <div>
            <dt>{t.cardAcc}</dt>
            <dd>{data.averageAccuracy.toFixed(2)} %</dd>
          </div>
        )}
      </dl>
      <div className="pcard-body">
        <div className="pcard-radar">
          <Radar data={data} labels={labels} average={t.radarAverage} />
          <p>
            {t.cardStrongest} : <b>{labels[strongest]}</b>
          </p>
        </div>
        <div className="pcard-info">
          <div className="pcard-row">
            <span className="pcard-label">{t.cardStyles}</span>
            <StyleBar styles={data.styles} names={styleName} />
          </div>
          <div className="pcard-row">
            <span className="pcard-label">{t.cardMods}</span>
            <div className="pcard-mods">
              {data.mods.map((item) => (
                <span key={item.mods}>
                  <ModBadges mods={item.mods === "NM" ? [] : item.mods.match(/../g) ?? []} nm={t.nm} />
                  <b>{Math.round(item.share * 100)} %</b>
                </span>
              ))}
            </div>
          </div>
          <div className="pcard-row pcard-pair">
            <span>
              <span className="pcard-label">{t.cardLength}</span>
              <b>{duration(data.medianLength)}</b>
            </span>
            <span>
              <span className="pcard-label">{t.cardBpm}</span>
              <b>{data.medianBpm ? Math.round(data.medianBpm) : "—"}</b>
            </span>
          </div>
          {data.topPlay && (
            <div className="pcard-row">
              <span className="pcard-label">{t.cardTopPlay}</span>
              <span className="pcard-top">
                <span>
                  {data.topPlay.title} <em>[{data.topPlay.version}]</em>
                </span>
                <b>{number(data.topPlay.pp)}pp</b>
              </span>
            </div>
          )}
          <p className="pcard-note">{t.radarNote}</p>
        </div>
      </div>
    </section>
  );
}

function ChokeRow(props: { choke: ProfileChoke; place: number; onOpen: (choke: ProfileChoke) => void }) {
  const { t, lang } = useI18n();
  const { choke } = props;
  const number = (value: number) => Math.round(value).toLocaleString(lang);
  return (
    <li>
      <button type="button" className="choke" onClick={() => props.onOpen(choke)}>
        <span className="choke-place">{props.place}</span>
        <span className="choke-thumb" style={choke.setId ? { backgroundImage: `url(https://assets.ppy.sh/beatmaps/${choke.setId}/covers/list.jpg)` } : undefined} />
        <span className="choke-main">
          <span className="choke-title">
            {choke.title} <em>[{choke.version}]</em>
          </span>
          <span className="choke-tags">
            {choke.stars != null && <StarPill stars={choke.stars} />}
            <ModBadges mods={choke.mods} nm={t.nm} />
            {choke.accuracy != null && <span>{choke.accuracy.toFixed(2)} %</span>}
            {choke.misses > 0 && <span className="is-miss">{fill(t.chokeMisses, { n: choke.misses })}</span>}
            {choke.combo != null && choke.maxCombo != null && (
              <span>
                {number(choke.combo)}/{number(choke.maxCombo)}x
              </span>
            )}
          </span>
        </span>
        <span className="choke-pp">
          <span>
            {number(choke.pp)} → <b>{number(choke.fcPp)}pp</b>
          </span>
          <span className="choke-gain" title={t.chokeGainHelp}>
            +{choke.gain.toLocaleString(lang, { maximumFractionDigits: 1 })} pp
          </span>
        </span>
      </button>
    </li>
  );
}

function IfFc(props: { data: ProfileInsights; onOpen: (choke: ProfileChoke) => void }) {
  const { t, lang } = useI18n();
  const { data } = props;
  const chokes = data.ifFc.chokes;
  const number = (value: number) => Math.round(value).toLocaleString(lang);
  const fcRank = data.ifFc.rank;
  return (
    <section className="iffc">
      <h2>{t.ifFcTitle}</h2>
      <p className="iffc-lead">{t.ifFcLead}</p>
      {chokes.length === 0 ? (
        <p className="iffc-none">{t.ifFcNone}</p>
      ) : (
        <>
          <div className="iffc-sum">
            <div>
              <span className="pcard-label">{t.ifFcNow}</span>
              <b>{number(data.pp)}pp</b>
              <span>{data.rank ? `#${number(data.rank)}` : "—"}</span>
            </div>
            <svg className="iffc-arrow" viewBox="0 0 48 16" aria-hidden="true">
              <path d="M2 8h42m-7-6 7 6-7 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="is-fc">
              <span className="pcard-label">{t.ifFcAfter}</span>
              <b>{number(data.ifFc.pp)}pp</b>
              <span>{fcRank ? `${fcRank.exact ? "" : "≈"}#${number(fcRank.rank)}` : "—"}</span>
            </div>
            <div className="iffc-gain">
              <b>+{number(data.ifFc.gain)}pp</b>
              {data.rank && fcRank && fcRank.rank < data.rank && <span>{fill(t.ifFcPlaces, { n: number(data.rank - fcRank.rank) })}</span>}
            </div>
          </div>
          <ol className="chokes">
            {chokes.map((choke, index) => (
              <ChokeRow key={`${choke.beatmapId}-${choke.mods.join("")}`} choke={choke} place={index + 1} onOpen={props.onOpen} />
            ))}
          </ol>
        </>
      )}
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
          <PlayerCard data={data} userId={player} />
          <IfFc data={data} onOpen={props.onOpen} />
        </>
      ) : error ? (
        <p className="profile-error">{error}</p>
      ) : (
        <div className="profile-loading">
          <span className="loader-ring" />
          <p key={step}>{loadingSteps[step]}</p>
        </div>
      )}
    </div>
  );
}
