const NOTES_KEY = 'msb-notes';
const SITES_KEY = 'msb-sites';
const API_KEY_KEY = 'msb-anthropic-key';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
const MODEL = 'claude-opus-5-5';
const MAX_HISTORY = 20;

const TYPE_LABELS = {
    blog: 'ブログ',
    portfolio: 'ポートフォリオ',
    website: 'ウェブサイト',
};

const TYPE_GUIDES = {
    blog: `ブログサイトを作成してください。
- メモ1件を基本的に1記事とし、内容を読みやすい記事に整えてください（見出し・段落・リストを適切に使う）。
- トップに記事一覧（タイトル・日付・タグ・抜粋）を置き、クリックで各記事を表示できるようにしてください（1ファイル内でハッシュリンクやJSによる切り替え）。
- タグ別の絞り込みやサイドバーのタグ一覧があると望ましいです。`,
    portfolio: `ポートフォリオサイトを作成してください。
- メモから、作者の人物像・スキル・制作物/実績・経歴・関心分野を読み取り、構成してください。
- ヒーローセクション（名前/肩書き/一言紹介）、About、Skills、Works（カード形式）、Contact などのセクションを想定してください。
- メモに書かれていない実績や経歴を創作しないでください。情報が足りない項目はセクションごと省くか、「ここに〇〇を追加」といった控えめなプレースホルダーにしてください。`,
    website: `一般的なウェブサイト（お店・サービス・団体・個人活動などの紹介サイト）を作成してください。
- メモの内容から、サイトの目的と対象読者を推測し、それにふさわしいページ構成（例: トップ、概要、サービス/メニュー、お知らせ、アクセス/お問い合わせ）にしてください。
- ナビゲーションから各セクションへスクロールできる1ページ構成を基本としてください。`,
};

const SYSTEM_PROMPT = `あなたは優秀なWebデザイナー兼フロントエンドエンジニアです。
ユーザーが書きためたメモをもとに、公開できる品質のWebサイトを1つのHTMLファイルとして作成します。

出力ルール:
- 出力は完成したHTMLドキュメントのみとし、<!DOCTYPE html> で始めて </html> で終えてください。前置きや説明、コードフェンス(\`\`\`)は付けないでください。
- CSSとJavaScriptはすべて <style> / <script> タグでHTML内に埋め込み、外部のCSS・JSファイルやフレームワークは読み込まないでください（Google Fonts の読み込みのみ可）。
- 画像ファイルは用意されていません。メモ内に画像URLがある場合のみ使用し、それ以外はCSSのグラデーション・図形・絵文字・インラインSVGで装飾してください。
- スマートフォンからPCまで崩れないレスポンシブデザインにしてください。
- 本文はメモと同じ言語（通常は日本語）で書いてください。lang属性も合わせてください。

内容のルール:
- メモに書かれている事実をもとに構成してください。誤字や読みにくい表現は整えて構いませんが、メモにない固有の事実（経歴、数値、受賞歴、連絡先など）を創作しないでください。
- 個人的すぎる情報（パスワード、住所、電話番号など公開に適さないもの）がメモに含まれていても、ユーザーが明示的に求めない限りサイトに載せないでください。
- TODOリストの未完了タスクなど、サイトの目的に合わないメモは無理に使わず省いて構いません。`;

class SiteGenerator {
    constructor(store) {
        this.store = store;
        this.notes = store.notes;
        this.sites = this.load(SITES_KEY, []);
        this.selected = new Set(this.notes.map(n => n.id));
        this.knownIds = new Set(this.selected);
        this.current = null; // { id, type, title, html, createdAt, noteIds }
        this.busy = false;

        this.$ = id => document.getElementById(id);
        this.notePicker = this.$('notePicker');
        this.tagFilter = this.$('tagFilter');
        this.statusEl = this.$('genStatus');
        this.generateBtn = this.$('generateBtn');
        this.previewFrame = this.$('previewFrame');
        this.codeOutput = this.$('codeOutput');
        this.apiKeyInput = this.$('apiKeyInput');
        this.rememberKey = this.$('rememberKey');

        const savedKey = this.loadRaw(API_KEY_KEY);
        if (savedKey) {
            this.apiKeyInput.value = savedKey;
            this.rememberKey.checked = true;
        }

        this.bindEvents();
        this.renderTagFilter();
        this.renderNotePicker();
        this.renderHistory();
        if (this.sites.length > 0) this.showSite(this.sites[0]);
    }

