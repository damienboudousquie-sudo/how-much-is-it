import { CREATOR_PROFILE } from "./Feedback";
import { useI18n } from "./i18n";

const UPDATED = "2026-11-10";

/**
 * Legal notice (French LCEN, non-professional publisher who stays anonymous: only the host is
 * named, the host has the publisher's identity) and privacy notice. French for French, English
 * for every other language.
 */
export function LegalPage() {
  const { lang } = useI18n();
  return <section className="panel legal-page">{lang === "fr" ? <French /> : <English />}</section>;
}

function Host() {
  return (
    <address>
      netcup GmbH
      <br />
      Emmy-Noether-Straße 10, 76131 Karlsruhe, Allemagne / Germany
      <br />
      +49 721 7540755-0 · mail@netcup.de ·{" "}
      <a href="https://www.netcup.com" target="_blank" rel="noreferrer">
        netcup.com
      </a>
    </address>
  );
}

function Profile({ label }: { label: string }) {
  return (
    <a href={CREATOR_PROFILE} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

function French() {
  return (
    <>
      <h2>Mentions légales et confidentialité</h2>
      <p className="legal-updated">Mis à jour le 10 novembre 2026</p>

      <h3>Éditeur</h3>
      <p>
        how-much-is-it.com est un site personnel, gratuit et sans publicité, édité à titre non professionnel par TYROOOO (pseudo osu!). Comme le permet l'article 1-1, II de la loi
        n° 2004-575 du 21 juin 2004 (LCEN), l'éditeur a choisi de rester anonyme ; ses coordonnées ont été communiquées à l'hébergeur.
      </p>
      <p>
        Contact : <Profile label="profil osu! de TYROOOO" /> ou le bouton « Donne ton avis » du site.
      </p>

      <h3>Hébergeur</h3>
      <Host />
      <p>Le trafic passe par Cloudflare, Inc. (réseau de diffusion et protection), qui indique aussi le pays du visiteur.</p>

      <h3>Site non officiel</h3>
      <p>
        Site non officiel, sans lien avec osu! ni ppy Pty Ltd. « osu! » est une marque de ppy Pty Ltd. Les maps, images, musiques et aperçus restent la propriété de leurs
        artistes et mappeurs ; les données viennent de l'API publique osu!. Les valeurs de pp sont calculées avec rosu-pp et sont des estimations.
      </p>
      <p>Un ayant droit qui souhaite le retrait d'un contenu peut écrire via le contact ci-dessus : il sera retiré rapidement.</p>

      <h3>Cookies</h3>
      <ul>
        <li>Aucun cookie publicitaire, de pistage ou de mesure d'audience.</li>
        <li>
          Un seul cookie, <code>hmi_session</code>, et seulement si tu te connectes avec osu! : il te garde connecté (60 jours au plus) et est supprimé à la déconnexion. Il est
          nécessaire au service, donc sans bandeau de consentement.
        </li>
        <li>
          Le navigateur garde aussi tes réglages (langue, volume, taille du lecteur, filtres, recherches récentes, maps épinglées hors connexion). Ils restent sur ton
          appareil et ne sont jamais envoyés pour des statistiques.
        </li>
      </ul>

      <h3>Statistiques de visite</h3>
      <ul>
        <li>Mesure faite par le site lui-même, sans service tiers (pas de Google Analytics).</li>
        <li>
          Ton adresse IP n'est jamais enregistrée. Pour compter les visiteurs d'une journée, l'IP et le navigateur sont mélangés à une clé qui change chaque jour (empreinte
          non réversible) ; la clé de la veille est effacée, donc personne ne peut être suivi d'un jour à l'autre.
        </li>
        <li>
          Ce qui est compté : pages vues, durée de visite, pays (donné par Cloudflare), langue, type d'appareil, navigateur, système, largeur d'écran, site d'où tu viens et
          fonctions utilisées (recherche, aperçu audio, lecteur…). Seulement des totaux par jour.
        </li>
        <li>Le serveur ne garde pas de journal d'accès avec les adresses IP.</li>
      </ul>

      <h3>Connexion avec osu!</h3>
      <ul>
        <li>La connexion passe par osu! (OAuth) : le site ne voit jamais ton mot de passe et ne demande que la lecture de ton profil public.</li>
        <li>
          Sont conservés : ton id et ton pseudo osu!, ton profil public et tes meilleurs scores (pour « Maps for you »), tes maps épinglées ou marquées, et les jetons de
          connexion fournis par osu!.
        </li>
        <li>Les jetons sont supprimés à la déconnexion ; tu peux aussi révoquer l'accès à tout moment dans les paramètres de ton compte osu! (OAuth).</li>
      </ul>

      <h3>Avis envoyés</h3>
      <p>Le message, le contact si tu en donnes un, la page, la langue et ton pseudo si tu es connecté. Seul l'éditeur peut les lire.</p>

      <h3>Tes droits</h3>
      <p>
        Tu peux demander l'accès à tes données ou leur suppression via le contact ci-dessus. Tu peux aussi saisir la CNIL (
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer">
          cnil.fr
        </a>
        ). Aucune donnée n'est vendue ni partagée.
      </p>
    </>
  );
}

