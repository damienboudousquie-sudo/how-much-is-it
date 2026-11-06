import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BeatmapStatus, Lang, MapStyle } from "@osu-pp/shared";

export type Copy = {
  heading: string;
  lede: string;
  searchLabel: string;
  see: string;
  recent: string;
  empty: string;
  shortcut: string;
  loading: string;
  stars: string;
  maxCombo: string;
  bpm: string;
  length: string;
  keys: string;
  difficulty: string;
  accuracy: string;
  aim: string;
  speed: string;
  flashlight: string;
  precision: string;
  fullCombo: string;
  simulated: string;
  combo: string;
  misses: string;
  copied: string;
  copyFailed: string;
  comboInteger: string;
  footer: string;
  finderTitle: string;
  ppMin: string;
  ppMax: string;
  keyword: string;
  optional: string;
  mode: string;
  type: string;
  sort: string;
  sortPpDesc: string;
  sortPpAsc: string;
  sortStarsDesc: string;
  sortStarsAsc: string;
  sortLengthDesc: string;
  sortLengthAsc: string;
  modsLegend: string;
  modHelp: string;
  choiceOff: string;
  choiceOn: string;
  choiceAny: string;
  chipOff: string;
  chipOn: string;
  chipAny: string;
  backToMaps: string;
  openOnOsu: string;
  osuDirect: string;
  modOff: string;
  modOn: string;
  modAny: string;
  searchRange: string;
  showingAll: string;
  showingFiltered: string;
  showingKeyword: string;
  showingKeywordRange: string;
  showMore: string;
  searchingMaps: string;
  rangeInvalid: string;
  searchFailed: string;
  scoreLine: string;
  difficulties: string;
  mods: string;
  speedLabel: string;
  noticePreview: string;
  noticeNone: string;
  noticeEmpty: string;
  noticeTooMany: string;
  styleIgnored: string;
  nm: string;
  styles: Record<MapStyle, string>;
  status: Record<BeatmapStatus, string>;
  profileLoved: string;
  profileQualified: string;
};

const en: Copy = {
  heading: "how much is it",
  lede: "Paste a link for a map's PP, or a range and a type to search.",
  searchLabel: "Link, difficulty id, or title",
  see: "Open",
  recent: "Recent",
  empty: "Paste a beatmap link, a difficulty id, or search a title.",
  shortcut: "Press / to focus the search.",
  loading: "Loading the beatmap…",
  stars: "Stars",
  maxCombo: "Max combo",
  bpm: "BPM",
  length: "Length",
  keys: "Keys",
  difficulty: "Difficulty",
  accuracy: "Accuracy",
  aim: "Aim",
  speed: "Speed",
  flashlight: "Flashlight",
  precision: "Accuracy",
  fullCombo: "Full combo",
  simulated: "Simulated score",
  combo: "Combo",
  misses: "Misses",
  copied: "copied",
  copyFailed: "Copy failed.",
  comboInteger: "Combo must be a whole number.",
  footer: "rosu-pp 4.0.1",
  finderTitle: "Find maps",
  ppMin: "PP min",
  ppMax: "PP max",
  keyword: "Title, artist or mapper",
  optional: "optional",
  mode: "Mode",
  type: "Type",
  sort: "Sort",
  sortPpDesc: "PP ↓",
  sortPpAsc: "PP ↑",
  sortStarsDesc: "Star rating ↓",
  sortStarsAsc: "Star rating ↑",
  sortLengthDesc: "Length ↓",
  sortLengthAsc: "Length ↑",
  modsLegend: "Mods for the search",
  modHelp: "Click a mod: without, then required, then either.",
  choiceOff: "Without",
  choiceOn: "Required",
  choiceAny: "Either",
  chipOff: "off",
  chipOn: "must",
  chipAny: "any",
  backToMaps: "Back to maps",
  openOnOsu: "Open this map on osu!",
  osuDirect: "osu!direct",
  modOff: "{mod}: excluded",
  modOn: "{mod}: required",
  modAny: "{mod}: with or without",
  searchRange: "Search this range",
  showingAll: "Showing {shown} of {total} maps in this range.",
  showingFiltered: "{shown} of {total} maps of this type in this PP range.",
  showingKeyword: "{shown} maps match this keyword.",
  showingKeywordRange: "{shown} maps match this keyword in this PP range.",
  showMore: "Show more",
  searchingMaps: "Searching ranked maps…",
  rangeInvalid: "The PP range is invalid.",
  searchFailed: "Search failed.",
  scoreLine: "{accuracy} % · combo {combo} / {max} · {misses} miss",
  difficulties: "Difficulties",
  mods: "Mods",
  speedLabel: "Speed {rate}",
  noticePreview: "SS, full combo, for the mods written on each card.",
  noticeNone: "No ranked map in this range for those mods. Widen the range or change the filters.",
  noticeEmpty: "No ranked map matched this search.",
  noticeTooMany: "Too many mods are set to “with or without”. Leave at most three in that state.",
  styleIgnored: "Map types (jump, stream…) apply to osu! standard.",
  nm: "NM",
  styles: {
    any: "All types",
    jump: "Jump",
    stream: "Stream",
    speed: "Speed",
    tech: "Tech",
    alt: "Alt",
    fingercontrol: "Finger control",
  },
  status: {
    ranked: "ranked",
    approved: "approved",
    qualified: "qualified",
    loved: "loved",
    pending: "pending",
    graveyard: "graveyard",
    wip: "wip",
    unknown: "unknown status",
  },
  profileLoved: "This PP is not added to your profile.",
  profileQualified: "This PP counts only while the map stays qualified.",
};

