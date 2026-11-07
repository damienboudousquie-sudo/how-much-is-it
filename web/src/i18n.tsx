import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BeatmapStatus, DiscoverSort, Lang, MapStyle } from "@osu-pp/shared";
import { setNumberLocale } from "./format";

export type Copy = {
  searchPlaceholder: string;
  searchHint: string;
  open: string;
  recent: string;
  loading: string;
  backToMaps: string;
  openOnOsu: string;
  osuDirect: string;
  footer: string;
  searchFailed: string;
  network: string;
  copied: string;
  copyFailed: string;

  finderTitle: string;
  finderLede: string;
  range: string;
  ppMin: string;
  ppMax: string;
  type: string;
  typeHelp: Record<MapStyle, string>;
  typeMulti: string;
  mode: string;
  mods: string;
  modHelp: string;
  modState: { off: string; on: string; any: string };
  modAria: { off: string; on: string; any: string };
  keyword: string;
  keywordPlaceholder: string;
  sort: string;
  sorts: Record<DiscoverSort, string>;
  resultsCount: string;
  analyzing: string;
  loadingCatalog: string;
  searching: string;
  estimated: string;
  farm: string;
  farmHelp: string;
  ssNote: string;
  noticeNone: string;
  noticeTooMany: string;
  styleIgnored: string;
  rangeInvalid: string;
  limitedFrom: string;
  showMore: string;
  nm: string;

  stars: string;
  maxCombo: string;
  bpm: string;
  length: string;
  keys: string;
  difficulty: string;
  aim: string;
  speed: string;
  precision: string;
  flashlight: string;
  fullCombo: string;
  copyHint: string;
  simulated: string;
  accuracy: string;
  combo: string;
  misses: string;
  scoreLine: string;
  comboInteger: string;
  ssMisses: string;
  accuracyRange: string;
  difficulties: string;
  speedLabel: string;
  profileLoved: string;
  profileQualified: string;
  mapType: string;
  patternStream: string;
  patternJump: string;
  patternLongest: string;
  patternSliders: string;

  styles: Record<MapStyle, string>;
  status: Record<BeatmapStatus, string>;
};

const en: Copy = {
  searchPlaceholder: "Paste an osu! link, a difficulty id, or type a title",
  searchHint: "Press / to search from anywhere.",
  open: "Open",
  recent: "Recently opened",
  loading: "Loading the beatmap…",
  backToMaps: "Back to maps",
  openOnOsu: "Open on osu!",
  osuDirect: "osu!direct",
  footer: "PP from rosu-pp 4.0.1 (lazer, April 2026). Reading skill not included yet.",
  searchFailed: "Search failed.",
  network: "The server is not responding. Start it with npm run dev.",
  copied: "copied",
  copyFailed: "Copy failed.",

  finderTitle: "Find maps to farm",
  finderLede: "Pick a PP range and a type. The easiest pp comes first.",
  range: "PP range (SS)",
  ppMin: "Min",
  ppMax: "Max",
  type: "Type",
  typeHelp: {
    any: "Every type. Farm order favours short jump maps.",
    jump: "Spaced 1/2 and 1/1 movement, fast DT aim included. The classic farm.",
    stream: "Long 1/4 chains: streams and deathstreams.",
    speed: "Fast streams, about 240 BPM and up (mods counted).",
    tech: "Sliders, SV changes, unusual rhythms.",
    alt: "Short 1/4 bursts mixed in, you have to alternate.",
    fingercontrol: "Uneven rhythms and short chains at moderate BPM.",
  },
  typeMulti: "Pick several to mix them.",
  mode: "Mode",
  mods: "Mods",
  modHelp: "Click to cycle: without → with → either.",
  modState: { off: "without", on: "with", any: "either" },
  modAria: { off: "{mod}: without", on: "{mod}: with", any: "{mod}: with or without" },
  keyword: "Title, artist or mapper",
  keywordPlaceholder: "optional",
  sort: "Sort",
  sorts: {
    farm: "Farm first",
    "pp-desc": "PP, high to low",
    "pp-asc": "PP, low to high",
    "stars-desc": "Stars, high to low",
    "stars-asc": "Stars, low to high",
    "length-desc": "Longest first",
    "length-asc": "Shortest first",
  },
  resultsCount: "{total} maps",
  analyzing: "Reading the patterns of {count} maps…",
  loadingCatalog: "Loading maps in this range: {loaded} / {expected}…",
  searching: "Updating…",
  estimated: "type estimated from tags, still being checked",
  farm: "Farm",
  farmHelp: "Farm score: short drain, aim-friendly, more pp than the stars suggest.",
  ssNote: "SS full combo, with the mods shown on each map.",
  noticeNone: "No ranked map here. Widen the range or change the filters.",
  noticeTooMany: "Too many mods on “either”. Keep three at most.",
  styleIgnored: "Types apply to osu! standard only.",
  rangeInvalid: "Enter a PP range, low to high, between 0 and 2000.",
  limitedFrom: "Wide range: only maps from {pp} pp up are loaded.",
  showMore: "Show more",
  nm: "NM",

  stars: "Stars",
  maxCombo: "Max combo",
  bpm: "BPM",
  length: "Length",
  keys: "Keys",
  difficulty: "Difficulty",
  aim: "Aim",
  speed: "Speed",
  precision: "Accuracy",
  flashlight: "Flashlight",
  fullCombo: "Full combo",
  copyHint: "Click a value to copy it.",
  simulated: "Your score",
  accuracy: "Accuracy %",
  combo: "Combo",
  misses: "Misses",
  scoreLine: "{accuracy} % · combo {combo} / {max} · {misses} miss",
  comboInteger: "Combo must be a whole number.",
  ssMisses: "100% accuracy means no misses.",
  accuracyRange: "Accuracy goes from 0 to 100.",
  difficulties: "Difficulties",
  speedLabel: "Speed {rate}",
  profileLoved: "This PP is not added to your profile.",
  profileQualified: "This PP counts only while the map stays qualified.",
  mapType: "Type",
  patternStream: "{share} in streams",
  patternJump: "{share} jumps",
  patternLongest: "longest stream {count}",
  patternSliders: "{share} sliders",

  styles: { any: "All", jump: "Jump", stream: "Stream", speed: "Speed", tech: "Tech", alt: "Alt", fingercontrol: "Finger control" },
  status: {
    ranked: "Ranked",
    approved: "Approved",
    qualified: "Qualified",
    loved: "Loved",
    pending: "Pending",
    graveyard: "Graveyard",
    wip: "WIP",
    unknown: "Unknown status",
  },
};

