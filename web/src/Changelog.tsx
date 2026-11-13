import { useI18n } from "./i18n";

/**
 * What changed on the site, newest first. The first entry's date is the "Updated" date in
 * the header. French for French, English for every other language.
 */
export const CHANGELOG: { date: string; en: string[]; fr: string[] }[] = [
  {
    date: "2026-11-13",
    en: [
      "Taiko, catch and mania players: your profile, pp, rank and top plays now come from your main mode on osu! (they were always read as osu!standard before, so mania players saw 0 pp).",
      "New game mode switch (osu!, taiko, catch, mania) on My profile and Maps for you.",
      "If I had FC'd now works in every mode, with the rank from that mode's ranking.",
      "Maps for you now works in taiko, catch and mania: your pp range, your mods and maps of a similar length.",
      "The pp gain and new rank on a map page now only show for maps of your mode.",
    ],
    fr: [
      "Joueurs taiko, catch et mania : votre profil, vos pp, votre rang et vos top plays viennent maintenant de votre mode principal sur osu! (avant, tout était lu en osu! standard, d'où 0 pp pour les joueurs mania).",
      "Nouveau choix du mode (osu!, taiko, catch, mania) sur Mon profil et Maps for you.",
      "Si j'avais FC marche maintenant dans tous les modes, avec le rang du classement de ce mode.",
      "Maps for you marche en taiko, catch et mania : votre plage de pp, vos mods et des maps de durée proche.",
      "Le gain de pp et le nouveau rang sur la page d'une map ne s'affichent que pour les maps de votre mode.",
    ],
  },
];

export const LAST_UPDATE = CHANGELOG[0].date;

export function formatDay(date: string, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  } catch {
    return date;
  }
}

export function ChangelogPage() {
  const { t, lang } = useI18n();
  const french = lang === "fr";
  return (
    <section className="panel changelog-page">
      <h1>{t.changelogTitle}</h1>
      {CHANGELOG.map((entry) => (
        <article key={entry.date} className="changelog-entry">
          <h2>
            <time dateTime={entry.date}>{formatDay(entry.date, lang)}</time>
          </h2>
          <ul>
            {(french ? entry.fr : entry.en).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
