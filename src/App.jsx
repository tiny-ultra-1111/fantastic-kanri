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
  undecided: { label: "未指定", priceLabel: "", cap: null, order: 1 },
};

const CIRCLED_NUMBERS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

function seatTypeOf(b) {
  return SEAT_TYPES[b.seatType] ? b.seatType : "undecided";
}

/* カウンターの使用済み座席番号(1〜8)を集計(編集中の予約自身は除く)。
   カウンター指定席(番号を指定した予約)だけを対象にする。 */
function usedCounterSeats(list, excludeId) {
  const used = new Set();
  list
    .filter((b) => seatTypeOf(b) === "counter" && b.id !== excludeId)
    .forEach((b) => (b.counterSeats || []).forEach((n) => used.add(n)));
  return used;
}

/* 「未指定」の予約に、カウンター指定席で埋まっていない番号を先着順で自動的に割り当てる。
   カウンター指定席が増える・減るたびに、この計算をその場でやり直すことで
   番号が自動的にずれていく(データとしては保存しない・常に計算し直す)。
   人数分の枠が足りない場合は、入りきった分だけ座席番号を割り当て、
   残りは自動的に「丸椅子」扱い(overflow)にする(1組の予約が両方にまたがることがある)。 */
function computeUndecidedAssignments(list) {
  const reserved = usedCounterSeats(list);
  let available = [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => !reserved.has(n));
  const undecidedBookings = list
    .filter((b) => seatTypeOf(b) === "undecided")
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const assignments = new Map();
  undecidedBookings.forEach((b) => {
    const need = b.count || 0;
    const take = Math.min(need, available.length);
    const seats = available.slice(0, take);
    available = available.slice(take);
    assignments.set(b.id, { seats, overflow: need - take });
  });
  return assignments;
}

/* 予約一覧の並び順:
   VIP → (カウンター指定席+未指定のうちカウンターに座る分を番号順に混ぜて) → 丸椅子(はみ出し分含む)。
   伝票を書く順番(VIP→カウンター1〜8→丸椅子)に合わせている。 */