const fr: Copy = {
  searchPlaceholder: "Colle un lien osu!, un ID de difficulté, ou tape un titre",
  searchHint: "Appuie sur / pour chercher depuis n'importe où.",
  open: "Voir",
  recent: "Ouvertes récemment",
  loading: "Chargement de la beatmap…",
  backToMaps: "Retour aux maps",
  openOnOsu: "Ouvrir sur osu!",
  osuDirect: "osu!direct",
  footer: "PP calculé avec rosu-pp 4.0.1 (lazer, avril 2026). Le skill Reading n'est pas encore inclus.",
  searchFailed: "Recherche impossible.",
  network: "Le serveur ne répond pas. Lance-le avec npm run dev.",
  copied: "copié",
  copyFailed: "La copie a échoué.",

  finderTitle: "Trouver des maps à farm",
  finderLede: "Choisis une fourchette de PP et un type. Le PP le plus facile sort en premier.",
  range: "Fourchette de PP (SS)",
  ppMin: "Min",
  ppMax: "Max",
  type: "Type",
  typeHelp: {
    any: "Tous les types. Le tri farm favorise les maps jump courtes.",
    jump: "Déplacements espacés en 1/2 et 1/1, aim rapide en DT compris. Le farm classique.",
    stream: "Longues chaînes en 1/4 : streams et deathstreams.",
    speed: "Streams rapides, à partir de 240 BPM environ (mods compris).",
    tech: "Sliders, changements de SV, rythmes inhabituels.",
    alt: "Petits bursts en 1/4 au milieu des patterns, il faut alterner.",
    fingercontrol: "Rythmes irréguliers et chaînes courtes à BPM modéré.",
  },
  typeMulti: "Tu peux en choisir plusieurs.",
  mode: "Mode",
  mods: "Mods",
  modHelp: "Clique pour changer : sans → avec → les deux.",
  modState: { off: "sans", on: "avec", any: "les deux" },
  modAria: { off: "{mod} : sans", on: "{mod} : avec", any: "{mod} : avec ou sans" },
  keyword: "Titre, artiste ou mappeur",
  keywordPlaceholder: "optionnel",
  sort: "Tri",
  sorts: {
    farm: "Farm d'abord",
    "pp-desc": "PP décroissant",
    "pp-asc": "PP croissant",
    "stars-desc": "Étoiles décroissantes",
    "stars-asc": "Étoiles croissantes",
    "length-desc": "Plus longues d'abord",
    "length-asc": "Plus courtes d'abord",
  },
  resultsCount: "{total} maps",
  analyzing: "Lecture des patterns de {count} maps…",
  loadingCatalog: "Chargement des maps de la fourchette : {loaded} / {expected}…",
  searching: "Mise à jour…",
  estimated: "type estimé d'après les tags, vérification en cours",
  farm: "Farm",
  farmHelp: "Score farm : drain court, facile en aim, plus de PP que les étoiles ne le laissent penser.",
  ssNote: "SS full combo, avec les mods indiqués sur chaque map.",
  noticeNone: "Aucune map classée ici. Élargis la fourchette ou change les filtres.",
  noticeTooMany: "Trop de mods sur « les deux ». Garde-en trois au plus.",
  styleIgnored: "Les types ne concernent que osu! standard.",
  rangeInvalid: "Indique une fourchette de PP, du plus bas au plus haut, entre 0 et 2000.",
  limitedFrom: "Fourchette large : seules les maps à partir de {pp} pp sont chargées.",
  showMore: "Afficher plus",
  nm: "NM",

  stars: "Étoiles",
  maxCombo: "Combo max",
  bpm: "BPM",
  length: "Durée",
  keys: "Touches",
  difficulty: "Difficulté",
  aim: "Aim",
  speed: "Speed",
  precision: "Précision",
  flashlight: "Flashlight",
  fullCombo: "Full combo",
  copyHint: "Clique une valeur pour la copier.",
  simulated: "Ton score",
  accuracy: "Précision %",
  combo: "Combo",
  misses: "Misses",
  scoreLine: "{accuracy} % · combo {combo} / {max} · {misses} miss",
  comboInteger: "Le combo doit être un entier.",
  ssMisses: "100 % de précision veut dire aucun miss.",
  accuracyRange: "La précision va de 0 à 100.",
  difficulties: "Difficultés",
  speedLabel: "Vitesse {rate}",
  profileLoved: "Ce PP ne s'ajoute pas au profil.",
  profileQualified: "Ce PP compte temporairement, tant que la map est qualifiée.",
  mapType: "Type",
  patternStream: "{share} en streams",
  patternJump: "{share} de jumps",
  patternLongest: "stream max {count}",
  patternSliders: "{share} de sliders",

  styles: { any: "Tous", jump: "Jump", stream: "Stream", speed: "Speed", tech: "Tech", alt: "Alt", fingercontrol: "Finger control" },
  status: {
    ranked: "Classée",
    approved: "Approuvée",
    qualified: "Qualifiée",
    loved: "Loved",
    pending: "En attente",
    graveyard: "Abandonnée",
    wip: "Brouillon",
    unknown: "Statut inconnu",
  },
};

