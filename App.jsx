import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Sun, Moon, Soup, Cookie, Camera, Plus, Trash2, X, ChevronLeft, ChevronRight,
  Calendar as CalendarIcon, User, Sparkles, Loader2, Check, UtensilsCrossed,
  AlertCircle, Flower2, MessageCircle, Send, Settings as SettingsIcon, Eye, EyeOff, Pencil,
} from "lucide-react";

/* ---------------------------------- constants ---------------------------------- */

const MEAL_TYPES = [
  { key: "breakfast", label: "아침", icon: Sun, time: "06:00 - 10:00" },
  { key: "lunch", label: "점심", icon: Soup, time: "11:00 - 14:00" },
  { key: "dinner", label: "저녁", icon: Moon, time: "17:00 - 20:00" },
  { key: "snack", label: "간식 / 추가 섭취", icon: Cookie, time: "수시" },
];

const ACTIVITY_LEVELS = [
  { value: "1.2", label: "거의 안 함", desc: "운동을 거의 하지 않음" },
  { value: "1.375", label: "가벼운 활동", desc: "주 1~3일 가벼운 운동" },
  { value: "1.55", label: "보통 활동", desc: "주 3~5일 운동" },
  { value: "1.725", label: "활발한 활동", desc: "주 6~7일 운동" },
  { value: "1.9", label: "매우 활발", desc: "매일 강도 높은 운동" },
];

const GOALS = [
  { value: "lose", label: "체중 감량", delta: -500 },
  { value: "maintain", label: "체중 유지", delta: 0 },
  { value: "gain", label: "체중 증량", delta: 300 },
];

/* ---------------------------------- helpers ---------------------------------- */

function pad(n) {
  return n.toString().padStart(2, "0");
}
function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function formatDisplayDate(s) {
  const d = parseDateStr(s);
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}
function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function calcBMR(profile) {
  const { gender, age, height, weight } = profile;
  const base = 10 * weight + 6.25 * height - 5 * age;
  return gender === "male" ? base + 5 : base - 161;
}
function calcTargetCalories(profile) {
  const bmr = calcBMR(profile);
  const tdee = bmr * parseFloat(profile.activityLevel);
  const goal = GOALS.find((g) => g.value === profile.goal) || GOALS[1];
  return Math.round(tdee + goal.delta);
}
function computeTotals(meals) {
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  Object.values(meals || {}).forEach((arr) =>
    (arr || []).forEach((it) => {
      calories += Number(it.calories) || 0;
      protein += Number(it.protein) || 0;
      carbs += Number(it.carbs) || 0;
      fat += Number(it.fat) || 0;
    })
  );
  return { calories: Math.round(calories), protein, carbs, fat };
}

function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------- local storage ---------------------------------- */
/* Standalone app: real browser storage (not Claude.ai's artifact storage). Everything
   stays only on this device/browser. */

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* storage full or unavailable */
  }
}

async function loadProfile() {
  const v = lsGet("pomanilgi:profile");
  return v ? JSON.parse(v) : null;
}
async function saveProfile(profile) {
  lsSet("pomanilgi:profile", JSON.stringify(profile));
}
async function loadApiKey() {
  return lsGet("pomanilgi:apiKey") || "";
}
async function saveApiKey(key) {
  lsSet("pomanilgi:apiKey", key || "");
}
async function loadMeals(dateStr) {
  const v = lsGet(`pomanilgi:meals:${dateStr}`);
  return v ? JSON.parse(v) : { breakfast: [], lunch: [], dinner: [], snack: [] };
}
async function saveMeals(dateStr, meals) {
  lsSet(`pomanilgi:meals:${dateStr}`, JSON.stringify(meals));
}
async function loadChat(dateStr) {
  const v = lsGet(`pomanilgi:chat:${dateStr}`);
  return v ? JSON.parse(v) : [];
}
async function saveChat(dateStr, messages) {
  lsSet(`pomanilgi:chat:${dateStr}`, JSON.stringify(messages));
}
async function loadMonthTotals(year, month) {
  const ym = `${year}-${pad(month + 1)}`;
  const totals = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`pomanilgi:meals:${ym}`)) {
        const data = JSON.parse(localStorage.getItem(k));
        const dateStr = k.replace("pomanilgi:meals:", "");
        totals[dateStr] = computeTotals(data).calories;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return totals;
}

/* ---------------------------------- AI calls (Gemini) ---------------------------------- */

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

class NoApiKeyError extends Error {
  constructor() {
    super("NO_API_KEY");
    this.code = "NO_API_KEY";
  }
}

async function callGemini(contents, apiKey) {
  if (!apiKey) throw new NoApiKeyError();
  const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson?.error?.message || "";
    } catch (e) { /* ignore */ }
    throw new Error(detail || `API 요청 실패 (${response.status})`);
  }
  const data = await response.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("");
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const bracketIdx = [cleaned.indexOf("["), cleaned.indexOf("{")].filter((i) => i !== -1);
  const start = bracketIdx.length ? Math.min(...bracketIdx) : -1;
  const sliced = start > 0 ? cleaned.slice(start) : cleaned;
  return JSON.parse(sliced);
}

async function analyzeFoodPhoto(dataUrl, apiKey) {
  const base64 = dataUrl.split(",")[1];
  const prompt = `당신은 영양 전문가입니다. 사진 속 음식을 분석해서 각 음식 항목별로 이름, 1인분 기준 분량, 예상 칼로리(kcal), 단백질(g), 탄수화물(g), 지방(g)을 추정해 주세요. 여러 음식이 있다면 모두 나열하세요. 합리적인 추정치를 제공하고, 다른 설명 없이 아래 JSON 배열 형식으로만 답하세요.
[{"name":"음식명","amount":"1공기","calories":300,"protein":10,"carbs":40,"fat":8}]
음식이 보이지 않으면 빈 배열 []만 반환하세요.`;
  const text = await callGemini(
    [{ role: "user", parts: [
      { inline_data: { mime_type: "image/jpeg", data: base64 } },
      { text: prompt },
    ]}],
    apiKey
  );
  return parseJsonLoose(text);
}

