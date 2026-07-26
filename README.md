# Fantastic Cabaret 予約管理 — 公開手順

Claudeのアーティファクト機能から、Cloudflare Pages + Supabaseで
自分たちだけのURLとして公開するための手順です。

## まず結論:URLを知っている人だけがアクセスできる?

**はい、基本的にはそうなります。** Cloudflare Pagesで公開すると
`https://(プロジェクト名).pages.dev` のようなURLが発行されますが、
- どこにも一覧登録されず、検索にも出ません
- ログイン機能などを別途足さない限り、URLさえ知っていれば誰でも開けます

つまり「今Claudeのアーティファクトを共有しているのと同じくらいの
安全性(見つかりにくいURL)」になります。アプリ自体にPIN(管理者PIN・
出演者PIN)によるログインもあるので、URLを知られても中身をすぐ
触られるわけではありません。

もし「URLを知っていても、まずCloudflare側のログインを挟みたい」
という場合は、下の「(任意)さらにアクセスを制限したい場合」を
参照してください。

---

## 全体の流れ

1. Supabase(データベース)のプロジェクトを作る
2. このフォルダ一式をGitHubにアップロードする
3. Cloudflare Pagesでそのリポジトリを公開する
4. 動作確認する

---

## 1. Supabaseの準備

1. https://supabase.com にアクセスし、無料アカウントを作成してログイン
2. 「New project」から新しいプロジェクトを作成(名前は何でもOK、リージョンは「Northeast Asia (Tokyo)」がおすすめ)
3. プロジェクトが作成されたら、左メニューの **SQL Editor** を開く
4. このフォルダ内の `supabase/schema.sql` の中身を全部コピーして貼り付け、実行(Run)する
   - これで予約・日程・名簿などのデータを保存するテーブル(`kv_store`)ができます
5. 画面右上あたりの **Connect** ボタンを押すと、接続に必要な情報がまとめて表示されます
   (見当たらない場合は左メニューの **Project Settings > API Keys** からも確認できます)
   - **Project URL**(例:`https://xxxxxxxx.supabase.co`)
   - ブラウザ側で使う公開用キー。プロジェクトの世、代によって名前が違います
     - 新しめのプロジェクト:**Publishable key**(`sb_publishable_...`という文字列)
     - 少し前のプロジェクト:**anon / public** キー(`eyJ...`で始まる長い文字列。`Legacy API Keys`タブにあることがあります)
   - どちらのキーでも、この後の`storage.js`はそのまま使えます。**「Secret key」や「service_role」というキーは絶対に使わないでください**(データベースを丸ごと操作できてしまう、サーバー専用の鍵で、ブラウザ用ではありません)

## 2. GitHubにアップロード

1. GitHubで新しいリポジトリを作成(Private推奨)
2. このフォルダ一式をアップロード(GitHub Desktopや`git`コマンドでOK)
   ```
   git init
   git add .
   git commit -m "first commit"
   git branch -M main
   git remote add origin (あなたのリポジトリURL)
   git push -u origin main
   ```
   - `.env`ファイルは`.gitignore`で除外されるので、そのままpushして大丈夫です(Supabaseのキーは次のCloudflare側で設定します)

## 3. Cloudflare Pagesで公開

1. https://dash.cloudflare.com にログイン(無料アカウントでOK)
2. 左メニューの **Workers & Pages** を開き、「Create application」→「Pages」→「Import from an existing Git repository」を選択
3. 先ほどのGitHubリポジトリを選んで「Begin setup」
4. ビルド設定を入力
   - Framework preset: **Vite**(なければ手動で以下を入力)
   - Build command: `npm run build`
   - Build output directory: `dist`
5. **Environment variables(環境変数)** に以下の2つを追加
   - `VITE_SUPABASE_URL` → Supabaseの Project URL
   - `VITE_SUPABASE_ANON_KEY` → SupabaseのPublishable key(または anon public キー)
6. 「Save and Deploy」を押すとビルドが始まり、数分で
   `https://(プロジェクト名).pages.dev` のURLが発行されます

これで、スタッフの皆さんとそのURLを共有すれば、今までClaude上で
動いていたのと同じアプリが、独立したWebサイトとして使えるようになります。

## 4. 動作確認

- 発行されたURLを開き、管理者PIN(初期値 `1234`)でログインできるか確認
- 日程を1つ作成 → 予約を追加 → 別のブラウザ(またはスマホ)で同じURLを開いて
  同じデータが見えるか確認できればSupabase連携は成功です
- 動作確認できたら、設定タブから管理者PINを必ず変更してください

---

## (任意)さらにアクセスを制限したい場合

「URLを知っている人なら誰でも」ではなく、開く前にもう一段階の
確認を入れたい場合は、Cloudflareの **Access(Zero Trust)** という
無料機能で、サイト全体にメール認証やパスワードのゲートを追加できます
(Cloudflareダッシュボードの「Zero Trust」→「Access」から設定)。
ただし設定がやや複雑になるので、まずはURL非公開のままで試運転して、
必要になった時点で検討することをおすすめします。

---

## セキュリティについて(正直な注意点)

- このアプリの `VITE_SUPABASE_ANON_KEY` は、ブラウザに配信されるコードの中に
  含まれるため、見ようと思えば誰でも見られます。今回のSupabaseテーブルは
  「anonキーからの読み書きを許可する」設定にしているため、理屈の上では
  そのキーを知っている人はアプリを経由せず直接データベースを読み書き
  できてしまいます。
- これは、アプリ内に独自の会員登録・ログイン基盤を作らない限りは
  避けにくいトレードオフです。信頼できるスタッフだけで使う、
  今回のような小規模な運用であれば、実用上は問題ないレベルだと考えています。
- もしより厳密にしたい場合は、Supabaseの認証機能(Supabase Auth)を
  組み合わせて、ログインしたユーザーだけがデータを読み書きできるように
  作り直すことも可能です。その際はまたお知らせください。