const es: Copy = {
  searchPlaceholder: "Pega un enlace de osu!, un ID de dificultad o escribe un título",
  searchHint: "Pulsa / para buscar desde cualquier sitio.",
  open: "Abrir",
  recent: "Abiertos hace poco",
  loading: "Cargando el beatmap…",
  backToMaps: "Volver a los mapas",
  openOnOsu: "Abrir en osu!",
  osuDirect: "osu!direct",
  footer: "PP calculado con rosu-pp 4.0.1 (lazer, abril de 2026). El skill Reading aún no está incluido.",
  searchFailed: "No se pudo buscar.",
  network: "El servidor no responde. Inícialo con npm run dev.",
  copied: "copiado",
  copyFailed: "No se pudo copiar.",

  finderTitle: "Encontrar mapas para farmear",
  finderLede: "Elige un rango de PP y un tipo. El PP más fácil sale primero.",
  range: "Rango de PP (SS)",
  ppMin: "Mín.",
  ppMax: "Máx.",
  type: "Tipo",
  typeHelp: {
    any: "Todos los tipos. El orden farm favorece mapas jump cortos.",
    jump: "Movimiento espaciado en 1/2 y 1/1, aim rápido en DT incluido. El farm clásico.",
    stream: "Cadenas largas en 1/4: streams y deathstreams.",
    speed: "Streams rápidos, desde unos 240 BPM (con los mods).",
    tech: "Sliders, cambios de SV, ritmos poco comunes.",
    alt: "Bursts cortos en 1/4 entre patrones, hay que alternar.",
    fingercontrol: "Ritmos irregulares y cadenas cortas a BPM moderado.",
  },
  typeMulti: "Puedes elegir varios.",
  mode: "Modo",
  mods: "Mods",
  modHelp: "Pulsa para cambiar: sin → con → ambos.",
  modState: { off: "sin", on: "con", any: "ambos" },
  modAria: { off: "{mod}: sin", on: "{mod}: con", any: "{mod}: con o sin" },
  keyword: "Título, artista o mapper",
  keywordPlaceholder: "opcional",
  sort: "Orden",
  sorts: {
    farm: "Farm primero",
    "pp-desc": "PP, de mayor a menor",
    "pp-asc": "PP, de menor a mayor",
    "stars-desc": "Estrellas, de más a menos",
    "stars-asc": "Estrellas, de menos a más",
    "length-desc": "Más largos primero",
    "length-asc": "Más cortos primero",
  },
  resultsCount: "{total} mapas",
  analyzing: "Leyendo los patrones de {count} mapas…",
  loadingCatalog: "Cargando los mapas del rango: {loaded} / {expected}…",
  searching: "Actualizando…",
  estimated: "tipo estimado por las etiquetas, en revisión",
  farm: "Farm",
  farmHelp: "Puntuación farm: drain corto, fácil de aim, más PP de lo que sugieren las estrellas.",
  ssNote: "SS full combo, con los mods indicados en cada mapa.",
  noticeNone: "Ningún mapa clasificado aquí. Amplía el rango o cambia los filtros.",
  noticeTooMany: "Demasiados mods en «ambos». Deja tres como máximo.",
  styleIgnored: "Los tipos solo se aplican a osu! standard.",
  rangeInvalid: "Indica un rango de PP, de menor a mayor, entre 0 y 2000.",
  limitedFrom: "Rango amplio: solo se cargan mapas desde {pp} pp.",
  showMore: "Ver más",
  nm: "NM",

  stars: "Estrellas",
  maxCombo: "Combo máx.",
  bpm: "BPM",
  length: "Duración",
  keys: "Teclas",
  difficulty: "Dificultad",
  aim: "Aim",
  speed: "Speed",
  precision: "Precisión",
  flashlight: "Flashlight",
  fullCombo: "Full combo",
  copyHint: "Pulsa un valor para copiarlo.",
  simulated: "Tu puntuación",
  accuracy: "Precisión %",
  combo: "Combo",
  misses: "Misses",
  scoreLine: "{accuracy} % · combo {combo} / {max} · {misses} miss",
  comboInteger: "El combo debe ser un entero.",
  ssMisses: "100 % de precisión significa ningún miss.",
  accuracyRange: "La precisión va de 0 a 100.",
  difficulties: "Dificultades",
  speedLabel: "Velocidad {rate}",
  profileLoved: "Este PP no se suma al perfil.",
  profileQualified: "Este PP cuenta solo mientras el mapa siga calificado.",
  mapType: "Tipo",
  patternStream: "{share} en streams",
  patternJump: "{share} de jumps",
  patternLongest: "stream máx. {count}",
  patternSliders: "{share} de sliders",

  styles: { any: "Todos", jump: "Jump", stream: "Stream", speed: "Speed", tech: "Tech", alt: "Alt", fingercontrol: "Finger control" },
  status: {
    ranked: "Clasificado",
    approved: "Aprobado",
    qualified: "Calificado",
    loved: "Loved",
    pending: "Pendiente",
    graveyard: "Abandonado",
    wip: "Borrador",
    unknown: "Estado desconocido",
  },
};

const tables: Record<Lang, Copy> = { en, fr, es };
export const LANG_KEY = "osu-pp-lookup:lang";

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void; t: Copy }>({
  lang: "en",
  setLang: () => undefined,
  t: en,
});

function readLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "fr" || saved === "es" || saved === "en") return saved;
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  const browser = navigator.language.slice(0, 2);
  return browser === "fr" || browser === "es" ? browser : "en";
}

export function currentLang(): Lang {
  return readLang();
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  setNumberLocale(lang);
  const value = useMemo(() => ({ lang, setLang: setLangState, t: tables[lang] }), [lang]);
  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Not saved; the choice still applies to this visit.
    }
    document.documentElement.lang = lang;
  }, [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useI18n() {
  return useContext(LangContext);
}

export function copyFor(lang: Lang): Copy {
  return tables[lang];
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
