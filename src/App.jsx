import React, { useState, useEffect, useCallback } from "react";

/* ============================================================
   楽屋口 — 出演者予約管理
   トークン:
   bg      #14171F  (幕が下りた劇場の暗がり)
   surface #1E2230  (パネル)
   gold    #D4A24E  (マーキー電球のゴールド)
   cream   #F2EDE4  (地の文字色)
   muted   #8891A8  (補助テキスト)
   danger  #C1554A  (削除・警告=チケットの検認スタンプ)
   display: 'Mochiy Pop One' (マーキー文字)
   body:    'Zen Maru Gothic'
   mono:    'Zen Maru Gothic' (PIN・日付などの数字)
============================================================ */

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Mochiy+Pop+One&family=Zen+Maru+Gothic:wght@400;500;700;900&display=swap');`;

const COLORS = {
  bg: "#0F241A",
  surface: "#183524",
  surface2: "#1F402C",
  gold: "#C6473A",
  cream: "#F5F1E6",
  muted: "#9FB8A8",
  danger: "#E2574A",
  line: "#2C4A38",
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* 管理者PINを忘れた際の復旧コード(固定・コード内に埋め込み)。
   信頼できるスタッフだけがこのコードを知っている前提の簡易的な保険。 */
const RECOVERY_CODE = "FANTASTIC-RESET";

const SEAT_TYPES = {
  vip: { label: "VIP", priceLabel: "+¥500", cap: 4, order: 0 },
  counter: { label: "カウンター指定席", priceLabel: "+¥500", cap: 8, order: 1 },
  stool: { label: "丸椅子", priceLabel: "", cap: null, order: 2 },
  undecided: { label: "未指定", priceLabel: "", cap: null, order: 3 },
};

const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

function seatTypeOf(b) {
  return SEAT_TYPES[b.seatType] ? b.seatType : "undecided";
}

/* 予約一覧の並び順:
   VIP→カウンター→丸椅子→未指定。
   カウンターは座席番号の若い順、それ以外は先着(登録)順。 */
function sortAndAnnotate(list) {
  return [...list].sort((a, b) => {
    const oa = SEAT_TYPES[seatTypeOf(a)].order;
    const ob = SEAT_TYPES[seatTypeOf(b)].order;
    if (oa !== ob) return oa - ob;
    if (seatTypeOf(a) === "counter") {
      const na = Math.min(...(a.counterSeats && a.counterSeats.length ? a.counterSeats : [99]));
      const nb = Math.min(...(b.counterSeats && b.counterSeats.length ? b.counterSeats : [99]));
      if (na !== nb) return na - nb;
    }
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/* 種別ごとの合計人数(イベント単位のサマリー表示に使う) */
function seatTypeTotals(list) {
  const totals = { vip: 0, counter: 0, stool: 0, undecided: 0 };
  list.forEach((b) => {
    totals[seatTypeOf(b)] += b.count || 0;
  });
  return totals;
}

/* VIP/カウンターの残り枠を計算(編集中の予約自身は除く) */
function remainingCapacity(list, type, excludeId) {
  const cap = SEAT_TYPES[type].cap;
  if (cap == null) return Infinity;
  const used = list
    .filter((b) => seatTypeOf(b) === type && b.id !== excludeId)
    .reduce((s, b) => s + (b.count || 0), 0);
  return cap - used;
}

/* カウンターの使用済み座席番号(1〜8)を集計(編集中の予約自身は除く) */
function usedCounterSeats(list, excludeId) {
  const used = new Set();
  list
    .filter((b) => seatTypeOf(b) === "counter" && b.id !== excludeId)
    .forEach((b) => (b.counterSeats || []).forEach((n) => used.add(n)));
  return used;
}

/* 指定の開始番号からcount席分、連番で空いているかを判定 */
function canFitConsecutive(used, start, count) {
  for (let n = start; n < start + count; n++) {
    if (n > 8 || used.has(n)) return false;
  }
  return true;
}

function useStorage() {
  const [participants, setParticipants] = useState([]);
  const [events, setEvents] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [adminPin, setAdminPin] = useState("1234");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadKey = useCallback(async (key, fallback) => {
    try {
      const res = await window.storage.get(key, true);
      return res ? JSON.parse(res.value) : fallback;
    } catch {
      return fallback;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [p, e, b, a] = await Promise.all([
          loadKey("participants", []),
          loadKey("events", []),
          loadKey("bookings", []),
          loadKey("admin-config", { pin: "1234" }),
        ]);
        setParticipants(p);
        setEvents(e);
        setBookings(b);
        setAdminPin(a.pin || "1234");
      } catch (e) {
        setError("データの読み込みに失敗しました。再読み込みしてください。");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadKey]);

  const persist = useCallback(async (key, value) => {
    try {
      await window.storage.set(key, JSON.stringify(value), true);
    } catch {
      setError("保存に失敗しました。通信状況を確認して再度お試しください。");
    }
  }, []);

  const updateParticipants = useCallback(
    (next) => {
      setParticipants(next);
      persist("participants", next);
    },
    [persist]
  );
  const updateEvents = useCallback(
    (next) => {
      setEvents(next);
      persist("events", next);
    },
    [persist]
  );
  const updateBookings = useCallback(
    (next) => {
      setBookings(next);
      persist("bookings", next);
    },
    [persist]
  );
  const updateAdminPin = useCallback(
    (pin) => {
      setAdminPin(pin);
      persist("admin-config", { pin });
    },
    [persist]
  );

  return {
    loading,
    error,
    setError,
    participants,
    updateParticipants,
    events,
    updateEvents,
    bookings,
    updateBookings,
    adminPin,
    updateAdminPin,
  };
}

/* ---------- 共通パーツ ---------- */

function Marquee({ children, size = "2.6rem" }) {
  return (
    <h1
      style={{
        fontFamily: "'Mochiy Pop One', sans-serif",
        fontSize: size,
        letterSpacing: "0.08em",
        color: COLORS.gold,
        textShadow: "0 0 18px rgba(198,71,58,0.35)",
        margin: 0,
      }}
    >
      {children}
    </h1>
  );
}

function Button({ children, onClick, variant = "gold", full, type = "button", disabled }) {
  const styles = {
    gold: { background: COLORS.gold, color: COLORS.cream, border: "none" },
    ghost: { background: "transparent", color: COLORS.cream, border: `1px solid ${COLORS.line}` },
    danger: { background: "transparent", color: COLORS.danger, border: `1px solid ${COLORS.danger}` },
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...styles[variant],
        padding: "0.7rem 1.2rem",
        borderRadius: "8px",
        fontFamily: "'Zen Maru Gothic', sans-serif",
        fontWeight: 600,
        fontSize: "0.9rem",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        width: full ? "100%" : "auto",
        transition: "transform 0.12s ease, opacity 0.12s ease",
      }}
      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
    >
      {children}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginBottom: "0.9rem" }}>
      <span
        style={{
          display: "block",
          fontSize: "0.75rem",
          color: COLORS.muted,
          marginBottom: "0.35rem",
          fontFamily: "'Zen Maru Gothic', sans-serif",
          letterSpacing: "0.03em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  background: COLORS.surface2,
  border: `1px solid ${COLORS.line}`,
  borderRadius: "6px",
  padding: "0.6rem 0.7rem",
  color: COLORS.cream,
  fontFamily: "'Zen Maru Gothic', sans-serif",
  fontSize: "0.95rem",
};

const pinInputStyle = {
  ...inputStyle,
  fontFamily: "'Zen Maru Gothic', sans-serif",
  letterSpacing: "0.3em",
  textAlign: "center",
  fontSize: "1.3rem",
};

function Panel({ children }) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.line}`,
        borderRadius: "10px",
        padding: "1.3rem",
      }}
    >
      {children}
    </div>
  );
}

/* チケット・スタブ風カード(punch-hole 演出つき) */
function TicketCard({ left, right, children }) {
  return (
    <div
      style={{
        display: "flex",
        background: COLORS.surface,
        border: `1px solid ${COLORS.line}`,
        borderRadius: "10px",
        overflow: "hidden",
        marginBottom: "0.9rem",
      }}
    >
      <div
        style={{
          width: "6px",
          background: COLORS.gold,
        }}
      />
      <div style={{ flex: 1, padding: "1rem 1.1rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <div>{left}</div>
          <div>{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Badge({ children, tone = "gold" }) {
  const map = {
    gold: { color: COLORS.gold, border: COLORS.gold },
    muted: { color: COLORS.muted, border: COLORS.line },
  };
  return (
    <span
      style={{
        fontFamily: "'Zen Maru Gothic', sans-serif",
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.05em",
        color: map[tone].color,
        border: `1px solid ${map[tone].border}`,
        borderRadius: "999px",
        padding: "0.15rem 0.6rem",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* VIP◯名 / カウンター◯名(丸椅子は入っている時だけ表示) のサマリー */
function SeatSummary({ bookingsForEvent }) {
  const totals = seatTypeTotals(bookingsForEvent);
  return (
    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
      <Badge tone="gold">VIP {totals.vip}名</Badge>
      <Badge tone="gold">カウンター {totals.counter}名</Badge>
      {totals.stool > 0 && <Badge tone="muted">丸椅子 {totals.stool}名</Badge>}
    </div>
  );
}

function ConfirmDialog({ message, confirmLabel = "削除する", onConfirm, onCancel }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,12,8,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: "1.2rem",
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.line}`,
          borderRadius: "12px",
          padding: "1.3rem",
          width: "100%",
          maxWidth: "360px",
        }}
      >
        <div style={{ color: COLORS.cream, fontFamily: "'Zen Maru Gothic'", fontSize: "0.95rem", marginBottom: "1.1rem", lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
          <Button variant="ghost" onClick={onCancel}>キャンセル</Button>
        </div>
      </div>
    </div>
  );
}

function TopBar({ title, onBack, onLogout }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "1.2rem",
        flexWrap: "wrap",
        gap: "0.6rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: COLORS.muted,
              cursor: "pointer",
              fontSize: "1.3rem",
              lineHeight: 1,
            }}
            aria-label="戻る"
          >
            ←
          </button>
        )}
        <Marquee size="1.8rem">{title}</Marquee>
      </div>
      {onLogout && (
        <button
          onClick={onLogout}
          style={{
            background: "none",
            border: `1px solid ${COLORS.line}`,
            color: COLORS.muted,
            borderRadius: "6px",
            padding: "0.4rem 0.8rem",
            fontFamily: "'Zen Maru Gothic', sans-serif",
            fontSize: "0.8rem",
            cursor: "pointer",
          }}
        >
          ログアウト
        </button>
      )}
    </div>
  );
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt)) return d;
  return `${dt.getMonth() + 1}/${dt.getDate()} (${"日月火水木金土"[dt.getDay()]})`;
}