function sortAndAnnotate(list) {
  const assignments = computeUndecidedAssignments(list);

  const groupOf = (b) => {
    const t = seatTypeOf(b);
    if (t === "vip") return 0;
    if (t === "counter") return 1;
    if (t === "undecided") {
      const a = assignments.get(b.id);
      return a && a.seats.length > 0 ? 1 : 2;
    }
    return 2; // 丸椅子(旧データ含む)
  };
  const seatKeyOf = (b) => {
    const t = seatTypeOf(b);
    if (t === "counter") {
      return Math.min(...(b.counterSeats && b.counterSeats.length ? b.counterSeats : [99]));
    }
    if (t === "undecided") {
      const a = assignments.get(b.id);
      if (a && a.seats.length > 0) return Math.min(...a.seats);
    }
    return 99;
  };

  return [...list].sort((a, b) => {
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga !== gb) return ga - gb;
    if (ga === 1) {
      const ka = seatKeyOf(a);
      const kb = seatKeyOf(b);
      if (ka !== kb) return ka - kb;
    }
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

/* 種別ごとの合計人数(イベント単位のサマリー表示に使う)。
   「未指定」のうちカウンターに座れた人数はカウンターの合計に、
   はみ出した人数は丸椅子の合計に含める。 */
function seatTypeTotals(list) {
  const totals = { vip: 0, counter: 0, stool: 0 };
  const assignments = computeUndecidedAssignments(list);
  list.forEach((b) => {
    const t = seatTypeOf(b);
    if (t === "vip") {
      totals.vip += b.count || 0;
    } else if (t === "counter") {
      totals.counter += b.count || 0;
    } else if (t === "undecided") {
      const a = assignments.get(b.id) || { seats: [], overflow: b.count || 0 };
      totals.counter += a.seats.length;
      totals.stool += a.overflow;
    } else {
      totals.stool += b.count || 0;
    }
  });
  return { ...totals, counterOccupancy: totals.counter };
}

/* VIPの残り枠を計算(編集中の予約自身は除く) */
function remainingCapacity(list, type, excludeId) {
  const cap = SEAT_TYPES[type].cap;
  if (cap == null) return Infinity;
  const used = list
    .filter((b) => seatTypeOf(b) === type && b.id !== excludeId)
    .reduce((s, b) => s + (b.count || 0), 0);
  return cap - used;
}

/* カウンター指定席(番号予約)の残り枠。実際に番号を予約した分だけを数える
   (「未指定」は上限なく選べるため、ここには含めない)。 */
function remainingExplicitCounter(list, excludeId) {
  const used = list
    .filter((b) => seatTypeOf(b) === "counter" && b.id !== excludeId)
    .reduce((s, b) => s + (b.count || 0), 0);
  return SEAT_TYPES.counter.cap - used;
}

/* 指定の開始番号からcount席分、連番で空いているかを判定 */
function canFitConsecutive(used, start, count) {
  for (let n = start; n < start + count; n++) {
    if (n > 8 || used.has(n)) return false;
  }
  return true;
}

/* ==== 検索: ひらがな・カタカナ・ローマ字を横断してヒットさせるためのヘルパー ====
   ・カタカナは内部でひらがなに変換して比較するので、ひらがな/カタカナはどちらで打っても一致する
   ・ローマ字は「ひらがな登録の名前」に対してのみ対応(漢字の読みまでは判定できないため) */
function katakanaToHiragana(str) {
  return str.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

const ROMAJI_MAP = {
  "きゃ": "kya", "きゅ": "kyu", "きょ": "kyo",
  "しゃ": "sha", "しゅ": "shu", "しょ": "sho",
  "ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho",
  "にゃ": "nya", "にゅ": "nyu", "にょ": "nyo",
  "ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo",
  "みゃ": "mya", "みゅ": "myu", "みょ": "myo",
  "りゃ": "rya", "りゅ": "ryu", "りょ": "ryo",
  "ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo",
  "じゃ": "ja", "じゅ": "ju", "じょ": "jo",
  "びゃ": "bya", "びゅ": "byu", "びょ": "byo",
  "ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo",
  "あ": "a", "い": "i", "う": "u", "え": "e", "お": "o",
  "か": "ka", "き": "ki", "く": "ku", "け": "ke", "こ": "ko",
  "さ": "sa", "し": "shi", "す": "su", "せ": "se", "そ": "so",
  "た": "ta", "ち": "chi", "つ": "tsu", "て": "te", "と": "to",
  "な": "na", "に": "ni", "ぬ": "nu", "ね": "ne", "の": "no",
  "は": "ha", "ひ": "hi", "ふ": "fu", "へ": "he", "ほ": "ho",
  "ま": "ma", "み": "mi", "む": "mu", "め": "me", "も": "mo",
  "や": "ya", "ゆ": "yu", "よ": "yo",
  "ら": "ra", "り": "ri", "る": "ru", "れ": "re", "ろ": "ro",
  "わ": "wa", "ゐ": "wi", "ゑ": "we", "を": "wo", "ん": "n",
  "が": "ga", "ぎ": "gi", "ぐ": "gu", "げ": "ge", "ご": "go",
  "ざ": "za", "じ": "ji", "ず": "zu", "ぜ": "ze", "ぞ": "zo",
  "だ": "da", "ぢ": "ji", "づ": "zu", "で": "de", "ど": "do",
  "ば": "ba", "び": "bi", "ぶ": "bu", "べ": "be", "ぼ": "bo",
  "ぱ": "pa", "ぴ": "pi", "ぷ": "pu", "ぺ": "pe", "ぽ": "po",
};

function hiraganaToRomaji(str) {
  let result = "";
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (ch === "っ" && i + 1 < str.length) {
      const nextRomaji = ROMAJI_MAP[str.slice(i + 1, i + 3)] || ROMAJI_MAP[str[i + 1]];
      if (nextRomaji) {
        result += nextRomaji[0];
        i += 1;
        continue;
      }
    }
    const two = str.slice(i, i + 2);
    if (ROMAJI_MAP[two]) {
      result += ROMAJI_MAP[two];
      i += 2;
      continue;
    }
    if (ROMAJI_MAP[ch]) {
      result += ROMAJI_MAP[ch];
      i += 1;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

/* text(登録されている文字列)がrawQuery(入力された検索語)にヒットするか判定する。
   ひらがな/カタカナ/(かな登録の名前に対する)ローマ字での検索に対応。 */
function matchesQuery(text, rawQuery) {
  if (!rawQuery || !rawQuery.trim()) return true;
  if (!text) return false;
  const query = rawQuery.trim().toLowerCase();
  if (text.toLowerCase().includes(query)) return true;
  const textHira = katakanaToHiragana(text).toLowerCase();
  const queryHira = katakanaToHiragana(rawQuery.trim()).toLowerCase();
  if (textHira.includes(queryHira)) return true;
  const textRomaji = hiraganaToRomaji(textHira);
  if (textRomaji.includes(query)) return true;
  return false;
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
    } catch (err) {
      console.error(`[読み込みエラー] key="${key}":`, err);
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
        console.error("[初期読み込みエラー]", e);
        setError("データの読み込みに失敗しました。再読み込みしてください。");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadKey]);

  const persist = useCallback(async (key, value) => {
    try {
      await window.storage.set(key, JSON.stringify(value), true);
      setError("");
    } catch (err) {
      console.error(`[保存エラー] key="${key}":`, err);
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
      <Badge tone="gold">カウンター {totals.counterOccupancy}名</Badge>
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
        <div style={{ color: COLORS.cream, fontFamily: "'Zen Maru Gothic'", fontSize: "0.8rem", letterSpacing: "0.15em", marginBottom: "0.4rem" }}>
          FANTASTIC CABARET
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem", width: "100%", maxWidth: "320px" }}>
        <Button full onClick={() => onSelectRole("participant")}>
          出演者としてログイン
        </Button>
        <Button full variant="ghost" onClick={() => onSelectRole("admin")}>
          管理者としてログイン
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
  const [query, setQuery] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");

  const selected = participants.find((p) => p.id === selectedId);

  if (!selectedId) {
    const matches = query.trim()
      ? participants.filter((p) => matchesQuery(p.name, query))
      : participants;
    return (
      <div style={{ padding: "1.5rem 1.2rem", maxWidth: "420px", margin: "0 auto" }}>
        <TopBar title="出演者ログイン" onBack={onBack} />
        <div style={{ color: COLORS.cream, fontFamily: "'Zen Maru Gothic'", fontSize: "0.8rem", lineHeight: 1.7, marginBottom: "1rem" }}>
          お名前をご選択いただきログインしてください。初期パスワードは0000です。
          <br />
          ※お名前が見当たらない場合はタイニーまでご連絡ください
        </div>
        <Panel>
          <Field label="名前で検索">
            <input
              style={inputStyle}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="名前を入力してください"
              autoFocus
            />
          </Field>
          {participants.length === 0 && (
            <div style={{ color: COLORS.muted, fontSize: "0.85rem" }}>まだ名簿が登録されていません。管理者にご確認ください。</div>
          )}
          {participants.length > 0 && matches.length === 0 && (
            <div style={{ color: COLORS.muted, fontSize: "0.85rem" }}>該当する名前が見つかりません。</div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {matches.map((p) => (
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
        <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.75rem", marginTop: "0.9rem" }}>
          その他操作方法のご要望・ご質問はタイニーまで
        </div>
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
  const [showChart, setShowChart] = useState(false);
  const [chartMissing, setChartMissing] = useState(false);

  const list = eventBookings || [];
  const remainingVip = remainingCapacity(list, "vip", initial?.id);
  const remainingCounterExplicit = remainingExplicitCounter(list, initial?.id);
  const usedSeats = usedCounterSeats(list, initial?.id);
  const n = Number(count) || 1;

  const options = [
    { key: "vip", remaining: remainingVip, capLabel: SEAT_TYPES.vip.cap },
    { key: "counter", remaining: remainingCounterExplicit, capLabel: SEAT_TYPES.counter.cap },
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
        <button
          type="button"
          onClick={() => setShowChart(!showChart)}
          style={{ ...iconBtnStyle, marginBottom: "0.6rem" }}
        >
          {showChart ? "座席表を隠す" : "座席表を見る"}
        </button>
        {showChart && (
          <div style={{ marginBottom: "0.8rem" }}>
            {chartMissing ? (
              <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.8rem" }}>
                座席表の画像がまだ設定されていません。
              </div>
            ) : (
              <img
                src="/zaseki.JPG"
                alt="座席表"
                onError={() => setChartMissing(true)}
                style={{ width: "100%", borderRadius: "8px", border: `1px solid ${COLORS.line}` }}
              />
            )}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.6rem" }}>
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
                {o.capLabel != null && (
                  <div style={{ fontWeight: 400, fontSize: "0.72rem", marginTop: "0.15rem" }}>
                    残り{Math.max(o.remaining, 0)}/{o.capLabel}
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
  const undecidedAssignments = computeUndecidedAssignments(rawList);
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
              {seatTypeOf(b) === "undecided" ? (
                (() => {
                  const a = undecidedAssignments.get(b.id) || { seats: [], overflow: b.count || 0 };
                  return (
                    <>
                      {a.seats.length > 0 && (
                        <Badge tone="gold">
                          カウンター {a.seats.map((n) => CIRCLED_NUMBERS[n - 1]).join("")}(指定無し)
                        </Badge>
                      )}
                      {a.overflow > 0 && <Badge tone="muted">丸椅子({a.overflow}名)</Badge>}
                    </>
                  );
                })()
              ) : (
                <Badge tone={b.seatType === "vip" || b.seatType === "counter" ? "gold" : "muted"}>
                  {SEAT_TYPES[seatTypeOf(b)].label}
                  {seatTypeOf(b) === "counter" && b.counterSeats && b.counterSeats.length > 0 &&
                    ` ${b.counterSeats.map((n) => CIRCLED_NUMBERS[n - 1]).join("")}`}
                </Badge>
              )}
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

function ParticipantSettingsTab({ participant, participants, onUpdateParticipants }) {
  const self = participants.find((p) => p.id === participant.id) || participant;
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = () => {
    setSaved(false);
    if (currentPin !== self.pin) {
      setError("現在のPINが違います");
      return;
    }
    if (!newPin.trim()) {
      setError("新しいPINを入力してください");
      return;
    }
    if (newPin !== confirmPin) {
      setError("新しいPIN(確認)が一致しません");
      return;
    }
    onUpdateParticipants(participants.map((p) => (p.id === self.id ? { ...p, pin: newPin.trim() } : p)));
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    setError("");
    setSaved(true);
  };

  return (
    <Panel>
      <div style={{ color: COLORS.cream, fontFamily: "'Zen Maru Gothic'", fontWeight: 600, marginBottom: "0.9rem" }}>
        {self.name} さんの個人PIN変更
      </div>
      <Field label="現在のPIN">
        <input style={pinInputStyle} value={currentPin} onChange={(e) => { setCurrentPin(e.target.value); setError(""); }} inputMode="numeric" />
      </Field>
      <Field label="新しいPIN">
        <input style={pinInputStyle} value={newPin} onChange={(e) => { setNewPin(e.target.value); setError(""); }} inputMode="numeric" />
      </Field>
      <Field label="新しいPIN(確認)">
        <input style={pinInputStyle} value={confirmPin} onChange={(e) => { setConfirmPin(e.target.value); setError(""); }} inputMode="numeric" />
      </Field>
      {error && <div style={{ color: COLORS.danger, fontSize: "0.8rem", marginBottom: "0.8rem" }}>{error}</div>}
      <Button onClick={submit}>変更を保存</Button>
      {saved && <div style={{ color: COLORS.gold, fontSize: "0.8rem", marginTop: "0.6rem", fontFamily: "'Zen Maru Gothic'" }}>変更しました</div>}
    </Panel>
  );
}

function ParticipantDashboard({ participant, participants, onUpdateParticipants, events, bookings, onUpdateBookings, onLogout }) {
  const [tab, setTab] = useState("bookings");
  const myEvents = events.filter((e) => (e.assigned || []).includes(participant.id));

  const tabs = [
    { key: "bookings", label: "予約管理" },
    { key: "settings", label: "設定" },
  ];

  return (
    <div style={{ padding: "1.5rem 1.2rem", maxWidth: "680px", margin: "0 auto" }}>
      <TopBar title={`${participant.name} さん`} onLogout={onLogout} />
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

      {tab === "bookings" && (
        myEvents.length === 0 ? (
          <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>
            担当の日程がまだ割り振られていません。管理者にご確認ください。
          </div>
        ) : (
          <AllBookingsTab events={myEvents} participants={participants} bookings={bookings} onUpdateBookings={onUpdateBookings} />
        )
      )}
      {tab === "settings" && (
        <ParticipantSettingsTab participant={participant} participants={participants} onUpdateParticipants={onUpdateParticipants} />
      )}
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
    if (query && !matchesQuery(p.name, query)) return false;
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

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7);
}
function monthLabelOf(key) {
  const [y, m] = key.split("-");
  return `${y}年${parseInt(m, 10)}月`;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

/* タップで複数日を選択(もう一度タップで解除)できるカレンダー */
function MiniCalendar({ year, month, selectedDates, onToggleDate, onPrevMonth, onNextMonth }) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <button onClick={onPrevMonth} style={iconBtnStyle}>← 前の月</button>
        <div style={{ color: COLORS.gold, fontFamily: "'Zen Maru Gothic'", fontWeight: 700 }}>
          {year}年{month + 1}月
        </div>
        <button onClick={onNextMonth} style={iconBtnStyle}>次の月 →</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.3rem", marginBottom: "0.3rem" }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ textAlign: "center", color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.75rem" }}>
            {w}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.3rem" }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
          const selected = selectedDates.includes(dateStr);
          return (
            <button
              key={i}
              onClick={() => onToggleDate(dateStr)}
              style={{
                aspectRatio: "1",
                background: selected ? COLORS.gold : "transparent",
                color: COLORS.cream,
                border: `1px solid ${selected ? COLORS.gold : COLORS.line}`,
                borderRadius: "6px",
                fontFamily: "'Zen Maru Gothic'",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EventsTab({ events, participants, bookings, onUpdateEvents, onUpdateBookings }) {
  const [adding, setAdding] = useState(false);
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [selectedDates, setSelectedDates] = useState([]);
  const [note, setNote] = useState("");
  const [assignEventId, setAssignEventId] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteEventId, setDeleteEventId] = useState(null);
  const [editingEvent, setEditingEvent] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editNote, setEditNote] = useState("");

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const monthKeys = Array.from(new Set(sorted.map((e) => monthKeyOf(e.date)))).sort((a, b) => b.localeCompare(a));
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeys[0] || "");

  const toggleDate = (dateStr) => {
    setSelectedDates((prev) => (prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]));
  };

  const changeMonth = (delta) => {
    let m = calMonth + delta;
    let y = calYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setCalMonth(m);
    setCalYear(y);
  };

  const addEvent = () => {
    const existingDates = new Set(events.map((e) => e.date));
    const validDates = Array.from(new Set(selectedDates)).filter((d) => !existingDates.has(d));
    if (validDates.length === 0) return;
    const newEvents = validDates.map((d) => ({ id: uid(), date: d, title: EVENT_TITLE, note: note.trim(), assigned: [] }));
    onUpdateEvents([...events, ...newEvents]);
    setSelectedMonth(monthKeyOf(validDates.sort()[0]));
    setSelectedDates([]);
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

  const updateEventDetails = (id, patch) => {
    onUpdateEvents(events.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

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
        <button onClick={() => { setViewingId(null); setEditingEvent(false); }} style={{ ...iconBtnStyle, marginBottom: "1rem" }}>← 日程一覧に戻る</button>

        {editingEvent ? (
          <div style={{ marginBottom: "1rem" }}>
            <Panel>
              <Field label="日付">
                <input style={inputStyle} type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </Field>
              <Field label="備考(任意)">
                <input style={inputStyle} value={editNote} onChange={(e) => setEditNote(e.target.value)} />
              </Field>
              <div style={{ display: "flex", gap: "0.6rem" }}>
                <Button
                  onClick={() => {
                    if (!editDate) return;
                    updateEventDetails(viewingEvent.id, { date: editDate, note: editNote.trim() });
                    setEditingEvent(false);
                  }}
                >
                  保存する
                </Button>
                <Button variant="ghost" onClick={() => setEditingEvent(false)}>キャンセル</Button>
              </div>
            </Panel>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
            <div>
              <div style={{ fontFamily: "'Zen Maru Gothic'", color: COLORS.gold, fontSize: "0.9rem" }}>{formatDate(viewingEvent.date)}</div>
              {viewingEvent.note && (
                <div style={{ fontFamily: "'Zen Maru Gothic'", fontWeight: 600, color: COLORS.gold }}>{viewingEvent.note}</div>
              )}
            </div>
            <button
              onClick={() => {
                setEditDate(viewingEvent.date);
                setEditNote(viewingEvent.note || "");
                setEditingEvent(true);
              }}
              style={iconBtnStyle}
            >
              日程を編集
            </button>
          </div>
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

  const searching = !!searchQuery.trim();
  const visibleEvents = searching
    ? sorted.filter((e) => e.date.includes(searchQuery.trim()) || matchesQuery(formatDate(e.date), searchQuery) || matchesQuery(e.note, searchQuery))
    : sorted.filter((e) => monthKeyOf(e.date) === selectedMonth);

  return (
    <div>
      {!adding && <Button onClick={() => setAdding(true)}>+ 日程を追加</Button>}
      {adding && (
        <div style={{ margin: "0.9rem 0" }}>
          <Panel>
            <Field label={`日付をタップして選択(${selectedDates.length}件選択中・もう一度タップで解除)`}>
              <MiniCalendar
                year={calYear}
                month={calMonth}
                selectedDates={selectedDates}
                onToggleDate={toggleDate}
                onPrevMonth={() => changeMonth(-1)}
                onNextMonth={() => changeMonth(1)}
              />
              {selectedDates.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.7rem" }}>
                  {[...selectedDates].sort().map((d) => (
                    <Badge key={d} tone="gold">{formatDate(d)}</Badge>
                  ))}
                </div>
              )}
            </Field>
            <Field label="備考(任意・すべての日程に共通で入ります)">
              <input style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="通常公演なら空欄でOK" />
            </Field>
            <div style={{ display: "flex", gap: "0.6rem" }}>
              <Button onClick={addEvent}>追加する</Button>
              <Button variant="ghost" onClick={() => { setAdding(false); setSelectedDates([]); setNote(""); }}>キャンセル</Button>
            </div>
          </Panel>
        </div>
      )}

      <Field label="日程で検索(全月から検索します)">
        <input style={inputStyle} placeholder="例:8/10 や バースデー" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </Field>

      {!searching && monthKeys.length > 0 && (
        <Field label="表示する月">
          <select
            style={inputStyle}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {monthKeys.map((k) => (
              <option key={k} value={k}>{monthLabelOf(k)}</option>
            ))}
          </select>
        </Field>
      )}

      <div style={{ marginTop: "1rem" }}>
        {sorted.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>まだ日程がありません。</div>}
        {sorted.length > 0 && visibleEvents.length === 0 && (
          <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>該当する日程がありません。</div>
        )}
        {visibleEvents.map((e) => {
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

function ParticipantForm({ initial, participants, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [pin, setPin] = useState(initial?.pin || "0000");
  const [type, setType] = useState(initial?.type || "regular");

  const isDuplicateName = name.trim()
    ? participants.some((p) => p.id !== initial?.id && p.name.trim() === name.trim())
    : false;

  const submit = () => {
    if (!name.trim() || !pin.trim() || isDuplicateName) return;
    onSave({ name: name.trim(), pin: pin.trim(), type });
  };

  return (
    <Panel>
      <Field label="名前">
        <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      {isDuplicateName && (
        <div style={{ color: COLORS.danger, fontSize: "0.8rem", marginTop: "-0.5rem", marginBottom: "0.8rem" }}>
          同じ名前のユーザーが存在します
        </div>
      )}
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
        <Button onClick={submit} disabled={isDuplicateName}>{initial ? "更新する" : "追加する"}</Button>
        <Button variant="ghost" onClick={onCancel}>キャンセル</Button>
      </div>
    </Panel>
  );
}

function RosterTab({ participants, onUpdateParticipants }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const addParticipant = (data) => {
    onUpdateParticipants([...participants, { id: uid(), ...data }]);
    setAdding(false);
  };

  const updateParticipant = (id, data) => {
    onUpdateParticipants(participants.map((p) => (p.id === id ? { ...p, ...data } : p)));
    setEditingId(null);
  };

  const remove = (id) => onUpdateParticipants(participants.filter((p) => p.id !== id));

  const filtered = participants
    .filter((p) => typeFilter === "all" || p.type === typeFilter)
    .filter((p) => matchesQuery(p.name, searchQuery));

  return (
    <div>
      {!adding && (
        <Button
          onClick={() => {
            setEditingId(null);
            setAdding(true);
          }}
        >
          + 出演者を追加
        </Button>
      )}
      {adding && (
        <div style={{ margin: "0.9rem 0" }}>
          <ParticipantForm participants={participants} onSave={addParticipant} onCancel={() => setAdding(false)} />
        </div>
      )}

      <Field label="名前で検索">
        <input style={inputStyle} placeholder="例:山田" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </Field>

      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "1rem" }}>
        {[
          { key: "all", label: "全て表示" },
          { key: "regular", label: "レギュラー" },
          { key: "guest", label: "ゲスト" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            style={{
              background: typeFilter === f.key ? COLORS.surface2 : "transparent",
              color: typeFilter === f.key ? COLORS.cream : COLORS.muted,
              border: `1px solid ${COLORS.line}`,
              borderRadius: "999px",
              padding: "0.35rem 0.85rem",
              fontFamily: "'Zen Maru Gothic'",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: "1rem" }}>
        {filtered.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>該当する出演者がいません。</div>}
        {filtered.map((p) =>
          editingId === p.id ? (
            <div key={p.id} style={{ marginBottom: "0.9rem" }}>
              <ParticipantForm
                initial={p}
                participants={participants}
                onSave={(data) => updateParticipant(p.id, data)}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
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
                  <button
                    onClick={() => {
                      setAdding(false);
                      setEditingId(p.id);
                    }}
                    style={iconBtnStyle}
                  >
                    編集
                  </button>
                  <button onClick={() => remove(p.id)} style={{ ...iconBtnStyle, color: COLORS.danger }}>削除</button>
                </div>
              }
            />
          )
        )}
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
  const monthKeys = Array.from(new Set(sorted.map((e) => monthKeyOf(e.date)))).sort((a, b) => b.localeCompare(a));
  const [selectedMonth, setSelectedMonth] = useState(() => monthKeys[0] || "");
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
    const matches = bookings.filter((b) => matchesQuery(b.name, nameQuery));
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

  const dateSearching = !!dateQuery.trim();
  const visibleEvents = dateSearching
    ? sorted.filter((e) => e.date.includes(dateQuery.trim()) || matchesQuery(formatDate(e.date), dateQuery) || matchesQuery(e.note, dateQuery))
    : sorted.filter((e) => monthKeyOf(e.date) === selectedMonth);

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
      <Field label="日程で絞り込み(全月から検索します)">
        <input style={inputStyle} placeholder="例:8/10 や バースデー" value={dateQuery} onChange={(e) => setDateQuery(e.target.value)} />
      </Field>

      {!dateSearching && monthKeys.length > 0 && (
        <Field label="表示する月">
          <select style={inputStyle} value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)}>
            {monthKeys.map((k) => (
              <option key={k} value={k}>{monthLabelOf(k)}</option>
            ))}
          </select>
        </Field>
      )}

      {sorted.length === 0 && <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>まだ日程がありません。</div>}
      {sorted.length > 0 && visibleEvents.length === 0 && (
        <div style={{ color: COLORS.muted, fontFamily: "'Zen Maru Gothic'", fontSize: "0.9rem" }}>該当する日程がありません。</div>
      )}
      {visibleEvents.map((e) => {
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
          participants={store.participants}
          onUpdateParticipants={store.updateParticipants}
          events={store.events}
          bookings={store.bookings}
          onUpdateBookings={store.updateBookings}
          onLogout={goLanding}
        />
      )}
    </div>
  );
}
