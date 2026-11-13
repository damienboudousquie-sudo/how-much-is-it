import { formatDay, LAST_UPDATE } from "./Changelog";
import { CHANGELOG_PATH } from "./route";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "./track";
import { createPortal } from "react-dom";
import type { FeedbackItem, FeedbackKind } from "@osu-pp/shared";
import { useAccount } from "./account";
import { currentLang, useI18n } from "./i18n";

/** The creator's osu! profile, linked discreetly in the top bar. */
export const CREATOR_PROFILE = "https://osu.ppy.sh/users/18188835";

async function send(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, headers: { "Content-Type": "application/json", "x-lang": currentLang(), ...init.headers } });
}

/** "Feedback" and "Contact: (osu!)" on the right of the top bar. */
export function TopLinks() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="top-links">
      <a className="top-updated" href={CHANGELOG_PATH} title={t.changelogTitle} onClick={() => trackEvent("changelog_open")}>
        <span className="dot" aria-hidden="true" />
        <span className="top-updated-label">{t.updatedOn}</span> {formatDay(LAST_UPDATE, lang)}
      </a>
      <button type="button" className="top-feedback" onClick={() => {
          setOpen(true);
          trackEvent("feedback_open");
        }}>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
        <span>{t.feedback}</span>
      </button>
      <span className="top-contact">
        <span className="top-contact-label">{t.contact}</span>
        <a className="top-osu" href={CREATOR_PROFILE} target="_blank" rel="noreferrer" title={t.creatorProfile} aria-label={t.creatorProfile}>
          <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
            <circle cx="16" cy="16" r="14.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
            <text x="16" y="16" dy="0.36em" textAnchor="middle" fontSize="11" fontWeight="900" fill="currentColor">
              osu!
            </text>
          </svg>
        </a>
      </span>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function FeedbackDialog(props: { onClose: () => void }) {
  const { t } = useI18n();
  const account = useAccount();
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState(account.profile?.username ?? "");
  const [state, setState] = useState<"edit" | "sending" | "sent">("edit");
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (message.trim().length < 3 || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const response = await send("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ kind, message, contact, page: window.location.href }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? response.statusText);
      }
      setState("sent");
      trackEvent("feedback_sent");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setState("edit");
    }
  };

  const kinds: [FeedbackKind, string][] = [
    ["bug", t.feedbackBug],
    ["idea", t.feedbackIdea],
    ["other", t.feedbackOther],
  ];

  return createPortal(
    <div className="modal-shade" onPointerDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <form className="feedback-dialog" role="dialog" aria-label={t.feedbackTitle} onSubmit={(event) => void submit(event)}>
        <div className="feedback-head">
          <h2>{t.feedbackTitle}</h2>
          <button type="button" className="auto-close" aria-label="×" onClick={props.onClose}>
            ×
          </button>
        </div>
        {state === "sent" ? (
          <p className="feedback-sent">{t.feedbackSent}</p>
        ) : (
          <>
            <div className="feedback-kinds" role="radiogroup">
              {kinds.map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={kind === value} className={kind === value ? "on" : ""} onClick={() => setKind(value)}>
                  {label}
                </button>
              ))}
            </div>
            <textarea ref={area} value={message} maxLength={2000} rows={5} placeholder={t.feedbackMessage} onChange={(event) => setMessage(event.currentTarget.value)} />
            <input value={contact} maxLength={100} placeholder={t.feedbackContact} onChange={(event) => setContact(event.currentTarget.value)} />
            {error && <p className="feedback-error">{error}</p>}
            <button type="submit" className="button" disabled={message.trim().length < 3 || state === "sending"}>
              {t.feedbackSend}
            </button>
          </>
        )}
      </form>
    </div>,
    document.body,
  );
}

/** The owner's inbox: every message sent with the feedback button. */
export function FeedbackInbox() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account.admin) return;
    fetch("/api/feedback", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.statusText);
        return ((await response.json()) as { items: FeedbackItem[] }).items;
      })
      .then(setItems)
      .catch((failure) => setError(String(failure)));
  }, [account.admin]);

  if (!account.ready) return null;
  if (!account.admin) return <p className="notice">404</p>;

  const update = async (item: FeedbackItem, done: boolean) => {
    setItems((list) => list?.map((entry) => (entry.id === item.id ? { ...entry, done } : entry)) ?? null);
    await send(`/api/feedback/${item.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
  };
  const remove = async (item: FeedbackItem) => {
    setItems((list) => list?.filter((entry) => entry.id !== item.id) ?? null);
    await send(`/api/feedback/${item.id}`, { method: "DELETE" });
  };

  const shown = (items ?? []).filter((item) => filter === "all" || !item.done);
  const openCount = (items ?? []).filter((item) => !item.done).length;
  const label: Record<FeedbackKind, string> = { bug: t.feedbackBug, idea: t.feedbackIdea, other: t.feedbackOther };

  return (
    <main className="inbox">
      <div className="panel pinned-head">
        <h2>{t.feedbackInbox}</h2>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={filter === "open"} className={`tab pin-tab${filter === "open" ? " on" : ""}`} onClick={() => setFilter("open")}>
            {t.feedbackOpen}
            <span className="count">{openCount}</span>
          </button>
          <button type="button" role="tab" aria-selected={filter === "all"} className={`tab pin-tab${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
            {t.feedbackAll}
            <span className="count">{items?.length ?? 0}</span>
          </button>
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      {items && shown.length === 0 && <p className="notice">{t.feedbackEmpty}</p>}
      <ul className="inbox-list">
        {shown.map((item) => (
          <li key={item.id} className={`panel inbox-item kind-${item.kind}${item.done ? " done" : ""}`}>
            <div className="inbox-meta">
              <span className={`inbox-kind kind-${item.kind}`}>{label[item.kind]}</span>
              <time dateTime={item.at}>{new Date(item.at).toLocaleString(lang)}</time>
              {item.user && (
                <a href={`https://osu.ppy.sh/users/${item.user.id}`} target="_blank" rel="noreferrer">
                  {item.user.username}
                </a>
              )}
              {item.contact && item.contact !== item.user?.username && <span>· {item.contact}</span>}
              {item.lang && <span className="inbox-lang">{item.lang.toUpperCase()}</span>}
            </div>
            <p className="inbox-message">{item.message}</p>
            <div className="inbox-actions">
              {item.page && (
                <a className="inbox-page" href={item.page} target="_blank" rel="noreferrer">
                  {item.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                </a>
              )}
              <button type="button" onClick={() => void update(item, !item.done)}>
                {item.done ? t.feedbackReopen : t.feedbackDone}
              </button>
              <button type="button" className="danger" onClick={() => void remove(item)}>
                {t.feedbackDelete}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