/* ---------- ランディング ---------- */

function Landing({ onSelectRole }) {
  return (
    <div
      style={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1.2rem",
        textAlign: "center",
      }}
    >
      <div style={{ marginBottom: "2.2rem" }}>
        <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.8rem", letterSpacing: "0.15em", marginBottom: "0.4rem" }}>
          FANTASTIC CABARET
        </div>
        <Marquee size="2.6rem">Fantastic Cabaret 予約管理</Marquee>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", width: "100%", maxWidth: "320px" }}>
        <Button full onClick={() => onSelectRole("admin")}>
          管理者としてログイン
        </Button>
        <Button full variant="ghost" onClick={() => onSelectRole("participant")}>
          出演者としてログイン
        </Button>
      </div>
    </div>
  );
}

/* ---------- 管理者ログイン ---------- */

function AdminLogin({ adminPin, onRecover, onSuccess, onBack }) {
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryErr, setRecoveryErr] = useState("");

  const submit = () => {
    if (input === adminPin) onSuccess();
    else setErr("PINが違います");
  };

  const submitRecovery = () => {
    if (recoveryInput.trim() === RECOVERY_CODE) {
      onRecover();
      onSuccess();
    } else {
      setRecoveryErr("復旧コードが違います");
    }
  };

  if (recovering) {
    return (
      <div style={{ padding: "1.5rem 1.2rem", maxWidth: "360px", margin: "0 auto" }}>
        <TopBar title="PINの復旧" onBack={() => setRecovering(false)} />
        <Panel>
          <div style={{ color: COLORS.muted, fontSize: "0.82rem", marginBottom: "0.9rem", fontFamily: "'Zen Maru Gothic'", lineHeight: 1.6 }}>
            復旧コードを入力すると、管理者PINが初期値(1234)にリセットされてログインできます。ログイン後、設定タブから新しいPINにすぐ変更してください。
          </div>
          <Field label="復旧コード">
            <input
              style={inputStyle}
              value={recoveryInput}
              onChange={(e) => { setRecoveryInput(e.target.value); setRecoveryErr(""); }}
              onKeyDown={(e) => e.key === "Enter" && submitRecovery()}
              autoFocus
            />
          </Field>
          {recoveryErr && <div style={{ color: COLORS.danger, fontSize: "0.8rem", marginBottom: "0.8rem" }}>{recoveryErr}</div>}
          <Button full onClick={submitRecovery}>復旧する</Button>
        </Panel>
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem 1.2rem", maxWidth: "360px", margin: "0 auto" }}>
      <TopBar title="管理者ログイン" onBack={onBack} />
      <Panel>
        <Field label="管理者PIN">
          <input
            style={pinInputStyle}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setErr("");
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            type="password"
            inputMode="numeric"
            autoFocus
          />
        </Field>
        {err && <div style={{ color: COLORS.danger, fontSize: "0.8rem", marginBottom: "0.8rem" }}>{err}</div>}
        <Button full onClick={submit}>
          入る
        </Button>
        <button
          onClick={() => setRecovering(true)}
          style={{
            background: "none",
            border: "none",
            color: COLORS.muted,
            fontFamily: "'Zen Maru Gothic'",
            fontSize: "0.78rem",
            marginTop: "0.8rem",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          PINを忘れた場合はこちら
        </button>
      </Panel>
    </div>
  );
}

/* ---------- 参加者ログイン ---------- */

function ParticipantLogin({ participants, onSuccess, onBack }) {
  const [selectedId, setSelectedId] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const selected = participants.find((p) => p.id === selectedId);

  if (!selectedId) {
    return (
      <div style={{ padding: "1.5rem 1.2rem", maxWidth: "420px", margin: "0 auto" }}>
        <TopBar title="出演者ログイン" onBack={onBack} />
        <Panel>
          <div style={{ color: COLORS.muted, fontSize: "0.85rem", marginBottom: "0.8rem", fontFamily: "'Zen Maru Gothic'" }}>
            自分の名前を選んでください
          </div>
          {participants.length === 0 && (
            <div style={{ color: COLORS.muted, fontSize: "0.85rem" }}>まだ名簿が登録されていません。管理者にご確認ください。</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {participants.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: COLORS.surface2,
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: "8px",
                  padding: "0.7rem 0.9rem",
                  color: COLORS.cream,
                  fontFamily: "'Zen Maru Gothic'",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                }}
              >
                {p.name}
                <Badge tone={p.type === "guest" ? "muted" : "gold"}>{p.type === "guest" ? "ゲスト" : "レギュラー"}</Badge>
              </button>
            ))}
          </div>
        </Panel>
      </div>
    );
  }

  const submit = () => {
    if (selected && pin === selected.pin) onSuccess(selected);
    else setErr("PINが違います");
  };

  return (
    <div style={{ padding: "1.5rem 1.2rem", maxWidth: "360px", margin: "0 auto" }}>
      <TopBar title={selected.name} onBack={() => setSelectedId(null)} />
      <Panel>
        <Field label="個人PIN">
          <input
            style={pinInputStyle}
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setErr("");
            }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            type="password"
            inputMode="numeric"
            autoFocus
          />
        </Field>
        {err && <div style={{ color: COLORS.danger, fontSize: "0.8rem", marginBottom: "0.8rem" }}>{err}</div>}
        <Button full onClick={submit}>
          入る
        </Button>
      </Panel>
    </div>
  );
}

