import { createClient } from "@supabase/supabase-js";

/*
  もとのApp.jsx(Claudeアーティファクト版)は window.storage.get/set を
  呼び出す前提のまま書かれています。ここではSupabaseを使って
  同じインターフェース(get/set/delete/list)を持つ window.storage を
  用意することで、App.jsx側のコードをほぼ変更せずに使えるようにしています。

  もとのAPIは get(key, shared) のように第2引数(shared)を取りますが、
  このアプリではすべて共有データ(shared=true)としてしか使っていないため、
  ここでは常に共有のkv_storeテーブルを1つだけ使う実装にしています。
*/

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "Supabaseの環境変数(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)が設定されていません。.envファイルまたはCloudflare Pagesの環境変数を確認してください。"
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function get(key) {
  const { data, error } = await supabase
    .from("kv_store")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { key, value: data.value, shared: true };
}

async function set(key, value) {
  const { error } = await supabase
    .from("kv_store")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
  return { key, value, shared: true };
}

async function del(key) {
  const { error } = await supabase.from("kv_store").delete().eq("key", key);
  if (error) throw error;
  return { key, deleted: true, shared: true };
}

async function list(prefix) {
  let query = supabase.from("kv_store").select("key");
  if (prefix) query = query.like("key", `${prefix}%`);
  const { data, error } = await query;
  if (error) throw error;
  return { keys: (data || []).map((row) => row.key), prefix, shared: true };
}

export function installStorage() {
  window.storage = { get, set, delete: del, list };
}
