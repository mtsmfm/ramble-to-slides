/**
 * UI language (en / ja).
 *
 * Every user-visible string lives here, in both languages. index.html carries only the keys
 * (data-i18n / data-i18n-placeholder / data-i18n-title); applyI18n() fills the text in.
 * `t(key, params)` interpolates `{name}` placeholders; `setLocale` persists the choice in
 * localStorage and notifies the UI, which re-renders everything.
 *
 * The speech language (what whisper transcribes) is a separate, per-project setting —
 * see Session.setLanguage.
 */

export type Locale = "ja" | "en";

const STORAGE_KEY = "rts.locale";

const ja = {
  // ---- header ----
  "hdr.project.none": "プロジェクト未選択",
  "hdr.speaking": "発話",
  "hdr.agent.title": "AI が wait_for_event で待機しているかどうか",
  "hdr.uiLang": "表示",
  "settings.title": "プロジェクト設定",
  "settings.folder": "フォルダ",
  "settings.speechLang": "音声の言語",
  "settings.asrModel": "音声認識モデル",
  "settings.modelCache": "保存済みモデル",
  "modelCache.size": "{mb} MB",
  "modelCache.none": "なし",
  "modelCache.unknown": "不明",
  "modelCache.hint": "whisper のモデルはブラウザのキャッシュに保存されます。削除しても次に選んだときに再ダウンロードされます",
  "btn.clearCache": "削除",
  "status.cacheCleared": "保存済みモデルを削除しました",
  "status.cacheClearFailed": "モデルの削除に失敗しました: {message}",
  "asrModel.choose": "選んでください",
  "asrModel.turbo": "whisper 高精度 (large-v3-turbo, 約 1.5 GB, GPU 向け)",
  "asrModel.small": "whisper 軽量 (small, 約 0.4 GB, 精度はかなり低い)",
  "asrModel.webspeechLocal": "ブラウザ内蔵・端末内処理 (Chrome 139 以降, 音声は外に出ない)",
  "asrModel.webspeechCloud": "ブラウザ内蔵・クラウド (Chrome は Google, Edge は Microsoft に音声を送る)",
  "asrModel.hint":
    "WebGPU が使える PC では whisper 高精度が既定です。使えない PC ではここで方式を選んでください。ブラウザ内蔵は無料で軽く、精度は端末とブラウザ次第。Brave, Firefox, 素の Chromium では使えません",
  "lang.ja": "日本語",
  "lang.en": "English",

  "agent.idle": "AI 未接続",
  "agent.waiting": "AI 待機中",
  "agent.away": "AI 離席中 ({since})",
  "since.lt1m": "1 分未満",
  "since.min": "{n} 分前",

  // ---- buttons ----
  "start.lead": "だらだら喋った内容から、発表スライドの素案を作ります。",
  "btn.open": "保存先フォルダを選ぶ",
  "btn.switchProject": "プロジェクトを開く",
  "btn.open.hint": "空のフォルダなら新規、データがあれば続きから",
  "btn.openLast": "前回のフォルダを開く",
  "btn.openLast.named": "前回のフォルダを開く ({name})",
  "marp.popupBlocked": "ポップアップがブロックされました。ポップアップを許可してください。",
  "btn.start": "録音開始",
  "btn.resume": "録音再開",
  "btn.end": "録音終了",
  "btn.timerStart": "タイマー開始",
  "btn.timerStop": "停止",
  "btn.timerReset": "リセット",
  "btn.copy": "コピー",
  "btn.downloadMd": "slides.md をダウンロード",
  "btn.downloadHtml": "HTML をダウンロード",
  "btn.print": "印刷 / PDF",
  "copy.done": "コピーしました",
  "copy.fail": "コピーできませんでした",

  // ---- glossary ----
  "glossary.label": "固有名詞",
  "glossary.placeholder": "AI が登録",
  "glossary.hint": "AI が話の文脈から登録します (文字起こしの精度に効きます)",

  // ---- tutorial ----
  "tut.close.title": "閉じる",
  "tut.setup.strong": "AI がまだ接続されていません。",
  "tut.setup.rest": "文字起こしは動いていますが、質問やスライド作成は AI が WebMCP 経由で行います。",
  "tut.setup.hint": "接続されると上のバッジが「AI 待機中」になり、この案内は自動で消えます。",
  "tut.away.strong": "AI が待機していません。",
  "tut.away.rest":
    "最後の呼び出しは{since}です。AI に「続けて」と伝えてください (別の作業中や、セッションが終了した可能性があります)。",
  "tut.away.hint": "AI がツールを呼ぶとこの案内は自動で消えます。",
  "tut.choose": "つなぎ方は 2 通りあります。どちらか一方を選んでください。",
  "tut.relay.title": "A. Chrome 拡張 WebMCP Cloud Relay",
  "tut.relay.tag": "手軽・いま開いているこのタブをそのまま使う",
  "tut.relay.desc":
    "拡張がこのタブのツールを relay サーバー (Cloudflare Workers) 経由で MCP として公開し、AI はその URL に接続します。",
  "tut.relay.pro":
    "○ 拡張を入れるだけ。Chrome のバージョンや起動フラグを問わず、AI が別のマシンやクラウドで動いていてもつながります。",
  "tut.relay.con":
    "△ ツール呼び出しの内容 (文字起こしやスライド) が relay サーバーを通ります。気になる場合は下の「relay を自分でホストする」を参照。",
  "tut.cdm.title": "B. chrome-devtools-mcp",
  "tut.cdm.tag": "Google 公式・すべて手元で完結",
  "tut.cdm.desc":
    " は AI が Chrome を直接操作するための MCP サーバーで、実験的にページの WebMCP ツールを呼べます。AI が専用の Chrome ウィンドウを起動し、そこでこのページを使います。",
  "tut.cdm.pro": "○ 拡張も外部サーバーも不要で、通信はこのマシンの中で完結します。",
  "tut.cdm.con":
    "△ Chrome 150 以上と Node.js が必要で、AI は同じマシンで動いている必要があります。AI はそのウィンドウのブラウザ全体を操作できます。専用プロファイルなので、音声認識モデルのダウンロードやマイク・フォルダの許可はそのウィンドウでやり直しです。",
  "tut.cdm.step1": "Chrome 150 以上と Node.js (LTS) を用意する。",
  "tut.cdm.step2": "AI に MCP サーバーを登録する:",
  "tut.cdm.step2.tail.pre": "Google への利用統計の送信を止めるには ",
  "tut.cdm.step2.tail.post": " を足します。",
  "tut.cdm.step3": "AI を起動して、次の一文を送る:",
  "tut.cdm.step4":
    "AI が開いた Chrome ウィンドウでプロジェクトフォルダを選び、録音を始める (このタブは閉じてかまいません)。",
  "tut.agentPromptCdm":
    "chrome-devtools で {url} を開いてください。そのページの WebMCP ツールを list_webmcp_tools で確認し、execute_webmcp_tool で get_instructions を呼んで手順を読み、その通りに進行役をしてください。",
  "tut.step1.pre": "Chrome 拡張 ",
  "tut.step1.post": " をインストールする。",
  "tut.step2": "拡張のポップアップを開き、MCP URL をコピーして AI に登録する:",
  "tut.codexComment": "# Codex の場合",
  "tut.step3.pre": "このタブで拡張のポップアップを開き、",
  "tut.step3.post": " を押す (バッジが緑になる)。",
  "tut.step4.pre": "AI を起動して、次の一文を送る (手順はページが ",
  "tut.step4.post": " ツールで渡します):",
  "tut.step4.tail.pre": "ツールが見えないときは MCP を再接続 (Claude Code なら ",
  "tut.step4.tail.post": ")。",
  "tut.agentPrompt":
    "Ramble to Slides のページに WebMCP で接続しています。まず get_instructions を呼んで手順を読み、その通りに進行役をしてください。",
  "tut.alt.summary": "そのほかの方法と補足",
  "tut.alt.intro.pre": "このページは標準の ",
  "tut.alt.intro.post": " (WebMCP) にツールを登録しているだけなので、それを読める仕組みなら何でも使えます。",
  "tut.alt.selfhost.title": "relay を自分でホストする",
  "tut.alt.selfhost.pre": ": 上の拡張はそのままに、",
  "tut.alt.selfhost.link": "自分の Cloudflare Workers",
  "tut.alt.selfhost.post": " に relay を置くと、話した内容が第三者のサーバーを経由しなくなります。",
  "tut.alt.native.title": "ブラウザ内蔵のエージェント (将来)",
  "tut.alt.native.body":
    ": Chrome はネイティブ WebMCP を origin trial 中 (Chrome 149〜156) で、ツールを呼べるのは今のところ Gemini in Chrome だけ、しかも提携サイトでの試験段階です。一般のページから使えるようになれば、拡張なしで動きます。",
  "tut.alt.chatgpt.title": "ChatGPT デスクトップアプリの内蔵ブラウザ",
  "tut.alt.chatgpt.pre": ": ",
  "tut.alt.chatgpt.link": "WebMCP に対応",
  "tut.alt.chatgpt.post":
    "していてツールは呼べますが、内蔵ブラウザが File System Access API に対応しておらずプロジェクトフォルダを開けないため、このページは使えません。",
  "tut.alt.claude.title": "Claude in Chrome",
  "tut.alt.claude.pre": ": 現時点では WebMCP 非対応です (",
  "tut.alt.claude.link": "機能要望が open",
  "tut.alt.claude.post": ")。Claude を使うなら上の A か B で Claude Code につなぎます。",
  "tut.alt.check.title": "動作確認",
  "tut.alt.check.pre": ": ",
  "tut.alt.check.link": "Model Context Tool Inspector",
  "tut.alt.check.post": " 拡張で、このページが公開しているツール一覧とスキーマを確認できます。",
  "tut.alt.more.pre": "ほかの実装は ",
  "tut.alt.more.post": " にまとまっています。",

  // ---- transcript panel ----
  "panel.transcript": "文字起こし",
  "transcript.empty": "「録音開始」を押すと文字起こしが出ます。",
  "seg.badge": "修正",
  "seg.original": "元の文字起こし: {text}",

  // ---- question panel ----
  "panel.questions": "質問",
  "q.none": "まだ質問はありません。",
  "q.waiting": "次の質問を待っています…",
  "q.hint": "声で答えてください。「質問して」「そろそろ終わり」なども声で伝わります",
  "q.history.summary": "これまでの質問と回答",
  "q.history.none": "まだありません。",
  "q.unprompted": "(自発的な回答)",
  "q.unanswered": "未回答",
  "src.spoken": "口頭",
  "src.typed": "入力",
  "src.skipped": "スキップ",

  // ---- notes ----
  "notes.label": "メモ",
  "notes.placeholder": "AI がここにメモを書きます",
  "notes.history.title": "メモの履歴から復元",

  // ---- history dropdowns ----
  "doc.history.title": "この文書の履歴から復元",
  "history.head": "履歴 ({count} 件)",
  "hist.src.agent": "AI",
  "hist.src.user": "手動",
  "hist.src.restore": "復元",
  "hist.label": "{time} {source} {chars}字",
  "hist.restoreFailed": "履歴を復元できませんでした: {error}",
  "hist.beforeRestore": "復元前の内容",

  // ---- outline / slides ----
  "tab.outline": "アウトライン",
  "tab.slides": "スライド",
  "outline.empty": "エージェントがアウトラインを作ると、ここに表示されます。",
  "slides.empty": "エージェントがスライドを作ると、ここに表示されます。",
  "slides.frame.title": "スライドのプレビュー",
  "slides.count": "{n} 枚",

  // ---- status line (state only; successes go to the console) ----
  "status.idle": "待機中",
  "status.recording": "録音中",
  "status.ending": "録音を終了しています…",
  "status.savingAudio": "音声を保存しています…",
  "status.draining": "文字起こしの残りを処理しています…",
  "status.ended": "終了しました",
  "status.modelPreparing": "モデルを準備しています…",
  "status.modelLoading": "モデルを読み込んでいます…",
  "status.modelNextRecording": "認識エンジンの変更は次の録音から適用されます。",
  "status.micPreparing": "マイクを準備しています…",
  "status.needProject": "先に保存先フォルダを選んでください。",
  "status.transcribeFailed": "文字起こしに失敗しました: {message}",
  "status.asrInitFailed": "音声認識を初期化できません: {message}",
  "status.modelLoadFailed": "モデルの読み込みに失敗しました: {message}",
  "status.chooseModel": "この PC では WebGPU が使えません。設定で音声認識の方式を選んでください",
  "status.recordError": "録音エラー: {message}",
  "status.recordStartFailed": "録音を開始できませんでした: {message}",
  "status.saveAudioFailed": "音声の保存に失敗しました: {message}",
  "status.drainTimeout": "文字起こしが終わらないので、そのまま終了します",
  "status.openFailed": "フォルダを開けませんでした: {message}",
  "status.noLastProject": "前回のプロジェクトは見つかりませんでした。",
  "status.openLastFailed": "前回のフォルダを開けませんでした: {message}",

  // ---- ASR progress ----
  "asr.idle": "モデル未読み込み",
  "asr.downloading": "モデルをダウンロード中 ({loadedMB} / {totalMB} MB)",
  "asr.cache": "モデルをキャッシュから読み込み中 ({loadedMB} / {totalMB} MB)",
  "asr.preparing": "モデルを準備中 ({label})…",
  "asr.warmup": "ウォームアップ中…",
  "asr.installing": "ブラウザが端末内音声認識の言語パックをインストール中…",
  "asr.ready": "準備完了 ({backend})",
  "asr.error": "モデルの読み込みに失敗: {message}",
  "asr.chooseModel": "音声認識の方式が未選択",

  // ---- storage ----
  "store.insecure":
    "保存先を選ぶには HTTPS か localhost で開いてください (File System Access API は安全なコンテキストでのみ使えます)。",
  "store.unsupported": "このブラウザは File System Access API に対応していません。Chrome / Edge で開いてください。",
  "store.writeFailed": "{name} を保存できませんでした: {message}",
  "store.historyWriteFailed": "history/{doc} に履歴を保存できませんでした: {message}",
  "store.historyDirFailed": "history/{doc} を作成できませんでした",
  "store.permissionDenied": "このフォルダへの書き込みが許可されませんでした。",
  "store.lastPermissionDenied": "前回のフォルダへのアクセスが許可されませんでした。もう一度選び直してください。",

  // ---- WebMCP ----
  "mcp.unavailable": "WebMCP を利用できません (ツール未登録)",
  "mcp.partial": "WebMCP ツールを {n}/{total} 件しか登録できませんでした",
} as const;

