import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ppGain, type MapMark, type MeResponse, type PinInfo, type TopPlay, type UserProfile } from "@osu-pp/shared";
import { readJson, writeJson } from "./storage";

/**
 * The signed-in osu! player (if any), their map marks and top plays.
 * Marks live in the browser when signed out, and on the server when signed in (the
 * browser's marks are sent up once at sign-in, so nothing is lost).
 */

const LOCAL_MARKS = "osu-pp-lookup:marks";
const LOCAL_PINS = "osu-pp-lookup:pins";

/** A map as shown on a card, without the pin date. */
export type PinSource = Omit<PinInfo, "at">;

interface AccountState {
  ready: boolean;
  /** Why the last sign-in failed, shown once. */
  loginError: string | null;
  dismissLoginError(): void;
  loginAvailable: boolean;
  profile: UserProfile | null;
  /** The site owner: sees the feedback page. */
  admin: boolean;
  marks: Record<string, MapMark>;
  /** What each marked map looks like, for the pinned maps page. */
  pins: Record<string, PinInfo>;
  top: TopPlay[];
  /** beatmap id -> the player's best play on it */
  topById: Map<number, TopPlay>;
  markOf(beatmapId: number): MapMark | null;
  setMark(beatmapId: number, mark: MapMark | null, map?: PinSource): void;
  gainFor(beatmapId: number, pp: number): number;
  logout(): void;
}

const AccountContext = createContext<AccountState | null>(null);

type Saved = { marks: Record<string, MapMark>; pins: Record<string, PinInfo> };

async function putMarks(marks: Record<string, MapMark | null>, pins: Record<string, PinInfo> = {}): Promise<Saved | null> {
  try {
    const response = await fetch("/api/me/marks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ marks, pins }),
    });
    if (!response.ok) return null;
    return (await response.json()) as Saved;
  } catch {
    return null;
  }
}

export function AccountProvider(props: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [localMarks, setLocalMarks] = useState<Record<string, MapMark>>(() => readJson(LOCAL_MARKS, {}));
  const [localPins, setLocalPins] = useState<Record<string, PinInfo>>(() => readJson(LOCAL_PINS, {}));
  const merged = useRef(false);
  const [loginError, setLoginError] = useState<string | null>(() => {
    const match = /(?:^|;\s*)hmi_login_error=([^;]*)/.exec(document.cookie);
    if (!match) return null;
    document.cookie = "hmi_login_error=; Path=/; Max-Age=0";
    try {
      return decodeURIComponent(match[1] ?? "");
    } catch {
      return match[1] ?? null;
    }
  });

  useEffect(() => {
    let alive = true;
    void fetch("/api/me", { credentials: "same-origin" })
      .then((response) => (response.ok ? (response.json() as Promise<MeResponse>) : null))
      .catch(() => null)
      .then(async (answer) => {
        if (!alive) return;
        if (answer?.signedIn && !merged.current) {
          merged.current = true;
          // Marks made before signing in join the account once.
          const pending = readJson<Record<string, MapMark>>(LOCAL_MARKS, {});
          const known = answer.marks;
          const fresh = Object.fromEntries(Object.entries(pending).filter(([id]) => !(id in known)));
          if (Object.keys(fresh).length > 0) {
            const saved = await putMarks(fresh, readJson<Record<string, PinInfo>>(LOCAL_PINS, {}));
            if (saved) {
              answer = { ...answer, marks: saved.marks, pins: saved.pins };
              writeJson(LOCAL_MARKS, {});
              writeJson(LOCAL_PINS, {});
              setLocalMarks({});
              setLocalPins({});
            }
          }
        }
        if (alive) setMe(answer ? { ...answer, pins: answer.pins ?? {} } : { signedIn: false, loginAvailable: false, profile: null, marks: {}, pins: {}, top: [] });
      });
    return () => {
      alive = false;
    };
  }, []);

  const signedIn = Boolean(me?.signedIn);
  const marks = signedIn ? (me?.marks ?? {}) : localMarks;
  const pins = signedIn ? (me?.pins ?? {}) : localPins;
  const top = me?.top ?? [];
  const topById = useMemo(() => {
    const map = new Map<number, TopPlay>();
    for (const play of top) {
      const known = map.get(play.beatmapId);
      if (!known || known.pp < play.pp) map.set(play.beatmapId, play);
    }
    return map;
  }, [top]);

  const setMark = useCallback(
    (beatmapId: number, mark: MapMark | null, map?: PinSource) => {
      const id = String(beatmapId);
      const applyMarks = (current: Record<string, MapMark>) => {
        const next = { ...current };
        if (mark) next[id] = mark;
        else delete next[id];
        return next;
      };
      const applyPins = (current: Record<string, PinInfo>) => {
        const next = { ...current };
        if (!mark) delete next[id];
        else if (map) next[id] = { ...map, at: current[id]?.at ?? Date.now() };
        return next;
      };
      if (signedIn) {
        // The server keeps the first pin date, so "now" is fine here.
        const sent: Record<string, PinInfo> = mark && map ? { [id]: { ...map, at: Date.now() } } : {};
        setMe((current) => (current ? { ...current, marks: applyMarks(current.marks), pins: applyPins(current.pins ?? {}) } : current));
        void putMarks({ [id]: mark }, sent).then((saved) => {
          if (saved) setMe((current) => (current ? { ...current, marks: saved.marks, pins: saved.pins } : current));
        });
      } else {
        setLocalMarks((current) => {
          const next = applyMarks(current);
          writeJson(LOCAL_MARKS, next);
          return next;
        });
        setLocalPins((current) => {
          const next = applyPins(current);
          writeJson(LOCAL_PINS, next);
          return next;
        });
      }
    },
    [signedIn],
  );

  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(() => {
      setMe((current) => (current ? { ...current, signedIn: false, profile: null, marks: {}, pins: {}, top: [] } : current));
    });
  }, []);

  const value = useMemo<AccountState>(
    () => ({
      ready: me != null,
      loginError,
      dismissLoginError: () => setLoginError(null),
      loginAvailable: Boolean(me?.loginAvailable),
      profile: signedIn ? (me?.profile ?? null) : null,
      admin: signedIn && Boolean(me?.admin),
      marks,
      pins,
      top,
      topById,
      markOf: (beatmapId) => marks[String(beatmapId)] ?? null,
      setMark,
      gainFor: (beatmapId, pp) => ppGain(top, beatmapId, pp),
      logout,
    }),
    [me, signedIn, marks, pins, top, topById, setMark, logout, loginError],
  );

  return <AccountContext.Provider value={value}>{props.children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount needs AccountProvider");
  return value;
}