function English() {
  return (
    <>
      <h2>Legal notice & privacy</h2>
      <p className="legal-updated">Updated {UPDATED}</p>

      <h3>Publisher</h3>
      <p>
        how-much-is-it.com is a free, ad-free personal site run on a non-professional basis by TYROOOO (osu! username). As French law allows (LCEN, article 1-1, II), the
        publisher stays anonymous; their identity has been given to the host.
      </p>
      <p>
        Contact: <Profile label="TYROOOO's osu! profile" /> or the site's "Give feedback" button.
      </p>

      <h3>Host</h3>
      <Host />
      <p>Traffic goes through Cloudflare, Inc. (delivery network and protection), which also tells the visitor's country.</p>

      <h3>Unofficial site</h3>
      <p>
        Unofficial site, not affiliated with osu! or ppy Pty Ltd. "osu!" is a trademark of ppy Pty Ltd. Maps, images, music and previews belong to their artists and mappers;
        data comes from the public osu! API. PP values are computed with rosu-pp and are estimates.
      </p>
      <p>Rights holders who want content removed can write through the contact above: it will be taken down quickly.</p>

      <h3>Cookies</h3>
      <ul>
        <li>No advertising, tracking or analytics cookies.</li>
        <li>
          One cookie only, <code>hmi_session</code>, and only if you sign in with osu!: it keeps you signed in (60 days at most) and is removed when you sign out. It is
          needed for the service, so no consent banner.
        </li>
        <li>
          Your browser also keeps your settings (language, volume, player size, filters, recent searches, maps pinned while signed out). They stay on your device and are
          never sent for statistics.
        </li>
      </ul>

      <h3>Visit statistics</h3>
      <ul>
        <li>Measured by the site itself, no third-party service (no Google Analytics).</li>
        <li>
          Your IP address is never stored. To count a day's visitors, the IP and browser are mixed with a key that changes every day (a one-way hash); yesterday's key is
          deleted, so nobody can be followed from one day to the next.
        </li>
        <li>
          Counted: page views, visit length, country (from Cloudflare), language, device type, browser, system, screen width, the site you came from, and features used
          (search, audio preview, player…). Daily totals only.
        </li>
        <li>The server keeps no access log with IP addresses.</li>
      </ul>

      <h3>Signing in with osu!</h3>
      <ul>
        <li>Sign-in goes through osu! (OAuth): the site never sees your password and only asks to read your public profile.</li>
        <li>Kept: your osu! id and username, your public profile and top plays (for "Maps for you"), your pinned or marked maps, and the sign-in tokens osu! provides.</li>
        <li>Tokens are deleted when you sign out; you can also revoke access at any time in your osu! account settings (OAuth).</li>
      </ul>

      <h3>Feedback</h3>
      <p>The message, your contact if you give one, the page, the language and your username if signed in. Only the publisher can read it.</p>

      <h3>Your rights</h3>
      <p>
        You can ask for access to your data or its deletion through the contact above, or complain to the French data protection authority (
        <a href="https://www.cnil.fr" target="_blank" rel="noreferrer">
          cnil.fr
        </a>
        ). No data is sold or shared.
      </p>
    </>
  );
}
