-- Fantastic Cabaret 予約管理アプリ用のテーブル
-- Supabaseダッシュボードの「SQL Editor」でこのファイルの内容を実行してください。

create table if not exists kv_store (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security を有効化
alter table kv_store enable row level security;

-- このアプリは独自のPINでアクセス制限しており、Supabase側の認証(ログイン)は使わないため、
-- anonキー(公開キー)からの読み書きをすべて許可するポリシーにしています。
-- (= Supabaseの管理画面から見れば、テーブルの中身は誰でも読み書きできる状態です。
--    詳しくはREADME.mdの「セキュリティについて」を参照してください)
create policy "allow anon select" on kv_store
  for select using (true);

create policy "allow anon insert" on kv_store
  for insert with check (true);

create policy "allow anon update" on kv_store
  for update using (true);

create policy "allow anon delete" on kv_store
  for delete using (true);
