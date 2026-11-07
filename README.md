# PP map

Outil local pour connaître le PP d'une beatmap osu!. Colle un lien ou un ID de difficulté, choisis les mods, et lis la courbe full combo ainsi qu'un score simulé. Le calcul tourne sur ta machine avec [rosu-pp](https://github.com/MaxOhn/rosu-pp) 4.0.1, calé sur le modèle lazer d'avril 2026, pour osu!, taiko, catch et mania.

osu! a ajouté le skill Reading le 3 juillet 2026. rosu-pp 4.0.1, et les bases publiques précalculées qui s'appuient dessus, ne l'incluent pas encore. Il n'existe pas de base officielle du PP actuel : l'API osu! ne publie pas le PP d'une map, seulement celui des scores. Sur Power of the Dragonflame [Uri's Extreme], un SS sans mod vaut environ 599 pp ici et environ 550 pp dans lazer.

## Lancer

Il faut Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Ouvre http://localhost:5173

Les tests :

```bash
npm test
```

## Clé API osu!

Un lien, un ID, la recherche par titre et les maps à farm fonctionnent sans clé. Une clé officielle est optionnelle : elle sert de source en plus du catalogue public.

1. Connecte-toi sur osu!.
2. Ouvre https://osu.ppy.sh/home/account/edit#oauth
3. Crée une application OAuth. Le nom est libre. L'URL de callback peut être `http://localhost:5173` (elle n'est pas utilisée : l'outil se connecte en client credentials, scope `public`).
4. Copie `.env.example` vers `.env` à la racine du projet.
5. Colle `OSU_CLIENT_ID` et `OSU_CLIENT_SECRET`.
6. Relance `npm run dev`.

Le secret reste dans le serveur. La page web ne le voit pas.

## Ce que fait la page

- Champ unique : lien `https://osu.ppy.sh/beatmapsets/…#osu/…`, lien `/b/`, ID de difficulté, ou titre. `/` place le curseur dans le champ.
- **Maps à farm** : fourchette de PP (SS avec les mods choisis), type, mods, mot-clé. Les résultats se mettent à jour à chaque changement de filtre et la liste se charge au défilement. Le tri par défaut, « Farm d'abord », met en tête le PP le moins cher.
- **Types** (osu! standard) : jump, stream, speed, tech, alt, finger control. Le type est mesuré dans le `.osu` de chaque map (voir plus bas). Une map peut avoir deux types, par exemple jump et speed.
- Les mods incompatibles se coupent tout seuls (EZ/HR, DT/HT). NC remplace DT.
- Le curseur de vitesse n'apparaît qu'avec DT, NC ou HT. La vitesse par défaut du mod n'est pas appliquée une seconde fois.
- Courbe full combo à 100, 99, 98, 97 et 95 %. Un clic copie le PP.
- Score simulé : précision, combo, misses. Combo vide = combo max. Au-dessus du max, le combo est ramené avec un avertissement. 100 % avec des misses est refusé.
- Les maps récentes et les réglages de recherche restent dans le navigateur. L'URL `#/osu/b/456` rouvre la difficulté (l'ancien `?b=456` marche encore).

Le PP affiché est celui d'un score sur cette difficulté. Sur une map loved, en attente, abandonnée ou brouillon, il ne s'ajoute pas au profil.

## Comment le type est détecté

Les tags et la densité ne suffisent pas : Blue Zenith (jumps en 1/2) et Ascension to Heaven (streams) ont tous les deux environ 2,1 notes par temps et 87 % de cercles. Le serveur lit donc les hit objects (`server/src/patterns.ts`) :

- chaînes en 1/4 (bursts de 3 à 8 notes, streams de 9 et plus, stream le plus long, espacement) ;
- déplacements en 1/2 et 1/1 de plus de 3 rayons de cercle (jumps), et ceux tapés en moins de 125 ms (speed) ;
- rythmes hors grille 1/4 (1/3, 1/6…), entropie rythmique, part de sliders, changements de SV par minute ;
- maps timées à BPM moitié ou double (streams en 1/8 à 100 BPM, 1/2 à 360 BPM) ramenées à leur BPM ressenti.

`shared/src/styles.ts` transforme ces mesures en un score de 0 à 1 par type. Chaque map n'est lue qu'une fois : le profil est gardé dans `cache/patterns-v3.json`. Quand une recherche tombe sur des maps pas encore lues, le serveur lit d'abord celles qui seraient affichées (3,5 s maximum), répond, puis continue en arrière-plan. La page se rafraîchit seule tant que l'analyse tourne.

## Score farm

`shared/src/farm.ts`, de 0 à 100 :

- 35 % adéquation au type : jump par défaut, ou le type choisi ;
- 25 % durée de drain : idéal entre 45 s et 2 min 10 ;
- 25 % efficacité : plus de PP que les étoiles et la durée ne le laissent attendre, comparé aux autres maps de la recherche ;
- 15 % indices : TV Size, Cut Ver., mappeurs connus pour le farm, tag `farm`.

## Cache

- `cache/pp-bands/` : le catalogue PP en tranches de 25 pp (24 h). Deux fourchettes qui se recouvrent réutilisent les mêmes tranches. Au-delà de 600 pp de large, seule la partie haute est chargée et la page le signale.
- `cache/patterns-v3.json` : les profils de patterns.
- `cache/osu/` : les `.osu` des maps ouvertes.

L'ancien dossier `cache/pp-index/` est supprimé au démarrage.
