// PROTOTYPE shared helpers: env, scratch DB, cost ledger with a hard cap, cached LLM + Voyage calls.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

process.loadEnvFile(new URL('.env', import.meta.url).pathname);

export const CAP_USD = 15;
export const MODELS = { sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-4-5-20251001' };
// $ per 1M tokens (first-party list prices as of 2026-10-02)
const PRICE = {
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'voyage-4': { in: 0.06, out: 0 },
  'voyage-4-lite': { in: 0.02, out: 0 },
};

const dir = new URL('./results/', import.meta.url).pathname;
fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
const ledgerPath = path.join(dir, 'ledger.json');
export const ledger = () => (fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : []);
export const spent = () => ledger().reduce((s, r) => s + r.usd, 0);

function record(label, model, inTok, outTok) {
  const p = PRICE[model];
  const usd = (inTok * p.in + outTok * p.out) / 1e6;
  const l = ledger();
  l.push({ label, model, in: inTok, out: outTok, usd });
  fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 1));
  return usd;
}
function guardCap() {
  if (spent() >= CAP_USD) throw new Error(`Spend cap $${CAP_USD} reached ($${spent().toFixed(2)}). Aborting.`);
}

const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 24);
const cached = async (key, fn) => {
  const f = path.join(dir, 'cache', key + '.json');
  if (fs.existsSync(f)) return { ...JSON.parse(fs.readFileSync(f, 'utf8')), cached: true };
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
};

const anthropic = new Anthropic();

// Structured LLM call. Forced tool_choice is rejected on Sonnet 5.5, so use structured outputs.
// Cache key excludes `label` so re-runs and sweeps never pay twice.
export async function llm({ label, tier, system, user, schema, maxTokens = 4000 }) {
  const model = MODELS[tier];
  const key = hash({ model, system, user, maxTokens, schema: schema.toString().length });
  return cached('llm-' + key, async () => {
    guardCap();
    const req = {
      model, max_tokens: maxTokens, system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: zodOutputFormat(schema) },
    };
    if (tier === 'sonnet') req.output_config.effort = 'medium'; // set explicitly; effort errors on Haiku 4.5
    const res = await anthropic.messages.parse(req);
    if (!res.parsed_output) throw new Error(`unparsed output (stop_reason=${res.stop_reason})`);
    const usd = record(label, model, res.usage.input_tokens, res.usage.output_tokens);
    return { parsed: res.parsed_output, usage: { in: res.usage.input_tokens, out: res.usage.output_tokens }, usd, model };
  });
}

export async function embed(texts, model, inputType) {
  const key = hash({ texts, model, inputType });
  const r = await cached('emb-' + key, async () => {
    guardCap();
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
      body: JSON.stringify({ input: texts, model, input_type: inputType, output_dimension: 1024 }),
    });
    if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
    const j = await res.json();
    const usd = record(`embed:${inputType}`, model, j.usage.total_tokens, 0);
    return { vectors: j.data.map((d) => d.embedding), tokens: j.usage.total_tokens, usd };
  });
  return r.vectors;
}

export const pool = new pg.Pool({ connectionString: 'postgres://marginalia:marginalia@localhost:5433/marginalia' });
export const vec = (v) => '[' + v.join(',') + ']';
export const out = (name, text) => fs.writeFileSync(path.join(dir, name), text);
export const saveJson = (name, o) => fs.writeFileSync(path.join(dir, name), JSON.stringify(o, null, 1));
export const loadJson = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