async function evaluateFoodItems(items, mealLabel, profile, targetCalories, apiKey) {
  const goalLabel = profile ? GOALS.find((g) => g.value === profile.goal)?.label : "미설정";
  const lines = items
    .map((i) => `- ${i.name}${i.amount ? ` (${i.amount})` : ""}: ${i.calories}kcal, 단백질 ${i.protein || 0}g, 탄수화물 ${i.carbs || 0}g, 지방 ${i.fat || 0}g`)
    .join("\n");
  const prompt = `당신은 '포만이'라는 다정한 영양 코치입니다. 사용자가 방금 ${mealLabel}(으)로 기록한 아래 음식을 100점 만점으로 평가해주세요.
평가 기준: 영양 균형(단백질/탄수화물/지방), 사용자 목표(${goalLabel})와의 적합성, 적정한 칼로리 여부.
점수가 낮더라도 항상 따뜻하고 격려하는 말투로 코멘트를 쓰고, 다음에 더 좋아질 수 있는 짧은 팁을 자연스럽게 담아주세요. 절대 비난하거나 부정적인 표현을 쓰지 마세요.
반드시 아래 JSON 형식으로만, 다른 설명 없이 답하세요.
{"score": 85, "comment": "한두 문장의 따뜻한 코멘트"}

[음식 목록]
${lines}

[사용자 목표]
${goalLabel}, 하루 목표 칼로리: ${targetCalories || "미설정"}kcal`;
  const text = await callGemini(
    [{ role: "user", parts: [{ text: prompt }] }],
    apiKey
  );
  const data = parseJsonLoose(text);
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(data.score)) || 0)),
    comment: data.comment || "",
  };
}

async function chatReply(profile, targetCalories, dateStr, meals, history, userMessage, apiKey) {
  const totals = computeTotals(meals);
  const itemList = MEAL_TYPES.flatMap((mt) => (meals[mt.key] || []).map((it) => `${mt.label}-${it.name}(${it.calories}kcal)`));
  const profileLine = profile
    ? `성별: ${profile.gender === "male" ? "남성" : "여성"}, 나이: ${profile.age}세, 키: ${profile.height}cm, 몸무게: ${profile.weight}kg, 목표: ${GOALS.find((g) => g.value === profile.goal)?.label}, 하루 목표 칼로리: ${targetCalories}kcal`
    : "아직 프로필 미설정";
  const historyLines = history
    .filter((m) => m.type === "user" || (m.type === "ai" && m.status === "done"))
    .slice(-10)
    .map((m) => (m.type === "user" ? `사용자: ${m.text}` : `포만이: ${m.text}`))
    .join("\n");

  const prompt = `당신은 '포만이'라는 다정하고 격려를 잘 해주는 영양 코치 AI입니다. 사용자의 식단 기록과 신체 정보를 참고해서 친근한 존댓말로, 도움이 되고 구체적인 답변을 2~4문장으로 해주세요. 사용자가 성취감을 느낄 수 있도록 긍정적이고 따뜻한 톤을 유지하되, 건강에 도움이 되지 않는 부분은 부드럽게 짚어주세요.

[사용자 정보]
${profileLine}

[${formatDisplayDate(dateStr)} 식단 기록]
${itemList.length ? itemList.join(", ") : "아직 기록 없음"}
총 섭취 칼로리: ${totals.calories}kcal

[지금까지의 대화]
${historyLines || "(대화 없음)"}

[사용자의 새 질문]
${userMessage}

위 질문에 답변해주세요.`;

  const text = await callGemini(
    [{ role: "user", parts: [{ text: prompt }] }],
    apiKey
  );
  return text.trim();
}