export type MessageKey = keyof typeof ja;

const en: Record<MessageKey, string> = {
  // ---- header ----
  "hdr.project.none": "No project",
  "hdr.speaking": "Speaking",
  "hdr.agent.title": "Whether the AI is waiting in wait_for_event",
  "hdr.uiLang": "Display",
  "settings.title": "Project settings",
  "settings.folder": "Folder",
  "settings.speechLang": "Speech language",
  "settings.asrModel": "Speech model",
  "settings.modelCache": "Downloaded models",
  "modelCache.size": "{mb} MB",
  "modelCache.none": "none",
  "modelCache.unknown": "unknown",
  "modelCache.hint": "whisper models are kept in the browser cache. Deleting them frees the space; a model is downloaded again when chosen",
  "btn.clearCache": "Delete",
  "status.cacheCleared": "Downloaded models deleted",
  "status.cacheClearFailed": "Could not delete the models: {message}",
  "asrModel.choose": "Choose one",
  "asrModel.turbo": "whisper accurate (large-v3-turbo, ~1.5 GB, needs a GPU)",
  "asrModel.small": "whisper light (small, ~0.4 GB, accuracy is poor)",
  "asrModel.webspeechLocal": "Browser built-in, on-device (Chrome 139+, audio stays on this machine)",
  "asrModel.webspeechCloud": "Browser built-in, cloud (Chrome sends audio to Google, Edge to Microsoft)",
  "asrModel.hint":
    "With WebGPU the accurate whisper is the default. Without it, choose here. The browser's own recognizer is free and light; accuracy depends on the device and browser. Not available in Brave, Firefox or plain Chromium",
  "lang.ja": "日本語",
  "lang.en": "English",

  "agent.idle": "AI not connected",
  "agent.waiting": "AI waiting",
  "agent.away": "AI away ({since})",
  "since.lt1m": "under a minute",
  "since.min": "{n} min ago",

  // ---- buttons ----
  "start.lead": "Turn a rambling talk into a first draft of a slide deck.",
  "btn.open": "Choose a folder",
  "btn.switchProject": "Open project",
  "btn.open.hint": "An empty folder starts a new project; a folder with data resumes it",
  "btn.openLast": "Open last folder",
  "btn.openLast.named": "Open last folder ({name})",
  "marp.popupBlocked": "The popup was blocked. Please allow popups for this page.",
  "btn.start": "Start recording",
  "btn.resume": "Resume recording",
  "btn.end": "Stop recording",
  "btn.timerStart": "Start timer",
  "btn.timerStop": "Stop",
  "btn.timerReset": "Reset",
  "btn.copy": "Copy",
  "btn.downloadMd": "Download slides.md",
  "btn.downloadHtml": "Download HTML",
  "btn.print": "Print / PDF",
  "copy.done": "Copied",
  "copy.fail": "Could not copy",

  // ---- glossary ----
  "glossary.label": "Proper nouns",
  "glossary.placeholder": "Added by the AI",
  "glossary.hint": "The AI adds terms from what you say (it improves transcription accuracy)",

  // ---- tutorial ----
  "tut.close.title": "Close",
  "tut.setup.strong": "The AI is not connected yet.",
  "tut.setup.rest": "Transcription is running, but the questions and the slides are the AI's job, through WebMCP.",
  "tut.setup.hint": 'Once it connects the badge above turns to "AI waiting" and this notice disappears.',
  "tut.away.strong": "The AI is not waiting.",
  "tut.away.rest": 'Last call: {since}. Tell the AI to continue; it may be busy with something else, or its session ended.',
  "tut.away.hint": "This notice disappears as soon as the AI calls a tool.",
  "tut.choose": "There are two ways to connect. Pick one.",
  "tut.relay.title": "A. The WebMCP Cloud Relay Chrome extension",
  "tut.relay.tag": "easy; keeps using this very tab",
  "tut.relay.desc":
    "The extension publishes this tab's tools as MCP through a relay server (Cloudflare Workers), and your AI connects to that URL.",
  "tut.relay.pro":
    "+ Just install the extension. Any Chrome version, no launch flags, and the AI may run on another machine or in the cloud.",
  "tut.relay.con":
    "- Tool calls (transcript, slides) pass through the relay server. If that matters, see \"Host the relay yourself\" below.",
  "tut.cdm.title": "B. chrome-devtools-mcp",
  "tut.cdm.tag": "official from Google; everything stays local",
  "tut.cdm.desc":
    " is an MCP server that lets an AI drive Chrome directly, and it can experimentally call a page's WebMCP tools. The AI launches its own Chrome window and you use this page there.",
  "tut.cdm.pro": "+ No extension and no outside server: all traffic stays on this machine.",
  "tut.cdm.con":
    "- Needs Chrome 150+ and Node.js, and the AI must run on the same machine. The AI can control everything in that browser window. It uses a separate profile, so the speech model download and the mic / folder permissions start over in that window.",
  "tut.cdm.step1": "Have Chrome 150 or newer and Node.js (LTS).",
  "tut.cdm.step2": "Register the MCP server with your AI:",
  "tut.cdm.step2.tail.pre": "Add ",
  "tut.cdm.step2.tail.post": " to stop sending usage statistics to Google.",
  "tut.cdm.step3": "Start your AI and send it this sentence:",
  "tut.cdm.step4": "In the Chrome window the AI opened, pick the project folder and start recording (this tab can be closed).",
  "tut.agentPromptCdm":
    "Open {url} with chrome-devtools. Check that page's WebMCP tools with list_webmcp_tools, call get_instructions through execute_webmcp_tool, read the playbook, and then facilitate according to it.",
  "tut.step1.pre": "Install the Chrome extension ",
  "tut.step1.post": ".",
  "tut.step2": "Open the extension popup, copy the MCP URL and register it with your AI:",
  "tut.codexComment": "# for Codex",
  "tut.step3.pre": "Open the extension popup on this tab and press ",
  "tut.step3.post": " (the badge turns green).",
  "tut.step4.pre": "Start your AI and send it this sentence (the page hands over the playbook through the ",
  "tut.step4.post": " tool):",
  "tut.step4.tail.pre": "If the tools do not show up, reconnect MCP (in Claude Code, ",
  "tut.step4.tail.post": ").",
  "tut.agentPrompt": "I am connected to the Ramble to Slides page via WebMCP. First call get_instructions, read the playbook, and then facilitate according to it.",
  "tut.alt.summary": "Other ways and notes",
  "tut.alt.intro.pre": "This page only registers its tools with the standard ",
  "tut.alt.intro.post": " (WebMCP), so anything that can read those works.",
  "tut.alt.selfhost.title": "Host the relay yourself",
  "tut.alt.selfhost.pre": ": keep the extension above and put the relay on ",
  "tut.alt.selfhost.link": "your own Cloudflare Workers",
  "tut.alt.selfhost.post": ". What you say then never passes through a third party's server.",
  "tut.alt.native.title": "Agents built into the browser (future)",
  "tut.alt.native.body": ": Chrome has native WebMCP in an origin trial (Chrome 149-156); so far only Gemini in Chrome can call the tools, and only on partner sites. Once ordinary pages can use it, no extension will be needed.",
  "tut.alt.chatgpt.title": "The ChatGPT desktop app's built-in browser",
  "tut.alt.chatgpt.pre": ": it ",
  "tut.alt.chatgpt.link": "supports WebMCP",
  "tut.alt.chatgpt.post": " and can call the tools, but that browser lacks the File System Access API, so the project folder cannot be opened and this page does not work there.",
  "tut.alt.claude.title": "Claude in Chrome",
  "tut.alt.claude.pre": ": no WebMCP support for now (",
  "tut.alt.claude.link": "the feature request is open",
  "tut.alt.claude.post": "). To use Claude, connect Claude Code through A or B above.",
  "tut.alt.check.title": "Checking the setup",
  "tut.alt.check.pre": ": the ",
  "tut.alt.check.link": "Model Context Tool Inspector",
  "tut.alt.check.post": " extension shows the tools and schemas this page exposes.",
  "tut.alt.more.pre": "More implementations are collected in ",
  "tut.alt.more.post": ".",

  // ---- transcript panel ----
  "panel.transcript": "Transcript",
  "transcript.empty": "Press Start recording and the transcript shows up here.",
  "seg.badge": "fixed",
  "seg.original": "Raw transcript: {text}",

  // ---- question panel ----
  "panel.questions": "Questions",
  "q.none": "No questions yet.",
  "q.waiting": "Waiting for the next question…",
  "q.hint": "Answer out loud. Saying \"ask me something\" or \"let's wrap up\" works too.",
  "q.history.summary": "Questions and answers so far",
  "q.history.none": "Nothing yet.",
  "q.unprompted": "(unprompted note)",
  "q.unanswered": "Unanswered",
  "src.spoken": "spoken",
  "src.typed": "typed",
  "src.skipped": "skipped",

  // ---- notes ----
  "notes.label": "Memo",
  "notes.placeholder": "The AI keeps its notes here",
  "notes.history.title": "Restore the memo from history",

  // ---- history dropdowns ----
  "doc.history.title": "Restore this document from history",
  "history.head": "History ({count})",
  "hist.src.agent": "AI",
  "hist.src.user": "manual",
  "hist.src.restore": "restored",
  "hist.label": "{time} {source} {chars} chars",
  "hist.restoreFailed": "Could not restore that generation: {error}",
  "hist.beforeRestore": "Content before the restore",

  // ---- outline / slides ----
  "tab.outline": "Outline",
  "tab.slides": "Slides",
  "outline.empty": "The agent's outline shows up here.",
  "slides.empty": "The agent's slides show up here.",
  "slides.frame.title": "Slide preview",
  "slides.count": "{n} slides",

  // ---- status line (state only; successes go to the console) ----
  "status.idle": "Idle",
  "status.recording": "Recording",
  "status.ending": "Stopping the recording…",
  "status.savingAudio": "Saving the audio…",
  "status.draining": "Finishing the last transcriptions…",
  "status.ended": "Ended",
  "status.modelPreparing": "Preparing the model…",
  "status.modelLoading": "Loading the model…",
  "status.modelNextRecording": "The recognizer change applies from the next recording.",
  "status.micPreparing": "Preparing the microphone…",
  "status.needProject": "Choose a folder first.",
  "status.transcribeFailed": "Transcription failed: {message}",
  "status.asrInitFailed": "Could not initialize speech recognition: {message}",
  "status.modelLoadFailed": "Could not load the model: {message}",
  "status.chooseModel": "This PC has no WebGPU. Choose a speech recognizer in the settings",
  "status.recordError": "Recording error: {message}",
  "status.recordStartFailed": "Could not start recording: {message}",
  "status.saveAudioFailed": "Could not save the audio: {message}",
  "status.drainTimeout": "Transcription is not finishing; ending anyway",
  "status.openFailed": "Could not open the folder: {message}",
  "status.noLastProject": "No previous project was found.",
  "status.openLastFailed": "Could not open the last folder: {message}",

  // ---- ASR progress ----
  "asr.idle": "Model not loaded",
  "asr.downloading": "Downloading model ({loadedMB} / {totalMB} MB)",
  "asr.cache": "Loading model from cache ({loadedMB} / {totalMB} MB)",
  "asr.preparing": "Preparing model ({label})…",
  "asr.warmup": "Warming up…",
  "asr.installing": "The browser is installing its on-device language pack…",
  "asr.ready": "Ready ({backend})",
  "asr.error": "Model loading failed: {message}",
  "asr.chooseModel": "No speech recognizer chosen",

  // ---- storage ----
  "store.insecure": "Open the page over HTTPS or on localhost to pick a folder (the File System Access API needs a secure context).",
  "store.unsupported": "This browser does not support the File System Access API. Use Chrome or Edge.",
  "store.writeFailed": "Could not save {name}: {message}",
  "store.historyWriteFailed": "Could not save a generation in history/{doc}: {message}",
  "store.historyDirFailed": "Could not create history/{doc}",
  "store.permissionDenied": "Writing to that folder was not allowed.",
  "store.lastPermissionDenied": "Access to the last folder was not allowed. Please pick it again.",

  // ---- WebMCP ----
  "mcp.unavailable": "WebMCP is unavailable (no tools registered)",
  "mcp.partial": "Only {n} of {total} WebMCP tools could be registered",
};

