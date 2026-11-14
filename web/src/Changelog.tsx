import type { Lang } from "@osu-pp/shared";
import { useI18n } from "./i18n";

/**
 * What changed on the site, newest first, in every language of the site (English when a
 * line is missing). The first entry's date is the "Updated" date in the header.
 */
export const CHANGELOG: { date: string; text: Partial<Record<Lang, string[]>> & { en: string[] } }[] = [
  {
    date: "2026-11-14",
    text: {
      en: [
        "Search fix: a title with more than 100 results (like \"REASON\") now finds every map; before, the results past the first 100 were missing.",
        "Newly ranked maps now show up in the lists within a day (it could take several days).",
      ],
      fr: [
        "Correction de la recherche : un titre qui a plus de 100 résultats (comme « REASON ») trouve maintenant toutes les maps ; avant, celles au-delà des 100 premières manquaient.",
        "Les maps tout juste ranked apparaissent dans les listes en moins d'un jour (avant, ça pouvait prendre plusieurs jours).",
      ],
      es: [
        "Búsqueda corregida: un título con más de 100 resultados (como \"REASON\") ahora encuentra todos los mapas; antes faltaban los que pasaban de los 100 primeros.",
        "Los mapas recién rankeados aparecen en las listas en menos de un día (antes podía tardar varios días).",
      ],
      de: [
        "Suche repariert: Ein Titel mit mehr als 100 Treffern (wie \"REASON\") findet jetzt alle Maps; vorher fehlten alle nach den ersten 100.",
        "Neu gerankte Maps erscheinen jetzt innerhalb eines Tages in den Listen (vorher konnte es mehrere Tage dauern).",
      ],
      pt: [
        "Busca corrigida: um título com mais de 100 resultados (como \"REASON\") agora encontra todos os mapas; antes, os que passavam dos 100 primeiros faltavam.",
        "Mapas recém-rankeados aparecem nas listas em menos de um dia (antes podia levar vários dias).",
      ],
      pl: [
        "Poprawka wyszukiwania: tytuł z ponad 100 wynikami (np. \"REASON\") znajduje teraz wszystkie mapy; wcześniej brakowało tych po pierwszych 100.",
        "Nowo zrankowane mapy pojawiają się na listach w ciągu doby (wcześniej mogło to trwać kilka dni).",
      ],
      ru: [
        "Исправлен поиск: название с более чем 100 результатами (например, \"REASON\") теперь находит все карты; раньше всё после первых 100 пропадало.",
        "Новые рейтинговые карты появляются в списках в течение суток (раньше это могло занять несколько дней).",
      ],
      ko: [
        "검색 수정: 결과가 100개를 넘는 제목(예: \"REASON\")도 이제 모든 맵을 찾습니다. 이전에는 처음 100개 이후의 결과가 빠졌습니다.",
        "새로 랭크된 맵이 하루 안에 목록에 나타납니다(이전에는 며칠이 걸릴 수 있었습니다).",
      ],
      ja: [
        "検索を修正：結果が100件を超えるタイトル（\"REASON\" など）でも全マップが見つかるようになりました。以前は最初の100件以降が抜けていました。",
        "新しくランクされたマップが1日以内にリストに表示されるようになりました（以前は数日かかることがありました）。",
      ],
      zh: [
        "搜索修复：结果超过 100 个的标题（如 \"REASON\"）现在能找到所有谱面；之前前 100 个之后的结果会丢失。",
        "新 Ranked 的谱面现在一天内就会出现在列表中（之前可能要好几天）。",
      ],
    },
  },
  {
    date: "2026-11-13",
    text: {
      en: [
        "Taiko, catch and mania players: your profile, pp, rank and top plays now come from your main mode on osu! (they were always read as osu!standard before, so mania players saw 0 pp).",
        "New game mode switch (osu!, taiko, catch, mania) on My profile and Maps for you.",
        "If I had FC'd now works in every mode, with the rank from that mode's ranking.",
        "Maps for you now works in taiko, catch and mania: your pp range, your mods and maps of a similar length.",
        "The pp gain and new rank on a map page now only show for maps of your mode.",
        "My profile loads much faster: only your top 20 is recomputed.",
        "Watch auto now works for taiko, catch and mania maps too.",
        "The auto player waits for the music: it starts with the song, and the play button starts the song first.",
      ],
      fr: [
        "Joueurs taiko, catch et mania : votre profil, vos pp, votre rang et vos top plays viennent maintenant de votre mode principal sur osu! (avant, tout était lu en osu! standard, d'où 0 pp pour les joueurs mania).",
        "Nouveau choix du mode (osu!, taiko, catch, mania) sur Mon profil et Maps for you.",
        "Si j'avais FC marche maintenant dans tous les modes, avec le rang du classement de ce mode.",
        "Maps for you marche en taiko, catch et mania : votre plage de pp, vos mods et des maps de durée proche.",
        "Le gain de pp et le nouveau rang sur la page d'une map ne s'affichent que pour les maps de votre mode.",
        "Mon profil charge beaucoup plus vite : seul votre top 20 est recalculé.",
        "Voir l'auto marche aussi pour les maps taiko, catch et mania.",
        "Le lecteur auto attend la musique : il démarre avec le son, et le bouton lecture lance d'abord le son.",
      ],
      es: [
        "Jugadores de taiko, catch y mania: tu perfil, tus pp, tu rango y tus mejores jugadas ahora vienen de tu modo principal en osu! (antes todo se leía como osu!standard, por eso los jugadores de mania veían 0 pp).",
        "Nuevo selector de modo (osu!, taiko, catch, mania) en Mi perfil y Mapas para ti.",
        "Si hubiera hecho FC ahora funciona en todos los modos, con el rango de la clasificación de ese modo.",
        "Mapas para ti ahora funciona en taiko, catch y mania: tu rango de pp, tus mods y mapas de duración parecida.",
        "La ganancia de pp y el nuevo rango en la página de un mapa solo se muestran en mapas de tu modo.",
        "Mi perfil carga mucho más rápido: solo se recalcula tu top 20.",
        "Ver auto ahora también funciona en mapas de taiko, catch y mania.",
        "El reproductor auto espera a la música: empieza con la canción, y el botón de reproducir inicia primero la canción.",
      ],
      de: [
        "Taiko-, Catch- und Mania-Spieler: Dein Profil, deine pp, dein Rang und deine Top-Plays kommen jetzt aus deinem Hauptmodus auf osu! (vorher wurde alles als osu!standard gelesen, daher sahen Mania-Spieler 0 pp).",
        "Neue Modusauswahl (osu!, taiko, catch, mania) bei Mein Profil und Maps für dich.",
        "Hätte ich FC gemacht funktioniert jetzt in jedem Modus, mit dem Rang aus der Rangliste dieses Modus.",
        "Maps für dich funktioniert jetzt in taiko, catch und mania: dein pp-Bereich, deine Mods und Maps ähnlicher Länge.",
        "pp-Gewinn und neuer Rang auf einer Map-Seite erscheinen nur noch bei Maps deines Modus.",
        "Mein Profil lädt viel schneller: Nur deine Top 20 wird neu berechnet.",
        "Auto ansehen funktioniert jetzt auch für taiko-, catch- und mania-Maps.",
        "Der Auto-Player wartet auf die Musik: Er startet mit dem Song, und der Play-Button startet zuerst den Song.",
      ],
      pt: [
        "Jogadores de taiko, catch e mania: seu perfil, seus pp, seu rank e suas melhores jogadas agora vêm do seu modo principal no osu! (antes tudo era lido como osu!standard, por isso jogadores de mania viam 0 pp).",
        "Novo seletor de modo (osu!, taiko, catch, mania) em Meu perfil e Mapas para você.",
        "Se eu tivesse feito FC agora funciona em todos os modos, com o rank do ranking desse modo.",
        "Mapas para você agora funciona em taiko, catch e mania: sua faixa de pp, seus mods e mapas de duração parecida.",
        "O ganho de pp e o novo rank na página de um mapa só aparecem em mapas do seu modo.",
        "Meu perfil carrega muito mais rápido: só o seu top 20 é recalculado.",
        "Ver auto agora também funciona em mapas de taiko, catch e mania.",
        "O player auto espera a música: começa junto com a música, e o botão de play inicia a música primeiro.",
      ],
      pl: [
        "Gracze taiko, catch i mania: twój profil, pp, ranga i najlepsze wyniki pochodzą teraz z twojego głównego trybu w osu! (wcześniej wszystko było czytane jako osu!standard, więc gracze mania widzieli 0 pp).",
        "Nowy wybór trybu (osu!, taiko, catch, mania) w Moim profilu i Mapach dla ciebie.",
        "Gdybym zrobił FC działa teraz w każdym trybie, z rangą z rankingu tego trybu.",
        "Mapy dla ciebie działają teraz w taiko, catch i mania: twój zakres pp, twoje mody i mapy o podobnej długości.",
        "Zysk pp i nowa ranga na stronie mapy pokazują się tylko dla map twojego trybu.",
        "Mój profil ładuje się dużo szybciej: przeliczane jest tylko twoje top 20.",
        "Oglądanie auto działa teraz też dla map taiko, catch i mania.",
        "Odtwarzacz auto czeka na muzykę: startuje razem z piosenką, a przycisk odtwarzania najpierw włącza piosenkę.",
      ],
      ru: [
        "Игроки taiko, catch и mania: ваш профиль, pp, ранг и лучшие результаты теперь берутся из вашего основного режима в osu! (раньше всё читалось как osu!standard, поэтому у игроков mania было 0 pp).",
        "Новый выбор режима (osu!, taiko, catch, mania) в Моём профиле и Картах для вас.",
        "«Если бы я сделал FC» теперь работает во всех режимах, с рангом из рейтинга этого режима.",
        "Карты для вас теперь работают в taiko, catch и mania: ваш диапазон pp, ваши моды и карты похожей длины.",
        "Прирост pp и новый ранг на странице карты показываются только для карт вашего режима.",
        "Мой профиль загружается намного быстрее: пересчитывается только ваш топ-20.",
        "Просмотр auto теперь работает и для карт taiko, catch и mania.",
        "Auto-плеер ждёт музыку: он стартует вместе с песней, а кнопка воспроизведения сначала запускает песню.",
      ],
      ko: [
        "태고, 캐치, 매니아 플레이어: 프로필, pp, 순위, 최고 기록이 이제 osu!의 주 모드에서 가져옵니다(이전에는 모두 osu!standard로 읽어서 매니아 플레이어는 0pp로 보였습니다).",
        "내 프로필과 추천 맵에 모드 선택(osu!, taiko, catch, mania)이 생겼습니다.",
        "풀콤했다면이 이제 모든 모드에서 작동하며, 해당 모드 랭킹의 순위를 보여줍니다.",
        "추천 맵이 이제 태고, 캐치, 매니아에서도 작동합니다: 당신의 pp 범위, 모드, 비슷한 길이의 맵.",
        "맵 페이지의 pp 증가와 새 순위는 이제 당신의 모드 맵에서만 표시됩니다.",
        "내 프로필이 훨씬 빨리 로드됩니다: 상위 20개만 다시 계산합니다.",
        "오토 보기가 이제 태고, 캐치, 매니아 맵에서도 작동합니다.",
        "오토 플레이어가 음악을 기다립니다: 노래와 함께 시작하며, 재생 버튼은 먼저 노래를 시작합니다.",
      ],
      ja: [
        "太鼓・キャッチ・マニアのプレイヤーへ：プロフィール、pp、順位、トッププレイが osu! のメインモードから取得されるようになりました（以前はすべて osu!standard として読み込まれ、マニアのプレイヤーは 0pp と表示されていました）。",
        "マイプロフィールとおすすめマップにモード切り替え（osu!、taiko、catch、mania）を追加しました。",
        "「もしFCしていたら」が全モードで使えるようになり、そのモードのランキングでの順位を表示します。",
        "おすすめマップが太鼓・キャッチ・マニアでも使えるようになりました：あなたの pp 範囲、Mod、近い長さのマップ。",
        "マップページの pp 増加と新しい順位は、あなたのモードのマップでのみ表示されます。",
        "マイプロフィールの読み込みが大幅に速くなりました：再計算するのはトップ20だけです。",
        "オート再生が太鼓・キャッチ・マニアのマップでも使えるようになりました。",
        "オートプレイヤーは音楽を待ちます：曲と一緒に始まり、再生ボタンはまず曲を流します。",
      ],
      zh: [
        "太鼓、接水果和下落式玩家：你的资料、pp、排名和最佳成绩现在来自你在 osu! 的主模式（之前全部按 osu!standard 读取，所以下落式玩家显示 0 pp）。",
        "我的资料和为你推荐中新增模式切换（osu!、taiko、catch、mania）。",
        "「如果我全连了」现在支持所有模式，并显示该模式排行榜中的排名。",
        "为你推荐现在支持太鼓、接水果和下落式：你的 pp 范围、你的 Mod 和时长相近的谱面。",
        "谱面页面的 pp 增长和新排名现在只对你所在模式的谱面显示。",
        "我的资料加载快了很多：只重新计算你的前 20。",
        "观看 auto 现在也支持太鼓、接水果和下落式谱面。",
        "auto 播放器会等待音乐：随歌曲一起开始，播放按钮会先启动歌曲。",
      ],
    },
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
  return (
    <section className="panel changelog-page">
      <h1>{t.changelogTitle}</h1>
      {CHANGELOG.map((entry) => (
        <article key={entry.date} className="changelog-entry">
          <h2>
            <time dateTime={entry.date}>{formatDay(entry.date, lang)}</time>
          </h2>
          <ul>
            {(entry.text[lang] ?? entry.text.en).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
