import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ppGain, type MapMark, type MeResponse, type TopPlay, type UserProfile } from "@osu-pp/shared";
import { readJson, writeJson } from "./storage";

/**
 * The signed-in osu! player (if any), their map marks and top plays.
 * Marks live in the browser when signed out, and on the server when signed in (the
 * browser's marks are sent up once at sign-in, so nothing is lost).
 */

const LOCAL_MARKS = "osu-pp-lookup:marks";

interface AccountState {
  ready: boolean;
  loginAvailable: boolean;
  profile: UserProfile | null;
  marks: Record<string, MapMark>;
  top: TopPlay[];
  /** beatmap id -> the player's best play on it */
  topById: Map<number, TopPlay>;
  markOf(beatmapId: number): MapMark | null;
  setMark(beatmapId: number, mark: MapMark | null): void;
  gainFor(beatmapId: number, pp: number): number;
  logout(): void;
}

const AccountContext = createContext<AccountState | null>(null);

async function putMarks(marks: Record<string, MapMark | null>): Promise<Record<string, MapMark> | null> {
  try {
    const response = await fetch("/api/me/marks", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ marks }),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { marks: Record<string, MapMark> }).marks;
  } catch {
    return null;
  }
}

export function AccountProvider(props: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [localMarks, setLocalMarks] = useState<Record<string, MapMark>>(() => readJson(LOCAL_MARKS, {}));
  const merged = useRef(false);

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
            const saved = await putMarks(fresh);
            if (saved) {
              answer = { ...answer, marks: saved };
              writeJson(LOCAL_MARKS, {});
              setLocalMarks({});
            }
          }
        }
        if (alive) setMe(answer ?? { signedIn: false, loginAvailable: false, profile: null, marks: {}, top: [] });
      });
    return () => {
      alive = false;
    };
  }, []);

  const signedIn = Boolean(me?.signedIn);
  const marks = signedIn ? (me?.marks ?? {}) : localMarks;
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
    (beatmapId: number, mark: MapMark | null) => {
      const id = String(beatmapId);
      const apply = (current: Record<string, MapMark>) => {
        const next = { ...current };
        if (mark) next[id] = mark;
        else delete next[id];
        return next;
      };
      if (signedIn) {
        setMe((current) => (current ? { ...current, marks: apply(current.marks) } : current));
        void putMarks({ [id]: mark }).then((saved) => {
          if (saved) setMe((current) => (current ? { ...current, marks: saved } : current));
        });
      } else {
        setLocalMarks((current) => {
          const next = apply(current);
          writeJson(LOCAL_MARKS, next);
          return next;
        });
      }
    },
    [signedIn],
  );

  const logout = useCallback(() => {
    void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).finally(() => {
      setMe((current) => (current ? { ...current, signedIn: false, profile: null, marks: {}, top: [] } : current));
    });
  }, []);

  const value = useMemo<AccountState>(
    () => ({
      ready: me != null,
      loginAvailable: Boolean(me?.loginAvailable),
      profile: signedIn ? (me?.profile ?? null) : null,
      marks,
      top,
      topById,
      markOf: (beatmapId) => marks[String(beatmapId)] ?? null,
      setMark,
      gainFor: (beatmapId, pp) => ppGain(top, beatmapId, pp),
      logout,
    }),
    [me, signedIn, marks, top, topById, setMark, logout],
  );

  return <AccountContext.Provider value={value}>{props.children}</AccountContext.Provider>;
}

export function useAccount(): AccountState {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount needs AccountProvider");
  return value;
}
