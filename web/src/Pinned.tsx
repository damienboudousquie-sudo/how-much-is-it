import { useMemo, useState } from "react";
import type { DiscoverHit, MapMark, PinInfo } from "@osu-pp/shared";
import { useAccount } from "./account";
import { MapCard } from "./Finder";
import { useI18n } from "./i18n";

type Filter = "all" | MapMark;

/** Every pinned map, newest first, filtered by mark. */
export function PinnedMaps(props: { onOpen(hit: DiscoverHit): void }) {
  const { t } = useI18n();
  const account = useAccount();
  const [filter, setFilter] = useState<Filter>("all");

  const list = useMemo(() => {
    const entries = Object.entries(account.marks).map(([id, mark]) => {
      const pin: PinInfo | undefined = account.pins[id];
      return { id: Number(id), mark, pin, at: pin?.at ?? 0 };
    });
    return entries.sort((a, b) => b.at - a.at);
  }, [account.marks, account.pins]);

  const counts = { all: list.length, farm: list.filter((item) => item.mark === "farm").length, done: list.filter((item) => item.mark === "done").length };
  const shown = list.filter((item) => filter === "all" || item.mark === filter);

  return (
    <section className="finder pinned">
      <div className="panel pinned-head">
        <h2>{t.pinnedMaps}</h2>
        <div className="tabs" role="tablist" aria-label={t.pinnedMaps}>
          {(["all", "farm", "done"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={`tab pin-tab is-${key}${filter === key ? " on" : ""}`}
              onClick={() => setFilter(key)}
            >
              {key === "all" ? t.pinnedAll : key === "farm" ? t.markFarm : t.markDone}
              <span className="count">{counts[key]}</span>
            </button>
          ))}
        </div>
        {!account.profile && list.length > 0 && <p className="help">{t.pinnedLocal}</p>}
      </div>
      {shown.length === 0 ? (
        <p className="empty">{t.pinnedEmpty}</p>
      ) : (
        <div className="map-list">
          {shown.map((item, index) => {
            const hit: DiscoverHit = item.pin
              ? { ...item.pin, status: "ranked", farm: 0, estimated: false }
              : {
                  beatmapId: item.id,
                  beatmapsetId: null,
                  mode: "osu",
                  title: `#${item.id}`,
                  artist: "",
                  version: "",
                  creator: "",
                  status: "ranked",
                  cover: null,
                  stars: 0,
                  pp: 0,
                  lengthSeconds: null,
                  bpm: null,
                  ar: null,
                  mods: [],
                  style: null,
                  tags: [],
                  farm: 0,
                  estimated: false,
                };
            return <MapCard key={item.id} hit={hit} rank={index + 1} showRank={false} hideFarm onOpen={props.onOpen} />;
          })}
        </div>
      )}
    </section>
  );
}
