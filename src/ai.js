// 멀티 프로바이더 AI 호출 헬퍼 — 비용 0으로 운영 가능하도록 무료 제공자를 지원한다.
//
// 지원 프로바이더 (AI_PROVIDER 로 지정, 미지정 시 설정된 키로 자동 감지):
//   - gemini    : Google Gemini (무료 티어, 카드 불필요). GEMINI_API_KEY
//   - openai    : OpenAI 호환 API — Groq(무료)·OpenRouter·로컬 Ollama 등. OPENAI_API_KEY (+ OPENAI_BASE_URL)
//   - anthropic : Claude (유료·고품질). ANTHROPIC_API_KEY
//
// 모델 지정: AI_MODEL 로 공통 오버라이드, 없으면 프로바이더별 기본값.
//   gemini 기본 gemini-2.5-flash · groq 기본 llama-3.3-70b-versatile · anthropic 기본 claude-opus-4-8

function provider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p) return p;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return '';
}

function keyFor(p) {
  return { gemini: process.env.GEMINI_API_KEY, openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY }[p];
}

export function aiModel() {
  const p = provider();
  if (process.env.AI_MODEL) return process.env.AI_MODEL;
  return { gemini: 'gemini-2.5-flash', openai: process.env.OPENAI_MODEL || 'llama-3.3-70b-versatile', anthropic: 'claude-opus-4-8' }[p] || '';
}

export function aiEnabled() {
  const p = provider();
  return !!p && !!keyFor(p);
}

export function aiInfo() {
  return { enabled: aiEnabled(), provider: provider() || null, model: aiEnabled() ? aiModel() : null };
}

function jsonInstruction(schema) {
  return '\n\n출력 형식: 아래 JSON 스키마에 정확히 맞는 유효한 JSON 하나만 출력하세요. ' +
    '코드블록(```), 설명, 주석 없이 순수 JSON만 반환하세요.\n' + JSON.stringify(schema);
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch {}
  // 본문에서 첫 { … 마지막 } 구간 추출 재시도
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch {} }
  return null;
}

// ── 프로바이더별 호출 ─────────────────────────────────────────────
async function callAnthropic(key, model, prompt, schema, { maxTokens, effort }) {
  const isFable = /^claude-(fable|mythos)/.test(model);
  const body = {
    model, max_tokens: maxTokens,
    output_config: { effort, format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }],
  };
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  if (isFable) { body.fallbacks = [{ model: 'claude-opus-4-8' }]; headers['anthropic-beta'] = 'server-side-fallback-2026-06-01'; }
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) return { error: j?.error?.message || `Anthropic ${r.status}` };
  if (j.stop_reason === 'refusal') return { error: 'AI가 안전상 응답하지 않았습니다.' };
  return { text: (j.content || []).find(b => b.type === 'text')?.text || '', model: j.model || model };
}

async function callGemini(key, model, prompt, schema, { maxTokens }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ parts: [{ text: prompt + jsonInstruction(schema) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.8,
      maxOutputTokens: Math.max(maxTokens, 4096),
      // Gemini 2.5 는 thinking 토큰이 출력 예산을 잠식해 JSON이 잘림 → 비활성화(출력 전량을 JSON에)
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) return { error: j?.error?.message || `Gemini ${r.status}` };
  const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return { text, model };
}

async function callOpenAICompatible(key, model, prompt, schema, { maxTokens }) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const body = {
    model,
    messages: [{ role: 'user', content: prompt + jsonInstruction(schema) }],
    response_format: { type: 'json_object' },
    temperature: 0.8,
    max_tokens: maxTokens,
  };
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) return { error: j?.error?.message || `AI ${r.status}` };
  return { text: j.choices?.[0]?.message?.content || '', model: j.model || model };
}

// 공통 진입점. server.js 는 이 함수를 사용한다.
export async function callClaude(prompt, schema, { maxTokens = 2000, effort = 'medium' } = {}) {
  const p = provider();
  const key = keyFor(p);
  if (!p || !key) {
    return { enabled: false, message: '무료 AI를 쓰려면 GEMINI_API_KEY(구글, 무료) 또는 OPENAI_API_KEY(Groq 등)를, 유료는 ANTHROPIC_API_KEY를 .env에 설정하세요.' };
  }
  const model = aiModel();
  let out;
  try {
    if (p === 'anthropic') out = await callAnthropic(key, model, prompt, schema, { maxTokens, effort });
    else if (p === 'gemini') out = await callGemini(key, model, prompt, schema, { maxTokens });
    else out = await callOpenAICompatible(key, model, prompt, schema, { maxTokens });
  } catch (e) {
    return { enabled: true, error: '네트워크 오류: ' + e.message };
  }
  if (out.error) return { enabled: true, error: out.error };
  const data = extractJson(out.text);
  if (!data) return { enabled: true, error: 'AI 응답을 해석하지 못했습니다.' };
  return { enabled: true, provider: p, model: out.model || model, data };
}