/* ---------------------------------- small UI atoms ---------------------------------- */

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-[11px] text-stone-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
function LabeledInput({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-stone-400 block mb-0.5">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-pink-100 rounded-lg px-1.5 py-1 text-center"
      />
    </label>
  );
}
function MacroPill({ label, value }) {
  return (
    <div className="bg-pink-50 rounded-xl py-2">
      <p className="text-sm font-bold text-stone-700">{Math.round(value)}g</p>
      <p className="text-[10px] text-stone-400">{label}</p>
    </div>
  );
}
function DateNav({ date, setDate }) {
  const isToday = date === toDateStr(new Date());
  const shift = (delta) => {
    const d = parseDateStr(date);
    d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };
  return (
    <div className="flex items-center justify-between">
      <button onClick={() => shift(-1)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-pink-50 text-stone-500">
        <ChevronLeft className="w-5 h-5" />
      </button>
      <div className="text-center">
        <p className="text-lg font-bold text-stone-800">{formatDisplayDate(date)}</p>
        {!isToday && (
          <button onClick={() => setDate(toDateStr(new Date()))} className="text-xs text-pink-500 underline underline-offset-2">
            오늘로 이동
          </button>
        )}
      </div>
      <button onClick={() => shift(1)} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-pink-50 text-stone-500">
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}

/* ---------------------------------- Today view ---------------------------------- */

function SummaryCard({ totals, target }) {
  const pct = target ? Math.min(100, (totals.calories / target) * 100) : 0;
  const over = target ? totals.calories > target : false;
  const ringColor = over ? "#E11D74" : "#FB7185";
  const remain = target ? target - totals.calories : null;
  const circumference = 2 * Math.PI * 54;
  const dash = circumference * (pct / 100);

  return (
    <div className="bg-white border border-pink-100 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-center gap-6">
      <div className="relative w-36 h-36 shrink-0">
        <svg viewBox="0 0 120 120" className="w-36 h-36 -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#FFE4EC" strokeWidth="10" />
          <circle
            cx="60" cy="60" r="54" fill="none" stroke={ringColor} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-stone-800">{totals.calories}</span>
          <span className="text-[11px] text-stone-400">kcal {target ? `/ ${target}` : ""}</span>
        </div>
      </div>
      <div className="flex-1 w-full space-y-3">
        {target ? (
          <p className="text-sm text-stone-600">
            {over ? (
              <span className="text-rose-600 font-semibold">목표보다 {totals.calories - target}kcal 더 섭취했어요</span>
            ) : (
              <span className="text-pink-600 font-semibold">목표까지 {remain}kcal 남았어요</span>
            )}
          </p>
        ) : (
          <p className="text-sm text-stone-500">프로필을 설정하면 목표 칼로리를 알려드려요.</p>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <MacroPill label="단백질" value={totals.protein} />
          <MacroPill label="탄수화물" value={totals.carbs} />
          <MacroPill label="지방" value={totals.fat} />
        </div>
      </div>
    </div>
  );
}

function MealSection({ meta, items, onAdd, onDelete, onEdit }) {
  const Icon = meta.icon;
  const subtotal = (items || []).reduce((s, i) => s + (Number(i.calories) || 0), 0);
  return (
    <div className="bg-white border border-pink-100 rounded-3xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center">
            <Icon className="w-4 h-4 text-pink-500" />
          </div>
          <div>
            <p className="font-semibold text-stone-800 text-sm">{meta.label}</p>
            <p className="text-[11px] text-stone-400">{meta.time}</p>
          </div>
        </div>
        <span className="text-sm font-bold text-stone-600">{subtotal} kcal</span>
      </div>
      <div className="space-y-2 mb-3">
        {(items || []).length === 0 && <p className="text-xs text-stone-300 py-2 text-center">아직 기록이 없어요</p>}
        {(items || []).map((it) => (
          <div key={it.id} className="flex items-center gap-3 bg-pink-50/60 rounded-xl p-2">
            {it.photo ? (
              <img src={it.photo} className="w-10 h-10 rounded-lg object-cover" alt="" />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-pink-100 flex items-center justify-center shrink-0">
                <UtensilsCrossed className="w-4 h-4 text-pink-300" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-700 truncate">{it.name}</p>
              <p className="text-[11px] text-stone-400">
                {it.amount ? `${it.amount} · ` : ""}
                {it.calories}kcal
              </p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={() => onEdit(it)} className="text-stone-300 hover:text-pink-400 p-1">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => onDelete(it.id)} className="text-stone-300 hover:text-rose-500 p-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={onAdd} className="w-full flex items-center justify-center gap-1 text-xs font-medium text-pink-500 border border-dashed border-pink-200 rounded-xl py-2 hover:bg-pink-50">
        <Plus className="w-3.5 h-3.5" /> 음식 추가
      </button>
    </div>
  );
}

function TodayView({ date, setDate, meals, targetCalories, onOpenAdd, onDelete, onEdit, profileMissing }) {
  const totals = computeTotals(meals);
  return (
    <div className="space-y-6 pt-6">
      <DateNav date={date} setDate={setDate} />
      <SummaryCard totals={totals} target={targetCalories} />
      {profileMissing && (
        <div className="flex items-start gap-2 bg-pink-50 border border-pink-200 text-pink-700 text-sm rounded-2xl p-4">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            정확한 목표 칼로리를 계산하려면 <b>프로필</b> 탭에서 신체 정보를 입력해주세요.
          </p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {MEAL_TYPES.map((mt) => (
          <MealSection
            key={mt.key}
            meta={mt}
            items={meals[mt.key]}
            onAdd={() => onOpenAdd(mt.key)}
            onDelete={(id) => onDelete(mt.key, id)}
            onEdit={(item) => onEdit(mt.key, item)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------- Add Food Modal ---------------------------------- */

function AddFoodModal({ mealLabel, apiKey, onClose, onAdd, onGoSettings }) {
  const [mode, setMode] = useState("photo");
  const [preview, setPreview] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState({ name: "", amount: "", calories: "", protein: "", carbs: "", fat: "" });
  const fileRef = useRef(null);

  const handleFile = async (file) => {
    if (!file) return;
    setError("");
    setResults(null);
    try {
      const full = await compressImage(file, 900, 0.7);
      const thumb = await compressImage(file, 180, 0.5);
      setPreview({ full, thumb });
    } catch (e) {
      setError("이미지를 불러오지 못했어요. 다시 시도해주세요.");
    }
  };

  const runAnalysis = async () => {
    if (!preview) return;
    if (!apiKey) {
      setError("먼저 설정 탭에서 Google AI Studio API 키를 입력해주세요.");
      return;
    }
    setAnalyzing(true);
    setError("");
    try {
      const data = await analyzeFoodPhoto(preview.full, apiKey);
      if (!Array.isArray(data) || data.length === 0) {
        setError("음식을 인식하지 못했어요. 직접 입력해보세요.");
        setResults([]);
      } else {
        setResults(data.map((d) => ({ ...d, id: makeId() })));
      }
    } catch (e) {
      setError(e.code === "NO_API_KEY" ? "먼저 설정 탭에서 Google AI Studio API 키를 입력해주세요." : "분석 중 문제가 생겼어요. 다시 시도해주세요.");
    } finally {
      setAnalyzing(false);
    }
  };

  const updateResult = (id, field, value) => {
    setResults((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: field === "name" || field === "amount" ? value : Number(value) } : r)));
  };
  const removeResult = (id) => setResults((rs) => rs.filter((r) => r.id !== id));

  const confirmAddPhotoResults = () => {
    const newItems = results.map((r) => ({
      id: makeId(),
      name: r.name,
      amount: r.amount,
      calories: Number(r.calories) || 0,
      protein: Number(r.protein) || 0,
      carbs: Number(r.carbs) || 0,
      fat: Number(r.fat) || 0,
      photo: preview?.thumb || null,
    }));
    onAdd(newItems);
    onClose();
  };

  const confirmManual = () => {
    if (!manual.name || !manual.calories) {
      setError("음식 이름과 칼로리를 입력해주세요.");
      return;
    }
    onAdd([
      {
        id: makeId(),
        name: manual.name,
        amount: manual.amount,
        calories: Number(manual.calories) || 0,
        protein: Number(manual.protein) || 0,
        carbs: Number(manual.carbs) || 0,
        fat: Number(manual.fat) || 0,
        photo: preview?.thumb || null,
      },
    ]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-stone-800">{mealLabel}에 추가</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex bg-pink-50 rounded-full p-1 mb-4">
          <button onClick={() => setMode("photo")} className={`flex-1 text-xs font-medium py-1.5 rounded-full ${mode === "photo" ? "bg-pink-400 text-white" : "text-stone-500"}`}>
            사진으로 추가
          </button>
          <button onClick={() => setMode("manual")} className={`flex-1 text-xs font-medium py-1.5 rounded-full ${mode === "manual" ? "bg-pink-400 text-white" : "text-stone-500"}`}>
            직접 입력
          </button>
        </div>

        {mode === "photo" && (
          <div className="space-y-4">
            {!preview ? (
              <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-pink-200 rounded-2xl py-10 flex flex-col items-center gap-2 text-pink-400 hover:bg-pink-50">
                <Camera className="w-7 h-7" />
                <span className="text-sm font-medium">사진 선택하기</span>
              </button>
            ) : (
              <div className="space-y-3">
                <img src={preview.full} className="w-full h-44 object-cover rounded-2xl" alt="" />
                {!results && (
                  <button onClick={runAnalysis} disabled={analyzing} className="w-full flex items-center justify-center gap-2 bg-pink-400 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
                    {analyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        분석 중...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        AI로 칼로리 분석하기
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={() => {
                    setPreview(null);
                    setResults(null);
                    setError("");
                  }}
                  className="text-xs text-stone-400 underline"
                >
                  다른 사진 선택
                </button>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />

            {results && results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-stone-400">분석 결과를 확인하고 수정할 수 있어요</p>
                {results.map((r) => (
                  <div key={r.id} className="bg-pink-50/70 rounded-xl p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        value={r.name}
                        onChange={(e) => updateResult(r.id, "name", e.target.value)}
                        className="flex-1 text-sm font-medium bg-white rounded-lg px-2 py-1 border border-pink-100"
                      />
                      <button onClick={() => removeResult(r.id)} className="text-stone-300 hover:text-rose-500">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                      <LabeledInput label="kcal" value={r.calories} onChange={(v) => updateResult(r.id, "calories", v)} />
                      <LabeledInput label="단백질" value={r.protein} onChange={(v) => updateResult(r.id, "protein", v)} />
                      <LabeledInput label="탄수화물" value={r.carbs} onChange={(v) => updateResult(r.id, "carbs", v)} />
                      <LabeledInput label="지방" value={r.fat} onChange={(v) => updateResult(r.id, "fat", v)} />
                    </div>
                  </div>
                ))}
                <button onClick={confirmAddPhotoResults} className="w-full bg-pink-500 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1">
                  <Check className="w-4 h-4" /> 식단에 추가하기
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "manual" && (
          <div className="space-y-3">
            <Field label="음식 이름">
              <input
                value={manual.name}
                onChange={(e) => setManual({ ...manual, name: e.target.value })}
                className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm"
                placeholder="예: 닭가슴살 샐러드"
              />
            </Field>
            <Field label="분량 (선택)">
              <input
                value={manual.amount}
                onChange={(e) => setManual({ ...manual, amount: e.target.value })}
                className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm"
                placeholder="예: 1접시"
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="칼로리(kcal)">
                <input type="number" value={manual.calories} onChange={(e) => setManual({ ...manual, calories: e.target.value })} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
              </Field>
              <Field label="단백질(g)">
                <input type="number" value={manual.protein} onChange={(e) => setManual({ ...manual, protein: e.target.value })} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
              </Field>
              <Field label="탄수화물(g)">
                <input type="number" value={manual.carbs} onChange={(e) => setManual({ ...manual, carbs: e.target.value })} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
              </Field>
              <Field label="지방(g)">
                <input type="number" value={manual.fat} onChange={(e) => setManual({ ...manual, fat: e.target.value })} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
              </Field>
            </div>
            <button onClick={confirmManual} className="w-full bg-pink-500 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1">
              <Check className="w-4 h-4" /> 식단에 추가하기
            </button>
          </div>
        )}

        {error && (
          <div className="text-xs text-rose-500 mt-3 flex items-center justify-between gap-2 bg-rose-50 rounded-xl px-3 py-2">
            <span className="flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </span>
            {error.includes("API 키") && (
              <button
                onClick={() => {
                  onClose();
                  onGoSettings();
                }}
                className="underline shrink-0 font-medium"
              >
                설정으로
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------- Edit Food Modal ---------------------------------- */

function EditFoodModal({ item, mealLabel, onClose, onSave }) {
  const [form, setForm] = useState({
    name: item.name || "",
    amount: item.amount || "",
    calories: item.calories ?? "",
    protein: item.protein ?? "",
    carbs: item.carbs ?? "",
    fat: item.fat ?? "",
  });
  const [error, setError] = useState("");

  const handleSave = () => {
    if (!form.name || form.calories === "") {
      setError("음식 이름과 칼로리는 필수예요.");
      return;
    }
    onSave({
      ...item,
      name: form.name,
      amount: form.amount,
      calories: Number(form.calories) || 0,
      protein: Number(form.protein) || 0,
      carbs: Number(form.carbs) || 0,
      fat: Number(form.fat) || 0,
    });
    onClose();
  };

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-stone-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-stone-800">음식 수정</h3>
            <p className="text-[11px] text-stone-400 mt-0.5">{mealLabel}</p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {item.photo && (
          <img src={item.photo} className="w-full h-36 object-cover rounded-2xl mb-4" alt="" />
        )}

        <div className="space-y-3">
          <Field label="음식 이름">
            <input value={form.name} onChange={set("name")} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
          </Field>
          <Field label="분량 (선택)">
            <input value={form.amount} onChange={set("amount")} placeholder="예: 1공기, 150g" className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="칼로리 (kcal)">
              <input type="number" value={form.calories} onChange={set("calories")} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
            </Field>
            <Field label="단백질 (g)">
              <input type="number" value={form.protein} onChange={set("protein")} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
            </Field>
            <Field label="탄수화물 (g)">
              <input type="number" value={form.carbs} onChange={set("carbs")} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
            </Field>
            <Field label="지방 (g)">
              <input type="number" value={form.fat} onChange={set("fat")} className="w-full border border-pink-100 rounded-xl px-3 py-2 text-sm" />
            </Field>
          </div>
        </div>

        {error && (
          <p className="text-xs text-rose-500 mt-3 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 border border-pink-100 text-stone-500 rounded-xl py-2.5 text-sm font-medium">
            취소
          </button>
          <button onClick={handleSave} className="flex-1 bg-pink-500 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1">
            <Check className="w-4 h-4" /> 수정 완료
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Calendar view ---------------------------------- */

function DayFoodList({ meals }) {
  const totals = computeTotals(meals);
  const hasAny = MEAL_TYPES.some((mt) => (meals[mt.key] || []).length > 0);
  return (
    <div className="bg-white border border-pink-100 rounded-3xl p-5 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-stone-800 text-sm">이 날 먹은 음식</p>
        <span className="text-sm font-bold text-pink-500">{totals.calories} kcal</span>
      </div>
      {!hasAny && <p className="text-xs text-stone-300 text-center py-4">기록된 음식이 없어요</p>}
      {MEAL_TYPES.map(
        (mt) =>
          (meals[mt.key] || []).length > 0 && (
            <div key={mt.key}>
              <p className="text-[11px] text-stone-400 font-medium mb-1">{mt.label}</p>
              <div className="space-y-1">
                {meals[mt.key].map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-sm text-stone-600 bg-pink-50/60 rounded-lg px-3 py-1.5">
                    <span className="truncate">{it.name}</span>
                    <span className="text-stone-400 text-xs shrink-0 ml-2">{it.calories}kcal</span>
                  </div>
                ))}
              </div>
            </div>
          )
      )}
    </div>
  );
}

function CalendarView({ year, month, setYearMonth, monthTotals, targetCalories, selectedDate, onSelectDate, meals }) {
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const shiftMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y--;
    }
    if (m > 11) {
      m = 0;
      y++;
    }
    setYearMonth(y, m);
  };

  return (
    <div className="pt-6 space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => shiftMonth(-1)} className="w-9 h-9 rounded-full hover:bg-pink-50 flex items-center justify-center text-stone-500">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <p className="font-bold text-stone-800">
          {year}년 {month + 1}월
        </p>
        <button onClick={() => shiftMonth(1)} className="w-9 h-9 rounded-full hover:bg-pink-50 flex items-center justify-center text-stone-500">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      <div className="bg-white border border-pink-100 rounded-3xl p-4 shadow-sm">
        <div className="grid grid-cols-7 mb-2 text-center text-[11px] text-stone-400 font-medium">
          {["일", "월", "화", "수", "목", "금", "토"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, idx) => {
            if (d === null) return <div key={idx} />;
            const dateStr = `${year}-${pad(month + 1)}-${pad(d)}`;
            const cal = monthTotals[dateStr];
            const isSelected = dateStr === selectedDate;
            const isToday = dateStr === toDateStr(new Date());
            let dot = null;
            if (cal != null) {
              let color = "bg-pink-300";
              if (targetCalories) {
                const ratio = cal / targetCalories;
                color = ratio > 1.1 ? "bg-rose-500" : ratio < 0.7 ? "bg-pink-200" : "bg-pink-400";
              }
              dot = <span className={`block w-1.5 h-1.5 rounded-full mx-auto mt-0.5 ${color}`} />;
            }
            return (
              <button
                key={idx}
                onClick={() => onSelectDate(dateStr)}
                className={`aspect-square rounded-xl flex flex-col items-center justify-center text-xs transition-colors ${
                  isSelected ? "bg-pink-400 text-white font-bold" : isToday ? "bg-pink-50 text-pink-600 font-semibold ring-1 ring-pink-200" : "text-stone-600 hover:bg-pink-50"
                }`}
              >
                {d}
                {!isSelected && dot}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-4 text-[11px] text-stone-400 justify-center">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-pink-200" />
          적게 섭취
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-pink-400" />
          적정
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-rose-500" />
          많이 섭취
        </span>
      </div>
      <p className="text-xs text-stone-400 text-center">선택한 날짜: {formatDisplayDate(selectedDate)}</p>
      <DayFoodList meals={meals} />
    </div>
  );
}

/* ---------------------------------- Profile view ---------------------------------- */

function ProfileView({ profile, onSave }) {
  const [form, setForm] = useState(
    profile || { gender: "female", age: "", height: "", weight: "", activityLevel: "1.375", goal: "maintain" }
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) setForm(profile);
  }, [profile]);

  const valid = form.age && form.height && form.weight;
  const preview = valid
    ? calcTargetCalories({ ...form, age: Number(form.age), height: Number(form.height), weight: Number(form.weight) })
    : null;

  const submit = async () => {
    if (!valid) return;
    const p = { ...form, age: Number(form.age), height: Number(form.height), weight: Number(form.weight) };
    await onSave(p);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="pt-6 space-y-5 max-w-md mx-auto">
      <div className="text-center space-y-1">
        <p className="font-bold text-stone-800 text-lg">내 신체 정보</p>
        <p className="text-xs text-stone-400">입력한 정보로 하루 목표 칼로리를 계산해요</p>
      </div>
      <div className="bg-white border border-pink-100 rounded-3xl p-5 shadow-sm space-y-4">
        <div>
          <span className="text-[11px] text-stone-400 mb-1.5 block">성별</span>
          <div className="grid grid-cols-2 gap-2">
            {[["female", "여성"], ["male", "남성"]].map(([v, l]) => (
              <button
                key={v}
                onClick={() => setForm({ ...form, gender: v })}
                className={`py-2 rounded-xl text-sm font-medium border ${form.gender === v ? "bg-pink-400 text-white border-pink-400" : "border-pink-100 text-stone-500"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="나이">
            <input type="number" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value })} className="w-full border border-pink-100 rounded-xl px-2 py-2 text-sm" placeholder="세" />
          </Field>
          <Field label="키(cm)">
            <input type="number" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} className="w-full border border-pink-100 rounded-xl px-2 py-2 text-sm" />
          </Field>
          <Field label="몸무게(kg)">
            <input type="number" value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} className="w-full border border-pink-100 rounded-xl px-2 py-2 text-sm" />
          </Field>
        </div>
        <div>
          <span className="text-[11px] text-stone-400 mb-1.5 block">활동량</span>
          <div className="space-y-1.5">
            {ACTIVITY_LEVELS.map((a) => (
              <button
                key={a.value}
                onClick={() => setForm({ ...form, activityLevel: a.value })}
                className={`w-full text-left px-3 py-2 rounded-xl border text-sm flex items-center justify-between ${
                  form.activityLevel === a.value ? "bg-pink-50 border-pink-300" : "border-pink-100 text-stone-500"
                }`}
              >
                <span>{a.label}</span>
                <span className="text-[11px] text-stone-400">{a.desc}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-[11px] text-stone-400 mb-1.5 block">목표</span>
          <div className="grid grid-cols-3 gap-2">
            {GOALS.map((g) => (
              <button
                key={g.value}
                onClick={() => setForm({ ...form, goal: g.value })}
                className={`py-2 rounded-xl text-xs font-medium border ${form.goal === g.value ? "bg-pink-400 text-white border-pink-400" : "border-pink-100 text-stone-500"}`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {preview && (
          <div className="bg-pink-50 rounded-2xl p-4 text-center">
            <p className="text-[11px] text-stone-400">예상 하루 목표 칼로리</p>
            <p className="text-2xl font-bold text-pink-500">{preview} kcal</p>
          </div>
        )}
        <button onClick={submit} disabled={!valid} className="w-full bg-pink-500 disabled:bg-pink-200 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1">
          {saved ? (
            <>
              <Check className="w-4 h-4" />
              저장됨
            </>
          ) : (
            "저장하기"
          )}
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- Settings view ---------------------------------- */

function SettingsView({ apiKey, onSave }) {
  const [value, setValue] = useState(apiKey || "");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setValue(apiKey || "");
  }, [apiKey]);

  const submit = async () => {
    await onSave(value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="pt-6 space-y-5 max-w-md mx-auto">
      <div className="text-center space-y-1">
        <p className="font-bold text-stone-800 text-lg">AI 설정</p>
        <p className="text-xs text-stone-400">Google AI Studio API 키를 입력하면 무료로 사용할 수 있어요</p>
      </div>

      <div className="bg-white border border-pink-100 rounded-3xl p-5 shadow-sm space-y-4">
        <Field label="Google AI Studio API 키">
          <div className="flex items-center gap-2">
            <input
              type={show ? "text" : "password"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="AIza..."
              className="flex-1 border border-pink-100 rounded-xl px-3 py-2 text-sm font-mono"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck="false"
            />
            <button onClick={() => setShow((s) => !s)} className="w-9 h-9 rounded-xl border border-pink-100 flex items-center justify-center text-stone-400 shrink-0">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        <button onClick={submit} disabled={!value.trim()} className="w-full bg-pink-500 disabled:bg-pink-200 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1">
          {saved ? (
            <>
              <Check className="w-4 h-4" />
              저장됨
            </>
          ) : (
            "저장하기"
          )}
        </button>

        <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${apiKey ? "bg-pink-50 text-pink-600" : "bg-stone-50 text-stone-400"}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${apiKey ? "bg-pink-500" : "bg-stone-300"}`} />
          {apiKey ? "API 키가 설정되어 있어요 ✓" : "아직 API 키가 설정되지 않았어요"}
        </div>
      </div>

      <div className="bg-white border border-pink-100 rounded-3xl p-5 shadow-sm space-y-3">
        <p className="text-sm font-semibold text-stone-800">🆓 무료 키 발급 방법 (2분)</p>
        <ol className="text-xs text-stone-500 space-y-2.5 list-decimal pl-4">
          <li>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-pink-500 underline font-medium">
              aistudio.google.com/app/apikey
            </a>{" "}
            접속 (구글 계정으로 로그인)
          </li>
          <li>
            <b>Create API key</b> 버튼 클릭
          </li>
          <li>
            생성된 키(<span className="font-mono">AIza</span>로 시작)를 복사
          </li>
          <li>위 입력칸에 붙여넣고 <b>저장하기</b> 탭</li>
        </ol>
        <div className="bg-pink-50/80 rounded-xl px-3 py-3 space-y-1.5 text-[11px] text-stone-500 leading-relaxed">
          <p>✅ <b>신용카드 등록 없이</b> 무료로 사용 가능</p>
          <p>⚠️ 구글이 입력 내용을 서비스 개선에 활용할 수 있어요</p>
          <p>🔒 API 키는 이 기기 브라우저에만 저장되고 외부로 전송되지 않아요</p>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- Chat view ---------------------------------- */

function EvalCard({ msg }) {
  const scoreColor = msg.score >= 80 ? "text-pink-600" : msg.score >= 60 ? "text-pink-500" : "text-pink-400";
  return (
    <div className="flex justify-center">
      <div className="w-full max-w-xs bg-white border border-pink-100 rounded-3xl p-4 shadow-sm">
        <div className="flex items-center gap-3">
          {msg.photo ? (
            <img src={msg.photo} className="w-12 h-12 rounded-xl object-cover shrink-0" alt="" />
          ) : (
            <div className="w-12 h-12 rounded-xl bg-pink-100 flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-5 h-5 text-pink-300" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-stone-400">{msg.mealLabel}</p>
            <p className="text-sm font-semibold text-stone-700 truncate">{(msg.items || []).join(", ")}</p>
          </div>
          {msg.status === "done" ? (
            <div className="text-center shrink-0">
              <p className={`text-xl font-extrabold ${scoreColor}`}>{msg.score}</p>
              <p className="text-[9px] text-stone-400 -mt-1">점</p>
            </div>
          ) : msg.status === "error" ? (
            <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          ) : (
            <Loader2 className="w-5 h-5 animate-spin text-pink-300 shrink-0" />
          )}
        </div>
        {msg.status === "done" && msg.score >= 90 && (
          <p className="text-[11px] text-pink-500 font-semibold mt-2">🌸 최고의 한 끼예요!</p>
        )}
        {msg.status === "done" && msg.comment && (
          <p className="text-xs text-stone-500 mt-2 bg-pink-50/70 rounded-xl px-3 py-2">{msg.comment}</p>
        )}
        {msg.status === "error" && <p className="text-xs text-rose-400 mt-2">{msg.errorMessage || "평가를 불러오지 못했어요"}</p>}
      </div>
    </div>
  );
}

function ChatBubble({ msg }) {
  if (msg.type === "eval") return <EvalCard msg={msg} />;
  if (msg.type === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-pink-400 text-white text-sm rounded-2xl rounded-br-sm px-4 py-2.5 whitespace-pre-wrap">{msg.text}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-start gap-2">
      <div className="w-6 h-6 rounded-full bg-pink-100 flex items-center justify-center shrink-0 mt-0.5">
        <Flower2 className="w-3 h-3 text-pink-500" />
      </div>
      <div className="max-w-[80%] bg-pink-50 text-stone-700 text-sm rounded-2xl rounded-bl-sm px-4 py-2.5 whitespace-pre-wrap">
        {msg.status === "pending" ? <Loader2 className="w-4 h-4 animate-spin text-pink-300" /> : msg.text}
      </div>
    </div>
  );
}

function ChatView({ date, setDate, messages, onSend }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const doneScores = messages.filter((m) => m.type === "eval" && m.status === "done").map((m) => m.score);
  const avgScore = doneScores.length ? Math.round(doneScores.reduce((a, b) => a + b, 0) / doneScores.length) : null;

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
  };

  return (
    <div className="pt-6 space-y-4">
      <DateNav date={date} setDate={setDate} />

      <div className="flex items-center justify-between bg-white border border-pink-100 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-pink-100 flex items-center justify-center">
            <Flower2 className="w-4 h-4 text-pink-500" />
          </div>
          <div>
            <p className="font-semibold text-stone-800 text-sm leading-none">포만이</p>
            <p className="text-[11px] text-stone-400 mt-0.5">AI 식단 코치</p>
          </div>
        </div>
        {avgScore != null && (
          <div className="bg-pink-50 rounded-full px-3 py-1.5 text-center">
            <span className="text-[10px] text-stone-400 block leading-none">오늘 평균</span>
            <span className="text-sm font-bold text-pink-500">{avgScore}점</span>
          </div>
        )}
      </div>

      <div className="overflow-y-auto space-y-3 pr-1" style={{ minHeight: 320, maxHeight: "55vh" }}>
        {messages.length === 0 && (
          <div className="text-center py-10 space-y-2">
            <Flower2 className="w-8 h-8 text-pink-200 mx-auto" />
            <p className="text-sm text-stone-400">
              식단을 기록하면 포만이가 점수를 매겨줘요.
              <br />
              궁금한 점도 편하게 물어보세요!
            </p>
          </div>
        )}
        {messages.map((m) => (
          <ChatBubble key={m.id} msg={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 bg-white border border-pink-100 rounded-full p-1.5 shadow-sm sticky bottom-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="포만이에게 물어보세요"
          className="flex-1 px-3 py-1.5 text-sm bg-transparent outline-none"
        />
        <button
          onClick={submit}
          disabled={!input.trim()}
          className="w-9 h-9 rounded-full bg-pink-400 text-white flex items-center justify-center shrink-0 disabled:opacity-50 disabled:bg-pink-200"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- App ---------------------------------- */

export default function App() {
  const [view, setView] = useState("today");
  const [profile, setProfile] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [meals, setMeals] = useState({ breakfast: [], lunch: [], dinner: [], snack: [] });
  const [chatMessages, setChatMessages] = useState([]);
  const [modalMeal, setModalMeal] = useState(null);
  const [modalEdit, setModalEdit] = useState(null); // { mealKey, item }
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [monthTotals, setMonthTotals] = useState({});

  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    (async () => {
      setProfile(await loadProfile());
      setApiKey(await loadApiKey());
    })();
  }, []);

  useEffect(() => {
    (async () => {
      setMeals(await loadMeals(selectedDate));
      setChatMessages(await loadChat(selectedDate));
    })();
  }, [selectedDate]);

  const refreshMonthTotals = useCallback(async () => {
    setMonthTotals(await loadMonthTotals(calYear, calMonth));
  }, [calYear, calMonth]);

  useEffect(() => {
    refreshMonthTotals();
  }, [refreshMonthTotals]);

  const targetCalories = profile ? calcTargetCalories(profile) : null;

  const triggerEval = async (mealKey, items, targetDate) => {
    const mealMeta = MEAL_TYPES.find((m) => m.key === mealKey);
    const pendingId = makeId();
    const pendingMsg = {
      id: pendingId, type: "eval", status: "pending",
      mealLabel: mealMeta.label, items: items.map((i) => i.name),
      photo: items[0]?.photo || null, timestamp: Date.now(),
    };
    const before = await loadChat(targetDate);
    const withPending = [...before, pendingMsg];
    await saveChat(targetDate, withPending);
    if (selectedDateRef.current === targetDate) setChatMessages(withPending);

    let patch;
    try {
      const { score, comment } = await evaluateFoodItems(items, mealMeta.label, profile, targetCalories, apiKey);
      patch = { status: "done", score, comment };
    } catch (e) {
      patch = { status: "error", errorMessage: e.code === "NO_API_KEY" ? "설정 탭에서 Google AI Studio API 키를 먼저 입력해주세요" : e.message || "평가를 불러오지 못했어요" };
    }
    const latest = await loadChat(targetDate);
    const updated = latest.map((m) => (m.id === pendingId ? { ...m, ...patch } : m));
    await saveChat(targetDate, updated);
    if (selectedDateRef.current === targetDate) setChatMessages(updated);
  };

  const sendUserMessage = async (text) => {
    const targetDate = selectedDate;
    const userMsg = { id: makeId(), type: "user", text, timestamp: Date.now() };
    const before = await loadChat(targetDate);
    const withUser = [...before, userMsg];
    await saveChat(targetDate, withUser);
    if (selectedDateRef.current === targetDate) setChatMessages(withUser);

    const pendingId = makeId();
    const pendingAi = { id: pendingId, type: "ai", status: "pending", timestamp: Date.now() };
    const withPending = [...withUser, pendingAi];
    await saveChat(targetDate, withPending);
    if (selectedDateRef.current === targetDate) setChatMessages(withPending);

    let patch;
    try {
      const replyText = await chatReply(profile, targetCalories, targetDate, meals, withUser, text, apiKey);
      patch = { status: "done", text: replyText };
    } catch (e) {
      patch = { status: "error", text: e.code === "NO_API_KEY" ? "설정 탭에서 Google AI Studio API 키를 먼저 입력해주세요 🙏" : e.message || "답변을 가져오지 못했어요. 다시 시도해주세요." };
    }
    const latest = await loadChat(targetDate);
    const updated = latest.map((m) => (m.id === pendingId ? { ...m, ...patch } : m));
    await saveChat(targetDate, updated);
    if (selectedDateRef.current === targetDate) setChatMessages(updated);
  };

  const handleAddItems = (mealKey, items) => {
    const targetDate = selectedDate;
    setMeals((prev) => {
      const next = { ...prev, [mealKey]: [...(prev[mealKey] || []), ...items] };
      saveMeals(targetDate, next).then(refreshMonthTotals);
      return next;
    });
    triggerEval(mealKey, items, targetDate);
  };
  const handleDeleteItem = (mealKey, id) => {
    setMeals((prev) => {
      const next = { ...prev, [mealKey]: prev[mealKey].filter((i) => i.id !== id) };
      saveMeals(selectedDate, next).then(refreshMonthTotals);
      return next;
    });
  };
  const handleEditItem = (mealKey, updatedItem) => {
    setMeals((prev) => {
      const next = {
        ...prev,
        [mealKey]: prev[mealKey].map((i) => (i.id === updatedItem.id ? updatedItem : i)),
      };
      saveMeals(selectedDate, next).then(refreshMonthTotals);
      return next;
    });
  };
  const handleSaveProfile = async (p) => {
    await saveProfile(p);
    setProfile(p);
  };
  const handleSaveApiKey = async (key) => {
    await saveApiKey(key);
    setApiKey(key);
  };
  const setYearMonth = (y, m) => {
    setCalYear(y);
    setCalMonth(m);
  };

  const tabs = [
    { key: "today", label: "오늘", icon: UtensilsCrossed },
    { key: "calendar", label: "캘린더", icon: CalendarIcon },
    { key: "chat", label: "AI 대화", icon: MessageCircle },
    { key: "profile", label: "프로필", icon: User },
    { key: "settings", label: "설정", icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-pink-100" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-3xl mx-auto px-4 py-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-9 h-9 rounded-full bg-pink-100 flex items-center justify-center">
              <Flower2 className="w-5 h-5 text-pink-500" />
            </div>
            <div className="hidden sm:block">
              <p className="font-bold text-stone-800 leading-none text-sm">포만일기</p>
              <p className="text-[10px] text-stone-400 mt-0.5">사진으로 기록하는 식단 다이어리</p>
            </div>
          </div>
          <nav className="flex gap-1 bg-pink-50 rounded-full p-1 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setView(tab.key)}
                  className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-colors shrink-0 ${
                    view === tab.key ? "bg-pink-400 text-white shadow-sm" : "text-stone-500 hover:bg-pink-100"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pb-16" style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}>
        {view === "today" && (
          <TodayView
            date={selectedDate}
            setDate={setSelectedDate}
            meals={meals}
            targetCalories={targetCalories}
            profileMissing={!profile}
            onOpenAdd={(mealKey) => setModalMeal(mealKey)}
            onDelete={handleDeleteItem}
            onEdit={(mealKey, item) => setModalEdit({ mealKey, item })}
          />
        )}
        {view === "calendar" && (
          <CalendarView
            year={calYear}
            month={calMonth}
            setYearMonth={setYearMonth}
            monthTotals={monthTotals}
            targetCalories={targetCalories}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            meals={meals}
          />
        )}
        {view === "chat" && <ChatView date={selectedDate} setDate={setSelectedDate} messages={chatMessages} onSend={sendUserMessage} />}
        {view === "profile" && <ProfileView profile={profile} onSave={handleSaveProfile} />}
        {view === "settings" && <SettingsView apiKey={apiKey} onSave={handleSaveApiKey} />}
      </main>

      {modalMeal && (
        <AddFoodModal
          mealLabel={MEAL_TYPES.find((m) => m.key === modalMeal).label}
          apiKey={apiKey}
          onClose={() => setModalMeal(null)}
          onAdd={(items) => handleAddItems(modalMeal, items)}
          onGoSettings={() => setView("settings")}
        />
      )}

      {modalEdit && (
        <EditFoodModal
          item={modalEdit.item}
          mealLabel={MEAL_TYPES.find((m) => m.key === modalEdit.mealKey).label}
          onClose={() => setModalEdit(null)}
          onSave={(updatedItem) => handleEditItem(modalEdit.mealKey, updatedItem)}
        />
      )}
    </div>
  );
}