const fr: Copy = {
  heading: "how much is it",
  lede: "Colle un lien pour le PP d'une map, ou une fourchette et un type pour chercher.",
  searchLabel: "Lien, ID de difficulté ou titre",
  see: "Voir",
  recent: "Récentes",
  empty: "Colle un lien de beatmap, un ID de difficulté, ou cherche un titre.",
  shortcut: "Le raccourci / ramène au champ.",
  loading: "Chargement de la beatmap…",
  stars: "Étoiles",
  maxCombo: "Combo max",
  bpm: "BPM",
  length: "Durée",
  keys: "Touches",
  difficulty: "Difficulté",
  accuracy: "Précision",
  aim: "Aim",
  speed: "Speed",
  flashlight: "Flashlight",
  precision: "Précision",
  fullCombo: "Full combo",
  simulated: "Score simulé",
  combo: "Combo",
  misses: "Misses",
  copied: "copié",
  copyFailed: "La copie a échoué.",
  comboInteger: "Le combo doit être un entier.",
  footer: "rosu-pp 4.0.1",
  finderTitle: "Trouver des maps",
  ppMin: "PP min",
  ppMax: "PP max",
  keyword: "Titre, artiste ou mappeur",
  optional: "optionnel",
  mode: "Mode",
  type: "Type",
  sort: "Tri",
  sortPpDesc: "PP ↓",
  sortPpAsc: "PP ↑",
  sortStarsDesc: "Étoiles ↓",
  sortStarsAsc: "Étoiles ↑",
  sortLengthDesc: "Durée ↓",
  sortLengthAsc: "Durée ↑",
  modsLegend: "Mods de la recherche",
  modHelp: "Clique un mod : sans, puis obligatoire, puis les deux.",
  choiceOff: "Sans",
  choiceOn: "Obligatoire",
  choiceAny: "Les deux",
  chipOff: "sans",
  chipOn: "requis",
  chipAny: "les deux",
  backToMaps: "Retour aux maps",
  openOnOsu: "Ouvrir cette map sur osu!",
  osuDirect: "osu!direct",
  modOff: "{mod} : absent",
  modOn: "{mod} : obligatoire",
  modAny: "{mod} : avec ou sans",
  searchRange: "Chercher dans la fourchette",
  showingAll: "{shown} maps affichées sur {total} dans cette fourchette.",
  showingFiltered: "{shown} maps affichées sur {total} de ce type dans cette fourchette de PP.",
  showingKeyword: "{shown} maps correspondent à ce mot-clé.",
  showingKeywordRange: "{shown} maps correspondent à ce mot-clé dans cette fourchette de PP.",
  showMore: "Afficher plus",
  searchingMaps: "Recherche des maps classées…",
  rangeInvalid: "La fourchette de PP est invalide.",
  searchFailed: "Recherche impossible.",
  scoreLine: "{accuracy} % · combo {combo} / {max} · {misses} miss",
  difficulties: "Difficultés",
  mods: "Mods",
  speedLabel: "Vitesse {rate}",
  noticePreview: "SS, full combo, pour les mods indiqués sur chaque carte.",
  noticeNone: "Aucune map classée dans cette fourchette pour ces mods. Élargis la fourchette ou change les filtres.",
  noticeEmpty: "Aucune map classée ne correspond à cette recherche.",
  noticeTooMany: "Trop de mods sont sur « avec ou sans ». Laisse-en au plus trois dans cet état.",
  styleIgnored: "Les types (jump, stream…) concernent osu! standard.",
  nm: "NM",
  styles: {
    any: "Tous types",
    jump: "Jump",
    stream: "Stream",
    speed: "Speed",
    tech: "Tech",
    alt: "Alt",
    fingercontrol: "Finger control",
  },
  status: {
    ranked: "classée",
    approved: "approuvée",
    qualified: "qualifiée",
    loved: "loved",
    pending: "en attente",
    graveyard: "abandonnée",
    wip: "brouillon",
    unknown: "statut inconnu",
  },
  profileLoved: "Ce PP ne s'ajoute pas au profil.",
  profileQualified: "Ce PP compte temporairement, tant que la map est qualifiée.",
};

