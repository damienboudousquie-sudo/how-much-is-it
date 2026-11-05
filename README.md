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

Un lien, un ID, la recherche par titre et la fourchette de PP fonctionnent sans clé. Une clé officielle est optionnelle : elle sert de source en plus du catalogue public.

1. Connecte-toi sur osu!.
2. Ouvre https://osu.ppy.sh/home/account/edit#oauth
3. Crée une application OAuth. Le nom est libre. L'URL de callback peut être `http://localhost:5173` (elle n'est pas utilisée : l'outil se connecte en client credentials, scope `public`).
4. Copie `.env.example` vers `.env` à la racine du projet.
5. Colle `OSU_CLIENT_ID` et `OSU_CLIENT_SECRET`.
6. Relance `npm run dev`.

Le secret reste dans le serveur. La page web ne le voit pas.

## Ce que fait la page

- Champ unique : lien `https://osu.ppy.sh/beatmapsets/…#osu/…`, lien `/b/`, ID de difficulté, ou titre.
- Fourchette de PP : SS avec les mods choisis, filtrée par mode et, en osu!, par type (aim, aim slop, jump, stream, speed, tech, alt, finger control). Le type est lu dans les tags et le nom de la difficulté. Aim inclut ses sous-types, stream aussi. C'est un aperçu, pas la liste complète des maps classées.
- Les mods incompatibles se coupent tout seuls (EZ/HR, DT/HT). NC remplace DT.
- Le curseur de vitesse n'apparaît qu'avec DT, NC ou HT. La vitesse par défaut du mod n'est pas appliquée une seconde fois.
- Courbe full combo à 100, 99, 98, 97 et 95 %. Un clic copie le PP.
- Score simulé : précision, combo, misses. Combo vide = combo max. Au-dessus du max, le combo est ramené avec un avertissement. 100 % avec des misses est refusé.
- Les maps récentes restent dans le navigateur. L'URL `?b=456` rouvre la difficulté.

Le PP affiché est celui d'un score sur cette difficulté. Sur une map loved, en attente, abandonnée ou brouillon, il ne s'ajoute pas au profil.