const DICT: Record<Locale, Record<MessageKey, string>> = { ja, en };


export type Params = Record<string, string | number>;

function browserLocale(): Locale {
  const tag = typeof navigator === "undefined" ? "" : (navigator.language ?? "");
  return tag.toLowerCase().startsWith("ja") ? "ja" : "en";
}

function stored(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "ja" || v === "en" ? v : null;
  } catch {
    return null; // private mode etc.
  }
}

let locale: Locale = stored() ?? browserLocale();

const listeners: Array<() => void> = [];

export function getLocale(): Locale {
  return locale;
}

/** Switch the UI language, remember it, and let every listener re-render. */
export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* switching still works even if the choice cannot be persisted */
  }
  document.documentElement.lang = next;
  for (const fn of listeners) {
    try {
      fn();
    } catch (e) {
      console.warn("locale listener failed", e);
    }
  }
}

/** Called after every setLocale, so the UI can redraw itself. */
export function onLocaleChange(fn: () => void): void {
  listeners.push(fn);
}

/** BCP 47 tag for Intl / toLocaleString. */
export function localeTag(): string {
  return locale === "ja" ? "ja-JP" : "en-US";
}

export function t(key: MessageKey, params?: Params): string {
  const template = DICT[locale][key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/**
 * Apply the static markup translations: data-i18n (textContent),
 * data-i18n-placeholder and data-i18n-title (attributes). Also keeps <html lang> in sync.
 */
export function applyI18n(root: ParentNode = document): void {
  document.documentElement.lang = locale;
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]")) {
    el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder as MessageKey));
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    el.setAttribute("title", t(el.dataset.i18nTitle as MessageKey));
  }
}