const es: Copy = {
  heading: "how much is it",
  lede: "Pega un enlace para el PP de un mapa, o un rango y un tipo para buscar.",
  searchLabel: "Enlace, ID de dificultad o título",
  see: "Abrir",
  recent: "Recientes",
  empty: "Pega un enlace de beatmap, un ID de dificultad o busca un título.",
  shortcut: "Pulsa / para ir al buscador.",
  loading: "Cargando el beatmap…",
  stars: "Estrellas",
  maxCombo: "Combo máx.",
  bpm: "BPM",
  length: "Duración",
  keys: "Teclas",
  difficulty: "Dificultad",
  accuracy: "Precisión",
  aim: "Aim",
  speed: "Speed",
  flashlight: "Flashlight",
  precision: "Precisión",
  fullCombo: "Full combo",
  simulated: "Puntuación simulada",
  combo: "Combo",
  misses: "Misses",
  copied: "copiado",
  copyFailed: "No se pudo copiar.",
  comboInteger: "El combo debe ser un entero.",
  footer: "rosu-pp 4.0.1",
  finderTitle: "Encontrar mapas",
  ppMin: "PP mín.",
  ppMax: "PP máx.",
  keyword: "Título, artista o mapper",
  optional: "opcional",
  mode: "Modo",
  type: "Tipo",
  sort: "Orden",
  sortPpDesc: "PP ↓",
  sortPpAsc: "PP ↑",
  sortStarsDesc: "Estrellas ↓",
  sortStarsAsc: "Estrellas ↑",
  sortLengthDesc: "Duración ↓",
  sortLengthAsc: "Duración ↑",
  modsLegend: "Mods de la búsqueda",
  modHelp: "Pulsa un mod: sin, luego obligatorio, luego ambos.",
  choiceOff: "Sin",
  choiceOn: "Obligatorio",
  choiceAny: "Ambos",
  chipOff: "sin",
  chipOn: "sí",
  chipAny: "ambos",
  backToMaps: "Volver a los mapas",
  openOnOsu: "Abrir este mapa en osu!",
  osuDirect: "osu!direct",
  modOff: "{mod}: ausente",
  modOn: "{mod}: obligatorio",
  modAny: "{mod}: con o sin",
  searchRange: "Buscar en el rango",
  showingAll: "{shown} de {total} mapas en este rango.",
  showingFiltered: "{shown} de {total} mapas de este tipo en este rango de PP.",
  showingKeyword: "{shown} mapas coinciden con esta palabra.",
  showingKeywordRange: "{shown} mapas coinciden con esta palabra en este rango de PP.",
  showMore: "Ver más",
  searchingMaps: "Buscando mapas clasificados…",
  rangeInvalid: "El rango de PP no es válido.",
  searchFailed: "No se pudo buscar.",
  scoreLine: "{accuracy} % · combo {combo} / {max} · {misses} miss",
  difficulties: "Dificultades",
  mods: "Mods",
  speedLabel: "Velocidad {rate}",
  noticePreview: "SS, full combo, para los mods escritos en cada tarjeta.",
  noticeNone: "Ningún mapa clasificado entra en este rango con esos mods. Amplía el rango o cambia los filtros.",
  noticeEmpty: "Ningún mapa clasificado coincide con esta búsqueda.",
  noticeTooMany: "Demasiados mods están en «con o sin». Deja como máximo tres en ese estado.",
  styleIgnored: "Los tipos (jump, stream…) son de osu! standard.",
  nm: "NM",
  styles: {
    any: "Todos los tipos",
    jump: "Jump",
    stream: "Stream",
    speed: "Speed",
    tech: "Tech",
    alt: "Alt",
    fingercontrol: "Finger control",
  },
  status: {
    ranked: "clasificado",
    approved: "aprobado",
    qualified: "calificado",
    loved: "loved",
    pending: "pendiente",
    graveyard: "abandonado",
    wip: "borrador",
    unknown: "estado desconocido",
  },
  profileLoved: "Este PP no se suma al perfil.",
  profileQualified: "Este PP cuenta solo mientras el mapa siga calificado.",
};

const tables: Record<Lang, Copy> = { en, fr, es };
const LANG_KEY = "osu-pp-lookup:lang";

const LangContext = createContext<{ lang: Lang; setLang: (lang: Lang) => void; t: Copy }>({
  lang: "en",
  setLang: () => undefined,
  t: en,
});

function readLang(): Lang {
  const saved = localStorage.getItem(LANG_KEY);
  return saved === "fr" || saved === "es" ? saved : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const value = useMemo(() => ({ lang, setLang: setLangState, t: tables[lang] }), [lang]);
  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
    document.title = "how much is it";
  }, [lang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useI18n() {
  return useContext(LangContext);
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}