    load(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    loadRaw(key) {
        try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
    }

    bindEvents() {
        this.$('selectAllBtn').addEventListener('click', () => {
            this.visibleNotes().forEach(n => this.selected.add(n.id));
            this.renderNotePicker();
        });
        this.$('selectNoneBtn').addEventListener('click', () => {
            this.visibleNotes().forEach(n => this.selected.delete(n.id));
            this.renderNotePicker();
        });
        this.tagFilter.addEventListener('change', () => this.renderNotePicker());

        this.$('toggleKeyBtn').addEventListener('click', (e) => {
            const show = this.apiKeyInput.type === 'password';
            this.apiKeyInput.type = show ? 'text' : 'password';
            e.target.textContent = show ? '隠す' : '表示';
        });
        this.rememberKey.addEventListener('change', () => this.persistKey());
        this.apiKeyInput.addEventListener('change', () => this.persistKey());

        this.generateBtn.addEventListener('click', () => this.generate());
        this.$('refineBtn').addEventListener('click', () => this.refine());
        this.$('refineInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.isComposing) this.refine();
        });

        document.querySelectorAll('.result-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchView(tab.dataset.view));
        });
        this.$('downloadBtn').addEventListener('click', () => this.download());
        this.$('copyBtn').addEventListener('click', () => this.copy());
        this.$('fullscreenBtn').addEventListener('click', () => this.toggleFullscreen());
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.body.classList.contains('preview-fullscreen')) this.toggleFullscreen();
        });
    }

    persistKey() {
        try {
            if (this.rememberKey.checked && this.apiKeyInput.value.trim()) {
                localStorage.setItem(API_KEY_KEY, this.apiKeyInput.value.trim());
            } else {
                localStorage.removeItem(API_KEY_KEY);
            }
        } catch (_) { /* 保存できなくても動作は継続 */ }
    }

    // ---------- メモ選択 ----------

    visibleNotes() {
        const tag = this.tagFilter.value;
        return this.notes
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .filter(n => !tag || (n.tags || []).includes(tag));
    }

    // メモ画面で追加・削除されたメモを反映する（新しいメモは選択状態で追加）
    refreshNotes() {
        this.notes = this.store.notes;
        const ids = new Set(this.notes.map(n => n.id));
        this.notes.forEach(n => { if (!this.knownIds.has(n.id)) this.selected.add(n.id); });
        [...this.selected].forEach(id => { if (!ids.has(id)) this.selected.delete(id); });
        this.knownIds = ids;
        this.renderTagFilter();
        this.renderNotePicker();
    }

    renderTagFilter() {
        const current = this.tagFilter.value;
        while (this.tagFilter.options.length > 1) this.tagFilter.remove(1);
        const tags = [...new Set(this.notes.flatMap(n => n.tags || []))].sort();
        tags.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            this.tagFilter.appendChild(opt);
        });
        this.tagFilter.value = tags.includes(current) ? current : '';
    }

    renderNotePicker() {
        this.notePicker.innerHTML = '';
        const notes = this.visibleNotes();
        if (this.notes.length === 0) {
            this.notePicker.innerHTML = '<li class="picker-empty">メモがありません。「📝 メモ」タブでメモを書いてから戻ってきてください。</li>';
        }
        notes.forEach(note => {
            const li = document.createElement('li');
            li.className = 'picker-item';
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this.selected.has(note.id);
            cb.addEventListener('change', () => {
                if (cb.checked) this.selected.add(note.id);
                else this.selected.delete(note.id);
                this.updateSelectedCount();
            });
            const text = document.createElement('span');
            text.className = 'picker-text';
            const title = document.createElement('span');
            title.className = 'picker-title';
            title.textContent = note.title || '無題のメモ';
            const meta = document.createElement('span');
            meta.className = 'picker-meta';
            const tags = (note.tags || []).map(t => `#${t}`).join(' ');
            meta.textContent = [new Date(note.updatedAt).toLocaleDateString('ja-JP'), tags].filter(Boolean).join('  ');
            text.append(title, meta);
            label.append(cb, text);
            li.appendChild(label);
            this.notePicker.appendChild(li);
        });
        this.updateSelectedCount();
    }

    updateSelectedCount() {
        this.$('selectedCount').textContent = `${this.selected.size} / ${this.notes.length} 件選択中`;
    }

    // ---------- プロンプト組み立て ----------

    serializeNotes(notes) {
        return notes.map((n, i) => {
            const lines = [`<memo index="${i + 1}">`];
            lines.push(`タイトル: ${n.title || '(無題)'}`);
            lines.push(`更新日: ${new Date(n.updatedAt).toLocaleDateString('ja-JP')}`);
            if (n.tags && n.tags.length) lines.push(`タグ: ${n.tags.join(', ')}`);
            lines.push('内容:');
            lines.push(n.body || '');
            lines.push('</memo>');
            return lines.join('\n');
        }).join('\n\n');
    }

    buildRequest() {
        const type = document.querySelector('input[name="siteType"]:checked').value;
        const notes = this.notes
            .filter(n => this.selected.has(n.id))
            .sort((a, b) => b.updatedAt - a.updatedAt);
        const siteName = this.$('siteName').value.trim();
        const style = this.$('styleSelect').value;
        const color = this.$('colorInput').value;
        const extra = this.$('extraInput').value.trim();

        const prompt = [
            `以下のメモ（${notes.length}件）をもとに、${TYPE_LABELS[type]}を作ってください。`,
            '',
            TYPE_GUIDES[type],
            '',
            'デザインの希望:',
            `- 雰囲気: ${style}`,
            `- メインカラー: ${color}`,
            siteName ? `- サイト名: ${siteName}` : '- サイト名: メモの内容から適切なものを考えてください',
            extra ? `\nユーザーからの追加の要望:\n${extra}` : '',
            '',
            '<memos>',
            this.serializeNotes(notes),
            '</memos>',
        ].join('\n');

        return { type, notes, prompt, siteName };
    }

    // ---------- 生成 ----------

    async getClient() {
        const apiKey = this.apiKeyInput.value.trim();
        if (!apiKey) throw new UserError('Claude API キーを入力してください。');
        this.persistKey();
        let Anthropic;
        try {
            ({ default: Anthropic } = await import(SDK_URL));
        } catch (_) {
            throw new UserError('AIライブラリの読み込みに失敗しました。ネットワーク接続を確認してください。');
        }
        return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    }

    async generate() {
        if (this.busy) return;
        const req = this.buildRequest();
        if (req.notes.length === 0) {
            this.setStatus('メモを1件以上選択してください。', 'error');
            return;
        }
        const html = await this.runClaude([{ role: 'user', content: req.prompt }]);
        if (!html) return;
        const site = {
            id: Date.now().toString(),
            type: req.type,
            title: this.extractTitle(html) || req.siteName || TYPE_LABELS[req.type],
            html,
            createdAt: Date.now(),
            noteIds: req.notes.map(n => n.id),
            prompt: req.prompt,
        };
        this.saveSite(site);
        this.showSite(site);
        this.switchView('preview');
    }

    async refine() {
        if (this.busy || !this.current) return;
        const input = this.$('refineInput');
        const request = input.value.trim();
        if (!request) return;

        const messages = [];
        if (this.current.prompt) {
            messages.push({ role: 'user', content: this.current.prompt });
            messages.push({ role: 'assistant', content: this.current.html });
            messages.push({ role: 'user', content: `次の修正をして、修正後のHTMLドキュメント全体を出力してください。\n\n修正内容: ${request}` });
        } else {
            messages.push({
                role: 'user',
                content: `次のHTMLサイトに修正を加えて、修正後のHTMLドキュメント全体を出力してください。\n\n修正内容: ${request}\n\n<current_html>\n${this.current.html}\n</current_html>`,
            });
        }
        const html = await this.runClaude(messages);
        if (!html) return;
        const site = {
            ...this.current,
            id: Date.now().toString(),
            title: this.extractTitle(html) || this.current.title,
            html,
            createdAt: Date.now(),
            prompt: this.current.prompt
                ? `${this.current.prompt}\n\n(追加の修正: ${request})`
                : undefined,
        };
        this.saveSite(site);
        this.showSite(site);
        input.value = '';
        this.switchView('preview');
    }

    async runClaude(messages) {
        this.setBusy(true);
        this.setStatus('AIの準備中...', 'progress');
        try {
            const client = await this.getClient();
            const stream = client.beta.messages.stream({
                model: MODEL,
                max_tokens: 64000,
                thinking: { type: 'adaptive' },
                output_config: { effort: 'medium' },
                // 安全分類器による誤検知でリクエストが止まった場合、別モデルで自動再試行する
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                system: SYSTEM_PROMPT,
                messages,
            });

            let text = '';
            let thinkingShown = false;
            this.codeOutput.textContent = '';
            stream.on('streamEvent', (event) => {
                if (event.type === 'content_block_start' && event.content_block.type === 'thinking' && !thinkingShown) {
                    thinkingShown = true;
                    this.setStatus('AIがメモを読んで構成を考えています...', 'progress');
                }
            });
            stream.on('text', (delta) => {
                text += delta;
                this.setStatus(`サイトを書いています... (${text.length.toLocaleString()} 文字)`, 'progress');
                this.codeOutput.textContent = text;
                this.codeOutput.scrollTop = this.codeOutput.scrollHeight;
            });

            const message = await stream.finalMessage();

            if (message.stop_reason === 'refusal') {
                this.setStatus('この内容ではサイトを生成できませんでした。使うメモや要望を変えて再度お試しください。', 'error');
                return null;
            }
            const finalText = message.content
                .filter(b => b.type === 'text')
                .map(b => b.text)
                .join('');
            const html = this.extractHtml(finalText);
            if (!html) {
                this.setStatus('HTMLを取り出せませんでした。もう一度お試しください。', 'error');
                return null;
            }
            if (message.stop_reason === 'max_tokens') {
                this.setStatus('サイトが長すぎて途中で終わりました。メモの数を減らすと改善します。', 'error');
            } else {
                this.setStatus('サイトができました！', 'success');
            }
            return html;
        } catch (err) {
            this.setStatus(this.describeError(err), 'error');
            return null;
        } finally {
            this.setBusy(false);
        }
    }

    describeError(err) {
        if (err instanceof UserError) return err.message;
        const status = err && err.status;
        if (status === 401) return 'API キーが正しくありません。キーを確認してください。';
        if (status === 403) return 'この API キーではこの操作が許可されていません。';
        if (status === 429) return 'リクエストが多すぎます。しばらく待ってから再度お試しください。';
        if (status === 529 || (status && status >= 500)) return 'AIサービスが混み合っています。しばらく待ってから再度お試しください。';
        if (status === 400) return `リクエストが受け付けられませんでした: ${err.message || ''}`;
        if (err && err.name === 'APIConnectionError') return 'AIサービスに接続できませんでした。ネットワークを確認してください。';
        return `エラーが発生しました: ${(err && err.message) || err}`;
    }

    extractHtml(text) {
        let t = text.trim();
        const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
        if (fence && !/^<!DOCTYPE|^<html/i.test(t)) t = fence[1].trim();
        const start = t.search(/<!DOCTYPE html|<html/i);
        if (start === -1) return null;
        t = t.slice(start);
        const end = t.toLowerCase().lastIndexOf('</html>');
        return end === -1 ? t : t.slice(0, end + '</html>'.length);
    }

    extractTitle(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return (doc.title || '').trim();
    }

    // ---------- 表示・保存 ----------

    saveSite(site) {
        this.sites.unshift(site);
        this.sites = this.sites.slice(0, MAX_HISTORY);
        // 容量オーバー時は古い履歴から削って保存を試みる
        while (this.sites.length > 0) {
            try {
                localStorage.setItem(SITES_KEY, JSON.stringify(this.sites));
                break;
            } catch (_) {
                if (this.sites.length === 1) break;
                this.sites.pop();
            }
        }
        this.renderHistory();
    }

    showSite(site) {
        this.current = site;
        this.$('emptyState').hidden = true;
        this.previewFrame.hidden = false;
        this.previewFrame.srcdoc = site.html;
        this.codeOutput.textContent = site.html;
        ['downloadBtn', 'copyBtn', 'fullscreenBtn'].forEach(id => { this.$(id).disabled = false; });
        this.$('refineBar').hidden = false;
        this.renderHistory();
    }

    renderHistory() {
        const list = this.$('historyList');
        list.innerHTML = '';
        if (this.sites.length === 0) {
            list.innerHTML = '<li class="history-empty">まだ生成したサイトはありません。</li>';
            return;
        }
        this.sites.forEach(site => {
            const li = document.createElement('li');
            li.className = 'history-item' + (this.current && this.current.id === site.id ? ' active' : '');
            const info = document.createElement('button');
            info.className = 'history-open';
            const badge = document.createElement('span');
            badge.className = `history-badge ${site.type}`;
            badge.textContent = TYPE_LABELS[site.type] || site.type;
            const title = document.createElement('span');
            title.className = 'history-title';
            title.textContent = site.title;
            const date = document.createElement('span');
            date.className = 'history-date';
            date.textContent = new Date(site.createdAt).toLocaleString('ja-JP');
            info.append(badge, title, date);
            info.addEventListener('click', () => {
                this.showSite(site);
                this.switchView('preview');
            });
            const del = document.createElement('button');
            del.className = 'history-delete';
            del.title = '削除';
            del.textContent = '×';
            del.addEventListener('click', () => {
                if (!confirm(`「${site.title}」を履歴から削除しますか？`)) return;
                this.sites = this.sites.filter(s => s.id !== site.id);
                try { localStorage.setItem(SITES_KEY, JSON.stringify(this.sites)); } catch (_) { /* noop */ }
                this.renderHistory();
            });
            li.append(info, del);
            list.appendChild(li);
        });
    }

    switchView(view) {
        document.querySelectorAll('.result-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
        this.$('previewView').hidden = view !== 'preview';
        this.$('codeView').hidden = view !== 'code';
        this.$('historyView').hidden = view !== 'history';
    }

    setBusy(busy) {
        this.busy = busy;
        this.generateBtn.disabled = busy;
        this.$('refineBtn').disabled = busy;
        this.generateBtn.textContent = busy ? '生成中...' : '✨ サイトを生成する';
        if (busy) this.switchView('code');
    }

    setStatus(text, kind) {
        this.statusEl.textContent = text;
        this.statusEl.className = `gen-status ${kind || ''}`;
    }

    fileName() {
        const base = (this.current.title || 'site')
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, '_')
            .slice(0, 40) || 'site';
        return `${base}.html`;
    }

    download() {
        if (!this.current) return;
        const blob = new Blob([this.current.html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.fileName();
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async copy() {
        if (!this.current) return;
        try {
            await navigator.clipboard.writeText(this.current.html);
            this.setStatus('HTMLをコピーしました。', 'success');
        } catch (_) {
            this.setStatus('コピーできませんでした。HTMLタブから手動でコピーしてください。', 'error');
        }
    }

    toggleFullscreen() {
        // 生成されたHTMLはこのアプリと同じオリジンで開かず、サンドボックス化した iframe のまま拡大表示する
        const on = document.body.classList.toggle('preview-fullscreen');
        this.$('fullscreenBtn').textContent = on ? '✕ 閉じる' : '⛶ 全画面';
        if (on) this.switchView('preview');
    }
}

class UserError extends Error {}


// =====================================================================
// メモ
// =====================================================================

class MemoStore {
    constructor() {
        try {
            const raw = localStorage.getItem(NOTES_KEY);
            this.notes = raw ? JSON.parse(raw) : [];
        } catch (_) {
            this.notes = [];
        }
    }

    save() {
        try {
            localStorage.setItem(NOTES_KEY, JSON.stringify(this.notes));
            return true;
        } catch (_) {
            return false;
        }
    }

    create() {
        const note = { id: Date.now().toString(), title: '', body: '', tags: [], updatedAt: Date.now() };
        this.notes.unshift(note);
        this.save();
        return note;
    }

    remove(id) {
        const idx = this.notes.findIndex(n => n.id === id);
        if (idx !== -1) this.notes.splice(idx, 1);
        this.save();
    }

    get(id) {
        return this.notes.find(n => n.id === id);
    }
}

class MemoEditor {
    constructor(store) {
        this.store = store;
        this.activeId = null;
        this.$ = id => document.getElementById(id);
        this.list = this.$('memoList');
        this.title = this.$('memoTitle');
        this.body = this.$('memoBody');
        this.tagInput = this.$('memoTagInput');
        this.search = this.$('memoSearch');

        this.$('newMemoBtn').addEventListener('click', () => {
            const note = this.store.create();
            this.search.value = '';
            this.select(note.id);
            this.title.focus();
        });
        this.$('deleteMemoBtn').addEventListener('click', () => this.deleteActive());
        this.title.addEventListener('input', () => this.saveActive());
        this.body.addEventListener('input', () => this.saveActive());
        this.tagInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing) return;
            e.preventDefault();
            this.addTag();
        });
        this.search.addEventListener('input', () => this.renderList());
        this.$('exportBtn').addEventListener('click', () => this.exportCsv());
        this.$('importInput').addEventListener('change', (e) => this.importCsv(e));

        const first = this.sortedNotes()[0];
        if (first) this.select(first.id);
        else this.renderAll();
    }

    sortedNotes() {
        return this.store.notes.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    }

    select(id) {
        this.activeId = id;
        const note = this.store.get(id);
        if (note) {
            this.title.value = note.title;
            this.body.value = note.body;
        }
        this.renderAll();
    }

    renderAll() {
        const note = this.store.get(this.activeId);
        this.$('memoEmpty').hidden = !!note;
        this.$('memoForm').hidden = !note;
        if (note) {
            this.renderTags(note);
            this.$('memoUpdated').textContent = `更新: ${new Date(note.updatedAt).toLocaleString('ja-JP')}`;
        }
        this.renderList();
    }

    saveActive() {
        const note = this.store.get(this.activeId);
        if (!note) return;
        note.title = this.title.value;
        note.body = this.body.value;
        note.updatedAt = Date.now();
        this.store.save();
        this.$('memoUpdated').textContent = `更新: ${new Date(note.updatedAt).toLocaleString('ja-JP')}`;
        this.renderList();
    }

    deleteActive() {
        const note = this.store.get(this.activeId);
        if (!note) return;
        if ((note.title || note.body) && !confirm(`「${note.title || '無題のメモ'}」を削除しますか？`)) return;
        this.store.remove(note.id);
        const next = this.sortedNotes()[0];
        this.activeId = null;
        if (next) this.select(next.id);
        else this.renderAll();
    }

    addTag() {
        const tag = this.tagInput.value.trim();
        const note = this.store.get(this.activeId);
        if (!tag || !note) return;
        if (!note.tags.includes(tag)) {
            note.tags.push(tag);
            note.updatedAt = Date.now();
            this.store.save();
            this.renderAll();
        }
        this.tagInput.value = '';
    }

    renderTags(note) {
        const wrap = this.$('memoTagList');
        wrap.innerHTML = '';
        note.tags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.textContent = tag;
            const x = document.createElement('button');
            x.className = 'tag-chip-remove';
            x.title = '削除';
            x.textContent = '×';
            x.addEventListener('click', () => {
                note.tags = note.tags.filter(t => t !== tag);
                note.updatedAt = Date.now();
                this.store.save();
                this.renderAll();
            });
            chip.appendChild(x);
            wrap.appendChild(chip);
        });
    }

    renderList() {
        const q = this.search.value.trim().toLowerCase();
        const notes = this.sortedNotes().filter(n => !q
            || n.title.toLowerCase().includes(q)
            || n.body.toLowerCase().includes(q)
            || n.tags.some(t => t.toLowerCase().includes(q)));
        this.list.innerHTML = '';
        notes.forEach(note => {
            const li = document.createElement('li');
            li.className = 'memo-item' + (note.id === this.activeId ? ' active' : '');
            const t = document.createElement('div');
            t.className = 'memo-item-title';
            t.textContent = note.title || '無題のメモ';
            const p = document.createElement('div');
            p.className = 'memo-item-preview';
            p.textContent = note.body.slice(0, 40);
            li.append(t, p);
            li.addEventListener('click', () => this.select(note.id));
            this.list.appendChild(li);
        });
        if (notes.length === 0 && this.store.notes.length > 0) {
            this.list.innerHTML = '<li class="memo-list-empty">見つかりません</li>';
        }
    }

    // ---------- CSV ----------

    csvEscape(v) {
        return '"' + String(v ?? '').replace(/"/g, '""') + '"';
    }

    exportCsv() {
        const header = ['id', 'title', 'body', 'tags', 'updatedAt'];
        const rows = this.sortedNotes().map(n => [
            n.id, n.title, n.body, n.tags.join(' '), new Date(n.updatedAt).toISOString(),
        ].map(v => this.csvEscape(v)).join(','));
        const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memos_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // 本アプリのCSVと Kakumee のCSV（id,title,body,format,updatedAt）の両方を読み込める
    importCsv(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const rows = parseCsv(String(reader.result).replace(/^﻿/, ''));
                if (rows.length < 2) throw new Error('empty');
                const header = rows[0];
                const col = name => header.indexOf(name);
                const existing = new Set(this.store.notes.map(n => n.id));
                let added = 0;
                rows.slice(1).forEach((cols, i) => {
                    if (cols.length === 1 && cols[0] === '') return;
                    const id = cols[col('id')] || `${Date.now()}-${i}`;
                    if (existing.has(id)) return;
                    const updated = cols[col('updatedAt')] ? new Date(cols[col('updatedAt')]).getTime() : Date.now();
                    this.store.notes.push({
                        id,
                        title: cols[col('title')] || '',
                        body: cols[col('body')] || '',
                        tags: col('tags') !== -1 && cols[col('tags')] ? cols[col('tags')].split(/\s+/).filter(Boolean) : [],
                        updatedAt: Number.isNaN(updated) ? Date.now() : updated,
                    });
                    existing.add(id);
                    added++;
                });
                this.store.save();
                const first = this.sortedNotes()[0];
                if (first && !this.activeId) this.select(first.id);
                else this.renderAll();
                alert(added ? `${added}件のメモを取り込みました。` : '新しいメモはありませんでした（重複はスキップしました）。');
            } catch (_) {
                alert('CSVの読み込みに失敗しました。');
            }
            e.target.value = '';
        };
        reader.readAsText(file, 'UTF-8');
    }
}

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuote) {
            if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
            else if (ch === '"') inQuote = false;
            else field += ch;
        } else if (ch === '"') {
            inQuote = true;
        } else if (ch === ',') {
            row.push(field); field = '';
        } else if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            rows.push(row); row = [];
        } else {
            field += ch;
        }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

// =====================================================================
// 起動
// =====================================================================

const store = new MemoStore();
new MemoEditor(store);
const generator = new SiteGenerator(store);

document.querySelectorAll('.app-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        document.querySelectorAll('.app-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.getElementById('memoPage').hidden = page !== 'memo';
        document.getElementById('buildPage').hidden = page !== 'build';
        if (page === 'build') generator.refreshNotes();
    });
});