/* ---------- 予約フォーム ---------- */

function BookingForm({ initial, eventBookings, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [count, setCount] = useState(initial?.count ?? 1);
  const [seatType, setSeatType] = useState(initial?.seatType || "undecided");
  const [seatNote, setSeatNote] = useState(initial?.seatNote || "");
  const [counterStart, setCounterStart] = useState(
    initial?.counterSeats && initial.counterSeats.length ? Math.min(...initial.counterSeats) : null
  );
  const [notes, setNotes] = useState(initial?.notes || "");
  const [error, setError] = useState("");

  const list = eventBookings || [];
  const remainingVip = remainingCapacity(list, "vip", initial?.id);
  const remainingCounter = remainingCapacity(list, "counter", initial?.id);
  const usedSeats = usedCounterSeats(list, initial?.id);
  const n = Number(count) || 1;

  const options = [
    { key: "vip", remaining: remainingVip },
    { key: "counter", remaining: remainingCounter },
    { key: "stool", remaining: Infinity },
    { key: "undecided", remaining: Infinity },
  ];

  const submit = () => {
    if (!name.trim()) return;
    if (seatType === "vip" && n > remainingVip) {
      setError(`VIPの残り枠(${remainingVip}名)を超えています。`);
      return;
    }
    if (seatType === "counter") {
      if (!counterStart || !canFitConsecutive(usedSeats, counterStart, n)) {
        setError("カウンター席を選択してください(人数分、連番で空いている番号のみ選べます)。");
        return;
      }
    }
    const counterSeats =
      seatType === "counter" ? Array.from({ length: n }, (_, i) => counterStart + i) : [];
    onSave({
      name: name.trim(),
      count: n,
      seatType,
      seatNote: seatType === "vip" ? seatNote.trim() : "",
      counterSeats,
      notes: notes.trim(),
    });
  };

  return (
    <Panel>
      <Field label="予約名">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <Field label="人数">
        <input
          style={inputStyle}
          type="number"
          min="1"
          value={count}
          onChange={(e) => {
            setCount(e.target.value);
            setCounterStart(null);
            setError("");
          }}
        />
      </Field>
      <Field label="予約種別">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
          {options.map((o) => {
            const def = SEAT_TYPES[o.key];
            const full = o.remaining <= 0 && seatType !== o.key;
            return (
              <button
                key={o.key}
                type="button"
                disabled={full}
                onClick={() => {
                  setSeatType(o.key);
                  setCounterStart(null);
                  setError("");
                }}
                style={{
                  position: "relative",
                  background: seatType === o.key ? COLORS.gold : "transparent",
                  color: COLORS.cream,
                  border: `1px solid ${seatType === o.key ? COLORS.gold : COLORS.line}`,
                  borderRadius: "8px",
                  padding: "0.55rem 0.5rem",
                  fontFamily: "'Zen Maru Gothic'",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  cursor: full ? "not-allowed" : "pointer",
                  textAlign: "center",
                }}
              >
                {full && (
                  <span
                    style={{
                      position: "absolute",
                      top: "-8px",
                      right: "-6px",
                      background: COLORS.danger,
                      color: COLORS.cream,
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      borderRadius: "999px",
                      padding: "0.1rem 0.45rem",
                    }}
                  >
                    満席
                  </span>
                )}
                {def.label}{def.priceLabel && ` (${def.priceLabel})`}
                {def.cap != null && (
                  <div style={{ fontWeight: 400, fontSize: "0.72rem", marginTop: "0.15rem" }}>
                    残り{Math.max(o.remaining, 0)}/{def.cap}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </Field>

      {seatType === "vip" && (
        <Field label="座席メモ(任意・例:テーブルA)">
          <input style={inputStyle} value={seatNote} onChange={(e) => setSeatNote(e.target.value)} />
        </Field>
      )}

      {seatType === "counter" && (
        <Field label={`カウンター席を選択(${n}席・連番で自動確保)`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
            {Array.from({ length: 8 }, (_, i) => i + 1).map((num) => {
              const taken = usedSeats.has(num);
              const canStartHere = !taken && canFitConsecutive(usedSeats, num, n);
              const inSelectedRange = counterStart != null && num >= counterStart && num < counterStart + n;
              return (
                <button
                  key={num}
                  type="button"
                  disabled={taken || (!canStartHere && !inSelectedRange)}
                  onClick={() => {
                    setCounterStart(num);
                    setError("");
                  }}
                  style={{
                    position: "relative",
                    background: inSelectedRange ? COLORS.gold : "transparent",
                    color: COLORS.cream,
                    border: `1px solid ${inSelectedRange ? COLORS.gold : COLORS.line}`,
                    borderRadius: "8px",
                    padding: "0.5rem 0",
                    fontFamily: "'Zen Maru Gothic'",
                    fontSize: "0.95rem",
                    fontWeight: 700,
                    cursor: taken || (!canStartHere && !inSelectedRange) ? "not-allowed" : "pointer",
                    opacity: taken ? 0.35 : !canStartHere && !inSelectedRange ? 0.4 : 1,
                  }}
                >
                  {CIRCLED_NUMBERS[num - 1]}
                  {taken && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-7px",
                        right: "-4px",
                        background: COLORS.danger,
                        color: COLORS.cream,
                        fontSize: "0.6rem",
                        fontWeight: 700,
                        borderRadius: "999px",
                        padding: "0.05rem 0.3rem",
                      }}
                    >
                      済
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Field>
      )}

      {error && <div style={{ color: COLORS.danger, fontSize: "0.8rem", marginBottom: "0.8rem" }}>{error}</div>}
      <Field label="備考">
        <textarea
          style={{ ...inputStyle, minHeight: "70px", resize: "vertical", fontFamily: "'Zen Maru Gothic'" }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>
      <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.4rem" }}>
        <Button onClick={submit}>保存する</Button>
        <Button variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </Panel>
  );
}

function BookingList({ event, bookings, onAdd, onUpdate, onDelete }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const rawList = bookings.filter((b) => b.eventId === event.id);
  const list = sortAndAnnotate(rawList);
  const deleteTarget = rawList.find((b) => b.id === deleteTargetId);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <SeatSummary bookingsForEvent={rawList} />
        {!adding && (
          <Button onClick={() => setAdding(true)}>+ 予約を追加</Button>
        )}
      </div>

      {adding && (
        <div style={{ marginBottom: "1rem" }}>
          <BookingForm
            eventBookings={rawList}
            onCancel={() => setAdding(false)}
            onSave={(data) => {
              onAdd({ id: uid(), eventId: event.id, ...data, createdAt: Date.now() });
              setAdding(false);
            }}
          />
        </div>
      )}

      {rawList.length === 0 && !adding && (
        <div style={{ color: COLORS.muted, fontSize: "0.85rem", fontFamily: "'Zen Maru Gothic'" }}>まだ予約がありません。</div>
      )}

      {list.map((b) =>
        editingId === b.id ? (
          <div key={b.id} style={{ marginBottom: "1rem" }}>
            <BookingForm
              initial={b}
              eventBookings={rawList}
              onCancel={() => setEditingId(null)}
              onSave={(data) => {
                onUpdate({ ...b, ...data });
                setEditingId(null);
              }}
            />
          </div>
        ) : (
          <TicketCard
            key={b.id}
            left={
              <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.cream, fontSize: "1rem" }}>
                {b.name} <span style={{ color: COLORS.muted, fontWeight: 400 }}>({b.count}名)</span>
              </div>
            }
            right={
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button onClick={() => setEditingId(b.id)} style={iconBtnStyle}>編集</button>
                <button onClick={() => setDeleteTargetId(b.id)} style={{ ...iconBtnStyle, color: COLORS.danger }}>削除</button>
              </div>
            }
          >
            <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <Badge tone={b.seatType === "vip" || b.seatType === "counter" ? "gold" : "muted"}>
                {SEAT_TYPES[seatTypeOf(b)].label}
                {seatTypeOf(b) === "counter" && b.counterSeats && b.counterSeats.length > 0 &&
                  ` ${b.counterSeats.map((n) => CIRCLED_NUMBERS[n - 1]).join("")}`}
              </Badge>
              {b.seatNote && <Badge tone="muted">{b.seatNote}</Badge>}
            </div>
            {b.notes && (
              <div style={{ marginTop: "0.5rem", color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                {b.notes}
              </div>
            )}
          </TicketCard>
        )
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={<>「{deleteTarget.name}」の予約を削除します。<br />本当によろしいですか?</>}
          onConfirm={() => {
            onDelete(deleteTarget.id);
            setDeleteTargetId(null);
          }}
          onCancel={() => setDeleteTargetId(null)}
        />
      )}
    </div>
  );
}

const iconBtnStyle = {
  background: "none",
  border: `1px solid ${COLORS.line}`,
  color: COLORS.muted,
  borderRadius: "6px",
  padding: "0.3rem 0.6rem",
  fontSize: "0.75rem",
  fontFamily: "'Zen Maru Gothic'",
  cursor: "pointer",
};

/* ---------- 参加者ダッシュボード ---------- */

function ParticipantDashboard({ participant, events, bookings, onUpdateBookings, onLogout }) {
  const [activeEventId, setActiveEventId] = useState(null);
  const myEvents = events
    .filter((e) => (e.assigned || []).includes(participant.id))
    .sort((a, b) => a.date.localeCompare(b.date));

  const activeEvent = myEvents.find((e) => e.id === activeEventId);

  const addBooking = (b) => onUpdateBookings([...bookings, b]);
  const updateBooking = (b) => onUpdateBookings(bookings.map((x) => (x.id === b.id ? b : x)));
  const deleteBooking = (id) => onUpdateBookings(bookings.filter((x) => x.id !== id));

  if (activeEvent) {
    return (
      <div style={{ padding: "1.5rem 1.2rem", maxWidth: "620px", margin: "0 auto" }}>
        <TopBar title={formatDate(activeEvent.date)} onBack={() => setActiveEventId(null)} onLogout={onLogout} />
        <div style={{ color: COLORS.cream, fontFamily: "'Zen Maru Gothic'", fontWeight: 600, marginBottom: "1rem" }}>
          {activeEvent.note && <span style={{ color: COLORS.gold, fontWeight: 500 }}>{activeEvent.note}</span>}
        </div>
        <BookingList event={activeEvent} bookings={bookings} onAdd={addBooking} onUpdate={updateBooking} onDelete={deleteBooking} />
      </div>
    );
  }

  return (
    <div style={{ padding: "1.5rem 1.2rem", maxWidth: "620px", margin: "0 auto" }}>
      <TopBar title={`${participant.name} さん`} onLogout={onLogout} />
      {myEvents.length === 0 && (
        <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>
          担当の日程がまだ割り振られていません。管理者にご確認ください。
        </div>
      )}
      {myEvents.map((e) => {
        const count = bookings.filter((b) => b.eventId === e.id).length;
        return (
          <TicketCard
            key={e.id}
            left={
              <div>
                <div style={{ fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.85rem" }}>{formatDate(e.date)}</div>
                {e.note && (
                  <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.gold }}>{e.note}</div>
                )}
              </div>
            }
            right={<Badge tone="muted">予約 {count}件</Badge>}
          >
            <div style={{ marginTop: "0.7rem" }}>
              <Button onClick={() => setActiveEventId(e.id)}>開く</Button>
            </div>
          </TicketCard>
        );
      })}
    </div>
  );
}

/* ---------- 管理者ダッシュボード ---------- */

const EVENT_TITLE = "Fantastic Cabaret";

function AssignModal({ event, participants, onToggle, onClose }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const assigned = event.assigned || [];

  const filtered = participants.filter((p) => {
    if (filter !== "all" && p.type !== filter) return false;
    if (query && !p.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const assignedParticipants = participants.filter((p) => assigned.includes(p.id));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,12,8,0.72)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.surface,
          borderTop: `1px solid ${COLORS.line}`,
          borderRadius: "16px 16px 0 0",
          width: "100%",
          maxWidth: "560px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          padding: "1.1rem 1.1rem 1.4rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 700, color: COLORS.cream }}>担当者を選択・{formatDate(event.date)}</div>
          <button onClick={onClose} style={{ ...iconBtnStyle }}>閉じる</button>
        </div>

        {assignedParticipants.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.8rem" }}>
            {assignedParticipants.map((p) => (
              <button
                key={p.id}
                onClick={() => onToggle(p.id)}
                style={{
                  background: COLORS.gold,
                  color: COLORS.cream,
                  border: "none",
                  borderRadius: "999px",
                  padding: "0.25rem 0.7rem",
                  fontFamily: "'Zen Maru Gothic'",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {p.name} ✕
              </button>
            ))}
          </div>
        )}

        <input
          style={{ ...inputStyle, marginBottom: "0.7rem" }}
          placeholder="名前で検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.8rem" }}>
          {[
            { key: "all", label: "全員" },
            { key: "regular", label: "レギュラー" },
            { key: "guest", label: "ゲスト" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? COLORS.surface2 : "transparent",
                color: filter === f.key ? COLORS.cream : COLORS.muted,
                border: `1px solid ${COLORS.line}`,
                borderRadius: "999px",
                padding: "0.3rem 0.8rem",
                fontFamily: "'Zen Maru Gothic'",
                fontSize: "0.78rem",
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {filtered.length === 0 && <div style={{ color: COLORS.muted, fontSize: "0.85rem", fontFamily: "'Zen Maru Gothic'" }}>該当する出演者がいません。</div>}
          {filtered.map((p) => {
            const checked = assigned.includes(p.id);
            return (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  fontFamily: "'Zen Maru Gothic'",
                  fontSize: "0.9rem",
                  color: COLORS.cream,
                  background: checked ? COLORS.surface2 : "transparent",
                  borderRadius: "8px",
                  padding: "0.5rem 0.6rem",
                }}
              >
                <input type="checkbox" checked={checked} onChange={() => onToggle(p.id)} />
                {p.name}
                <Badge tone={p.type === "guest" ? "muted" : "gold"}>{p.type === "guest" ? "ゲスト" : "レギュラー"}</Badge>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventsTab({ events, participants, bookings, onUpdateEvents, onUpdateBookings }) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [assignEventId, setAssignEventId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteEventId, setDeleteEventId] = useState(null);

  const addEvent = () => {
    if (!date) return;
    onUpdateEvents([...events, { id: uid(), date, title: EVENT_TITLE, note: note.trim(), assigned: [] }]);
    setDate("");
    setNote("");
    setAdding(false);
  };

  const toggleAssign = (eventId, participantId) => {
    onUpdateEvents(
      events.map((e) => {
        if (e.id !== eventId) return e;
        const assigned = e.assigned || [];
        const next = assigned.includes(participantId)
          ? assigned.filter((id) => id !== participantId)
          : [...assigned, participantId];
        return { ...e, assigned: next };
      })
    );
  };

  const deleteEvent = (id) => {
    onUpdateEvents(events.filter((e) => e.id !== id));
    onUpdateBookings(bookings.filter((b) => b.eventId !== id));
    if (viewingId === id) setViewingId(null);
  };

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const assignEvent = events.find((e) => e.id === assignEventId);
  const viewingEvent = events.find((e) => e.id === viewingId);
  const deleteEventTarget = events.find((e) => e.id === deleteEventId);

  const addBooking = (b) => onUpdateBookings([...bookings, b]);
  const updateBooking = (b) => onUpdateBookings(bookings.map((x) => (x.id === b.id ? b : x)));
  const deleteBooking = (id) => onUpdateBookings(bookings.filter((x) => x.id !== id));

  if (viewingEvent) {
    const assignedNames = participants.filter((p) => (viewingEvent.assigned || []).includes(p.id));
    return (
      <div>
        <button onClick={() => setViewingId(null)} style={{ ...iconBtnStyle, marginBottom: "1rem" }}>← 日程一覧に戻る</button>
        <div style={{ marginBottom: "0.3rem", fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.9rem" }}>
          {formatDate(viewingEvent.date)}
        </div>
        {viewingEvent.note && (
          <div style={{ marginBottom: "0.6rem", fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.gold }}>{viewingEvent.note}</div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center", marginBottom: "1rem" }}>
          {assignedNames.length === 0 && (
            <span style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.8rem" }}>担当者は未設定です</span>
          )}
          {assignedNames.map((p) => (
            <Badge key={p.id} tone={p.type === "guest" ? "muted" : "gold"}>{p.name}</Badge>
          ))}
          <button onClick={() => setAssignEventId(viewingEvent.id)} style={iconBtnStyle}>担当者を編集</button>
        </div>
        <BookingList event={viewingEvent} bookings={bookings} onAdd={addBooking} onUpdate={updateBooking} onDelete={deleteBooking} />
        {assignEvent && (
          <AssignModal
            event={assignEvent}
            participants={participants}
            onToggle={(pid) => toggleAssign(assignEvent.id, pid)}
            onClose={() => setAssignEventId(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      {!adding && <Button onClick={() => setAdding(true)}>+ 日程を追加</Button>}
      {adding && (
        <div style={{ margin: "0.9rem 0" }}>
          <Panel>
            <Field label="日付">
              <input style={inputStyle} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="備考(任意・例:○○さんバースデー)">
              <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="通常公演なら空欄でOK" />
            </Field>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <Button onClick={addEvent}>追加する</Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>キャンセル</Button>
            </div>
          </Panel>
        </div>
      )}

      <Field label="日程で検索">
        <input style={inputStyle} placeholder="例:8/10 や バースデー" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </Field>

      <div style={{ marginTop: "1rem" }}>
        {sorted.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>まだ日程がありません。</div>}
        {sorted
          .filter((e) => {
            if (!searchQuery.trim()) return true;
            const q = searchQuery.trim().toLowerCase();
            return e.date.includes(q) || formatDate(e.date).toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q);
          })
          .map((e) => {
          const eventBookings = bookings.filter((b) => b.eventId === e.id);
          const assignedNames = participants.filter((p) => (e.assigned || []).includes(p.id));
          return (
            <div key={e.id} onClick={() => setViewingId(e.id)} style={{ cursor: "pointer" }}>
              <TicketCard
                left={
                  <div>
                    <div style={{ fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.85rem" }}>{formatDate(e.date)}</div>
                    {e.note && (
                      <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.gold }}>{e.note}</div>
                    )}
                  </div>
                }
                right={
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <SeatSummary bookingsForEvent={eventBookings} />
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setDeleteEventId(e.id);
                      }}
                      style={{ ...iconBtnStyle, color: COLORS.danger }}
                    >
                      削除
                    </button>
                  </div>
                }
              >
                <div style={{ marginTop: "0.7rem", display: "flex", flexWrap: "wrap", gap: "0.35rem", alignItems: "center" }}>
                  {assignedNames.length === 0 && (
                    <span style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.8rem" }}>担当者は未設定です</span>
                  )}
                  {assignedNames.map((p) => (
                    <Badge key={p.id} tone={p.type === "guest" ? "muted" : "gold"}>{p.name}</Badge>
                  ))}
                </div>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setAssignEventId(e.id);
                  }}
                  style={{ ...iconBtnStyle, marginTop: "0.6rem" }}
                >
                  担当者を編集
                </button>
              </TicketCard>
            </div>
          );
        })}
      </div>

      {assignEvent && (
        <AssignModal
          event={assignEvent}
          participants={participants}
          onToggle={(pid) => toggleAssign(assignEvent.id, pid)}
          onClose={() => setAssignEventId(null)}
        />
      )}

      {deleteEventTarget && (
        <ConfirmDialog
          message={<>{formatDate(deleteEventTarget.date)}{deleteEventTarget.note ? `(${deleteEventTarget.note})` : ""}の日程を削除します。<br />紐づく予約もすべて削除されます。本当によろしいですか?</>}
          onConfirm={() => {
            deleteEvent(deleteEventTarget.id);
            setDeleteEventId(null);
          }}
          onCancel={() => setDeleteEventId(null)}
        />
      )}
    </div>
  );
}

function RosterTab({ participants, onUpdateParticipants }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [type, setType] = useState("regular");

  const resetForm = () => {
    setName("");
    setPin("");
    setType("regular");
    setAdding(false);
    setEditingId(null);
  };

  const save = () => {
    if (!name.trim() || !pin.trim()) return;
    if (editingId) {
      onUpdateParticipants(
        participants.map((p) => (p.id === editingId ? { ...p, name: name.trim(), pin: pin.trim(), type } : p))
      );
    } else {
      onUpdateParticipants([...participants, { id: uid(), name: name.trim(), pin: pin.trim(), type }]);
    }
    resetForm();
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setName(p.name);
    setPin(p.pin);
    setType(p.type);
    setAdding(true);
  };

  const remove = (id) => onUpdateParticipants(participants.filter((p) => p.id !== id));

  return (
    <div>
      {!adding && <Button onClick={() => setAdding(true)}>+ 出演者を追加</Button>}
      {adding && (
        <div style={{ margin: "0.9rem 0" }}>
          <Panel>
            <Field label="名前">
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="個人PIN(4桁など)">
              <input style={inputStyle} value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="区分">
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <Button variant={type === "regular" ? "gold" : "ghost"} onClick={() => setType("regular")}>レギュラー</Button>
                <Button variant={type === "guest" ? "gold" : "ghost"} onClick={() => setType("guest")}>ゲスト</Button>
              </div>
            </Field>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <Button onClick={save}>{editingId ? "更新する" : "追加する"}</Button>
              <Button variant="ghost" onClick={resetForm}>キャンセル</Button>
            </div>
          </Panel>
        </div>
      )}

      <div style={{ marginTop: "1rem" }}>
        {participants.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>まだ登録がありません。</div>}
        {participants.map((p) => (
          <TicketCard
            key={p.id}
            left={
              <div>
                <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.cream }}>{p.name}</div>
                <div style={{ fontFamily: "'Zen Maru Gothic'", color: COLORS.muted, fontSize: "0.8rem" }}>PIN: {p.pin}</div>
              </div>
            }
            right={
              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <Badge tone={p.type === "guest" ? "muted" : "gold"}>{p.type === "guest" ? "ゲスト" : "レギュラー"}</Badge>
                <button onClick={() => startEdit(p)} style={iconBtnStyle}>編集</button>
                <button onClick={() => remove(p.id)} style={{ ...iconBtnStyle, color: COLORS.danger }}>削除</button>
              </div>
            }
          />
        ))}
      </div>
    </div>
  );
}

function AllBookingsTab({ events, participants, bookings, onUpdateBookings }) {
  const [dateQuery, setDateQuery] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [viewingId, setViewingId] = useState(null);

  const addBooking = (b) => onUpdateBookings([...bookings, b]);
  const updateBooking = (b) => onUpdateBookings(bookings.map((x) => (x.id === b.id ? b : x)));
  const deleteBooking = (id) => onUpdateBookings(bookings.filter((x) => x.id !== id));

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const viewingEvent = events.find((e) => e.id === viewingId);

  if (viewingEvent) {
    return (
      <div>
        <button onClick={() => setViewingId(null)} style={{ ...iconBtnStyle, marginBottom: "1rem" }}>← 予約管理に戻る</button>
        <div style={{ marginBottom: "0.3rem", fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.9rem" }}>
          {formatDate(viewingEvent.date)}
        </div>
        {viewingEvent.note && (
          <div style={{ marginBottom: "0.8rem", fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.gold }}>{viewingEvent.note}</div>
        )}
        <BookingList event={viewingEvent} bookings={bookings} onAdd={addBooking} onUpdate={updateBooking} onDelete={deleteBooking} />
      </div>
    );
  }

  // 予約者名でのフリー検索(全日程横断)
  if (nameQuery.trim()) {
    const q = nameQuery.trim().toLowerCase();
    const matches = bookings.filter((b) => b.name.toLowerCase().includes(q));
    return (
      <div>
        <Field label="予約者名で検索(全日程から)">
          <input style={inputStyle} value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} autoFocus />
        </Field>
        {matches.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>該当する予約が見つかりません。</div>}
        {matches.map((b) => {
          const ev = events.find((e) => e.id === b.eventId);
          return (
            <TicketCard
              key={b.id}
              left={
                <div>
                  <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.cream }}>{b.name} <span style={{ color: COLORS.muted }}>({b.count}名)</span></div>
                  {ev && <div style={{ fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.8rem", marginTop: "0.2rem" }}>{formatDate(ev.date)}{ev.note ? ` ・ ${ev.note}` : ""}</div>}
                </div>
              }
              right={
                ev && <button onClick={() => { setViewingId(ev.id); setNameQuery(""); }} style={iconBtnStyle}>この日程を開く</button>
              }
            />
          );
        })}
      </div>
    );
  }

  const filtered = sorted.filter((e) => {
    if (!dateQuery.trim()) return true;
    const q = dateQuery.trim().toLowerCase();
    return e.date.includes(q) || formatDate(e.date).toLowerCase().includes(q) || (e.note || "").toLowerCase().includes(q);
  });

  return (
    <div>
      <div
        style={{
          border: `1px solid ${COLORS.gold}`,
          borderRadius: "8px",
          padding: "0.7rem 0.9rem",
          marginBottom: "1rem",
          color: COLORS.cream,
          fontFamily: "'Zen Maru Gothic'",
          fontSize: "0.82rem",
          lineHeight: 1.6,
        }}
      >
        ⚠ VIPとカウンターなど座席種類が違うものに関して、まとめて入力ができません。2回に分けてご入力ください。
      </div>

      <Field label="予約者名で検索(全日程から)">
        <input style={inputStyle} placeholder="例:山田" value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} />
      </Field>
      <Field label="日程で絞り込み">
        <input style={inputStyle} placeholder="例:8/10 や バースデー" value={dateQuery} onChange={(e) => setDateQuery(e.target.value)} />
      </Field>

      {filtered.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>該当する日程がありません。</div>}
      {filtered.map((e) => {
        const list = bookings.filter((b) => b.eventId === e.id);
        const assignedNames = (participants || []).filter((p) => (e.assigned || []).includes(p.id));
        return (
          <div key={e.id} onClick={() => setViewingId(e.id)} style={{ cursor: "pointer" }}>
            <TicketCard
              left={
                <div>
                  <div style={{ fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.85rem" }}>{formatDate(e.date)}</div>
                  {e.note && <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.gold }}>{e.note}</div>}
                </div>
              }
              right={<SeatSummary bookingsForEvent={list} />}
            >
              {assignedNames.length > 0 && (
                <div style={{ marginTop: "0.6rem", display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {assignedNames.map((p) => (
                    <Badge key={p.id} tone={p.type === "guest" ? "muted" : "gold"}>{p.name}</Badge>
                  ))}
                </div>
              )}
            </TicketCard>
          </div>
        );
      })}
    </div>
  );
}

function SettingsTab({ adminPin, onUpdateAdminPin }) {
  const [pin, setPin] = useState(adminPin);
  const [saved, setSaved] = useState(false);
  return (
    <Panel>
      <Field label="管理者PIN(3名で共有)">
        <input style={pinInputStyle} value={pin} onChange={(e) => { setPin(e.target.value); setSaved(false); }} inputMode="numeric" />
      </Field>
      <Button
        onClick={() => {
          if (pin.trim()) {
            onUpdateAdminPin(pin.trim());
            setSaved(true);
          }
        }}
      >
        変更を保存
      </Button>
      {saved && <div style={{ color: COLORS.gold, fontSize: "0.8rem", marginTop: "0.6rem", fontFamily: "'Zen Maru Gothic'" }}>保存しました</div>}
    </Panel>
  );
}

function AdminDashboard({ store, onLogout }) {
  const [tab, setTab] = useState("events");
  const tabs = [
    { key: "events", label: "日程管理" },
    { key: "roster", label: "出演者名簿" },
    { key: "bookings", label: "予約管理" },
    { key: "settings", label: "設定" },
  ];
  return (
    <div style={{ padding: "1.5rem 1.2rem", maxWidth: "680px", margin: "0 auto" }}>
      <TopBar title="管理者" onLogout={onLogout} />
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: tab === t.key ? COLORS.gold : "transparent",
              color: tab === t.key ? COLORS.cream : COLORS.muted,
              border: `1px solid ${tab === t.key ? COLORS.gold : COLORS.line}`,
              borderRadius: "999px",
              padding: "0.4rem 0.9rem",
              fontFamily: "'Zen Maru Gothic'",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "events" && (
        <EventsTab
          events={store.events}
          participants={store.participants}
          bookings={store.bookings}
          onUpdateEvents={store.updateEvents}
          onUpdateBookings={store.updateBookings}
        />
      )}
      {tab === "roster" && <RosterTab participants={store.participants} onUpdateParticipants={store.updateParticipants} />}
      {tab === "bookings" && (
        <AllBookingsTab events={store.events} participants={store.participants} bookings={store.bookings} onUpdateBookings={store.updateBookings} />
      )}
      {tab === "settings" && <SettingsTab adminPin={store.adminPin} onUpdateAdminPin={store.updateAdminPin} />}
    </div>
  );
}

/* ---------- ルート ---------- */

export default function App() {
  const store = useStorage();
  const [screen, setScreen] = useState("landing");
  const [participant, setParticipant] = useState(null);

  const goLanding = () => {
    setScreen("landing");
    setParticipant(null);
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.cream }}>
      <style>{FONT_IMPORT}</style>

      {store.loading && (
        <div style={{ padding: "3rem", textAlign: "center", color: COLORS.muted, fontFamily: "'Zen Maru Gothic'" }}>読み込み中…</div>
      )}

      {!store.loading && store.error && (
        <div style={{ background: COLORS.danger, color: "#fff", padding: "0.6rem 1rem", fontFamily: "'Zen Maru Gothic'", fontSize: "0.85rem" }}>
          {store.error}
        </div>
      )}

      {!store.loading && screen === "landing" && <Landing onSelectRole={(r) => setScreen(r === "admin" ? "adminLogin" : "participantLogin")} />}

      {!store.loading && screen === "adminLogin" && (
        <AdminLogin
          adminPin={store.adminPin}
          onBack={goLanding}
          onRecover={() => store.updateAdminPin("1234")}
          onSuccess={() => setScreen("admin")}
        />
      )}

      {!store.loading && screen === "admin" && <AdminDashboard store={store} onLogout={goLanding} />}

      {!store.loading && screen === "participantLogin" && (
        <ParticipantLogin
          participants={store.participants}
          onBack={goLanding}
          onSuccess={(p) => {
            setParticipant(p);
            setScreen("participant");
          }}
        />
      )}

      {!store.loading && screen === "participant" && participant && (
        <ParticipantDashboard
          participant={participant}
          events={store.events}
          bookings={store.bookings}
          onUpdateBookings={store.updateBookings}
          onLogout={goLanding}
        />
      )}
    </div>
  );
}
