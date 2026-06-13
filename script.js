class OpenRouter {
    constructor({ apiKey, baseURL }) {
        this.apiKey = apiKey;
        this.baseURL = String(baseURL || '').replace(/\/$/, '');
        this.chat = {
            send: (payload) => this.sendChat(payload),
        };
    }

    async listModels() {
        const res = await fetch(`${this.baseURL}/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Accept': 'application/json',
            },
        });

        if (!res.ok) {
            let errMsg = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                errMsg = errData.error?.message || errData.message || errMsg;
            } catch { }
            throw new Error(errMsg);
        }

        return res.json();
    }

    async sendChat(payload) {
        const { signal, ...body } = payload || {};
        const res = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal,
        });

        if (!res.ok) {
            let errMsg = `HTTP ${res.status}`;
            try {
                const errData = await res.json();
                errMsg = errData.error?.message || errData.message || errMsg;
            } catch { }
            throw new Error(errMsg);
        }

        return res.json();
    }
}

(() => {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 1: CONSTANTS & STATE
    // ─────────────────────────────────────────────────────────────────────────────

    const API_BASE_URL_DEFAULT = 'http://localhost:8787/api/v1';
    const LEGACY_API_BASE_URL = 'https://ai.nirvaan.hackclub.app/api/v1';
    const MODELS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

    const LS = {
        API_KEY: 'hcai_api_key',
        API_KEYS: 'hcai_api_keys',
        ACTIVE_API_KEY: 'hcai_active_api_key',
        API_USAGE: 'hcai_api_usage_by_key',
        CONVERSATIONS: 'hcai_conversations',
        ACTIVE_CONV: 'hcai_active_conv',
        MODELS: 'hcai_models',
        MODELS_TS: 'hcai_models_ts',
        SETTINGS: 'hcai_settings',
    };

    const DEFAULT_SETTINGS = {
        chat_model: 'anthropic/claude-sonnet-4-5',
        title_model: 'openai/gpt-4o-mini',
        max_tokens: 4096,
        temperature: 0.7,
        thinking_mode: false,
        thinking_budget: 8000,
        system_prompt: '',
        // Prompt engineering defaults
        persona: '',
        instruction_template: '',
        enable_few_shot: false,
        few_shot_examples: '',
        instruction_tone: 'neutral',
        max_system_prompt_tokens: 1024,
        stream: true,
        show_token_count: true,
        enter_to_send: true,
        auto_title: true,
        compact_mode: false,
        font_size: 14,
        code_theme: 'dark',
        base_url: API_BASE_URL_DEFAULT,
    };

    const FALLBACK_MODELS = [
        {
            id: 'anthropic/claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['reasoning', 'include_reasoning', 'thinking'],
            context_length: 200000,
        },
        {
            id: 'anthropic/claude-opus-4.5',
            name: 'Claude Opus 4.5',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['reasoning', 'include_reasoning', 'thinking'],
            context_length: 200000,
        },
        {
            id: 'openai/gpt-4o-mini',
            name: 'GPT-4o Mini',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['reasoning'],
            context_length: 128000,
        },
        {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            supported_parameters: ['reasoning'],
            context_length: 128000,
        },
        {
            id: 'google/gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] },
            supported_parameters: ['reasoning'],
            context_length: 1000000,
        },
        {
            id: 'google/gemini-2.5-flash',
            name: 'Gemini 2.5 Flash',
            architecture: { input_modalities: ['text', 'image', 'audio'], output_modalities: ['text'] },
            supported_parameters: ['reasoning'],
            context_length: 1000000,
        },
        {
            id: 'mistralai/mistral-large',
            name: 'Mistral Large',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            supported_parameters: ['reasoning'],
            context_length: 128000,
        },
        {
            id: 'deepseek/deepseek-chat',
            name: 'DeepSeek Chat',
            architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            supported_parameters: ['reasoning'],
            context_length: 64000,
        },
    ];

    const state = {
        conversations: [],
        activeConvId: null,
        models: [],
        settings: { ...DEFAULT_SETTINGS },
        isStreaming: false,
        abortController: null,
        thinkingActive: false,
        webSearchActive: false,
        attachedFiles: [],
        apiKeys: [],
        activeApiKeyId: null,
        apiUsageByKey: {},
        commandPaletteOpen: false,
        currentDropdown: null,
        commandSelectedIndex: -1,
        commandItems: [],
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 2: STORAGE HELPERS
    // ─────────────────────────────────────────────────────────────────────────────

    function lsGet(key) {
        try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    }

    function lsSet(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); return true; }
        catch (e) { console.warn('localStorage write failed:', e); return false; }
    }

    function lsDel(key) { localStorage.removeItem(key); }

    function uuid() {
        if (crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function normalizeApiKeyRecord(record) {
        if (!record || typeof record !== 'object') return null;
        const id = String(record.id || '').trim() || uuid();
        const name = String(record.name || '').trim() || 'API Key';
        const key = String(record.key || '').trim();
        if (!key) return null;
        return { id, name, key };
    }

    function loadApiKeys() {
        const saved = lsGet(LS.API_KEYS);
        const legacyKey = localStorage.getItem(LS.API_KEY);

        state.apiKeys = Array.isArray(saved)
            ? saved.map(normalizeApiKeyRecord).filter(Boolean)
            : [];

        if (!state.apiKeys.length && legacyKey) {
            state.apiKeys = [{ id: uuid(), name: 'Primary API Key', key: legacyKey.trim() }];
        }

        const storedActiveId = localStorage.getItem(LS.ACTIVE_API_KEY);
        state.activeApiKeyId = state.apiKeys.find(key => key.id === storedActiveId)?.id || state.apiKeys[0]?.id || null;

        if (state.apiKeys.length) {
            saveApiKeys();
            lsDel(LS.API_KEY);
        }
    }

    function saveApiKeys() {
        state.apiKeys = state.apiKeys.map(normalizeApiKeyRecord).filter(Boolean);
        lsSet(LS.API_KEYS, state.apiKeys);
        if (!state.apiKeys.some(key => key.id === state.activeApiKeyId)) {
            state.activeApiKeyId = state.apiKeys[0]?.id || null;
        }
        if (state.activeApiKeyId) {
            localStorage.setItem(LS.ACTIVE_API_KEY, state.activeApiKeyId);
        } else {
            lsDel(LS.ACTIVE_API_KEY);
        }
    }

    function getActiveApiKeyRecord() {
        return state.apiKeys.find(key => key.id === state.activeApiKeyId) || state.apiKeys[0] || null;
    }

    function getApiKey() {
        return getActiveApiKeyRecord()?.key || '';
    }

    function setApiKey(key, name = 'API Key') {
        const cleanKey = String(key || '').trim();
        if (!cleanKey) return null;

        const existing = state.apiKeys.find(record => record.key === cleanKey);
        if (existing) {
            if (name) existing.name = String(name).trim() || existing.name;
            state.activeApiKeyId = existing.id;
            saveApiKeys();
            return getActiveApiKeyRecord();
        }

        const current = getActiveApiKeyRecord();
        if (current) {
            current.key = cleanKey;
            if (name) current.name = String(name).trim() || current.name;
            state.activeApiKeyId = current.id;
        } else {
            const record = { id: uuid(), name: String(name || '').trim() || 'API Key', key: cleanKey };
            state.apiKeys.push(record);
            state.activeApiKeyId = record.id;
        }

        saveApiKeys();
        return getActiveApiKeyRecord();
    }

    function upsertApiKeyFromUI() {
        const nameInput = document.getElementById('api-key-name-input');
        const keyInput = document.getElementById('api-key-input');
        const name = nameInput?.value.trim() || 'API Key';
        const key = keyInput?.value.trim() || '';
        if (!key) return false;

        const current = getActiveApiKeyRecord();
        if (current) {
            current.name = name;
            current.key = key;
            state.activeApiKeyId = current.id;
        } else {
            state.apiKeys.push({ id: uuid(), name, key });
            state.activeApiKeyId = state.apiKeys[state.apiKeys.length - 1].id;
        }

        saveApiKeys();
        renderApiKeysList();
        updateApiKeyFields();
        updateApiStatus();
        updateConnStatusDisplay();
        return true;
    }

    function addApiKeyFromUI() {
        const nameInput = document.getElementById('api-key-name-input');
        const keyInput = document.getElementById('api-key-input');
        const name = nameInput?.value.trim() || `API Key ${state.apiKeys.length + 1}`;
        const key = keyInput?.value.trim() || '';
        if (!key) return false;

        const record = { id: uuid(), name, key };
        state.apiKeys.push(record);
        state.activeApiKeyId = record.id;
        saveApiKeys();
        renderApiKeysList();
        updateApiKeyFields();
        updateApiStatus();
        updateConnStatusDisplay();
        return true;
    }

    function selectApiKey(id) {
        if (!id) return;
        state.activeApiKeyId = id;
        saveApiKeys();
        updateApiKeyFields();
        renderApiKeysList();
        updateApiStatus();
        updateConnStatusDisplay();
    }

    function removeActiveApiKey() {
        const active = getActiveApiKeyRecord();
        if (!active) return;
        state.apiKeys = state.apiKeys.filter(key => key.id !== active.id);
        state.activeApiKeyId = state.apiKeys[0]?.id || null;
        saveApiKeys();
        renderApiKeysList();
        updateApiKeyFields();
        updateApiStatus();
        updateConnStatusDisplay();
    }

    function updateApiKeyFields() {
        const nameInput = document.getElementById('api-key-name-input');
        const keyInput = document.getElementById('api-key-input');
        const active = getActiveApiKeyRecord();
        if (nameInput) nameInput.value = active?.name || '';
        if (keyInput) keyInput.value = active?.key || '';
    }

    function renderApiKeysList() {
        const list = document.getElementById('api-keys-list');
        const empty = document.getElementById('api-keys-empty');
        if (!list) return;

        if (!state.apiKeys.length) {
            list.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }

        if (empty) empty.classList.add('hidden');
        list.innerHTML = state.apiKeys.map((record, index) => {
            const checked = record.id === state.activeApiKeyId ? 'checked' : '';
            const spend = formatMoney(getDailySpendForKey(record.id));
            return `
        <label class="api-key-item">
          <input type="radio" name="active-api-key" value="${escapeHtml(record.id)}" ${checked} />
          <div class="api-key-item-body">
            <div class="api-key-item-name">${escapeHtml(record.name || `API Key ${index + 1}`)}</div>
            <div class="api-key-item-key">${escapeHtml(record.key.slice(0, 8))}${record.key.length > 8 ? '…' : ''}</div>
            <div class="api-key-item-spend">Today: ${escapeHtml(spend)}</div>
          </div>
        </label>
      `;
        }).join('');
    }

    function updateSpendDisplays() {
        const active = getActiveApiKeyRecord();
        const spend = active ? formatMoney(getDailySpendForKey(active.id)) : '$0.0000';
        const apiSpend = document.getElementById('api-spend-today');
        const detailsSpend = document.getElementById('details-spend-today');
        const usageInput = document.getElementById('api-usage-input');
        if (apiSpend) apiSpend.textContent = active ? `${active.name}: ${spend}` : 'No API key selected';
        if (detailsSpend) detailsSpend.textContent = active ? `Today: ${spend}` : 'Today: —';
        if (usageInput) usageInput.value = active ? getDailySpendForKey(active.id).toFixed(2) : '';
    }

    function getStorageUsedKB() {
        let total = 0;
        try {
            for (const key in localStorage) {
                if (!Object.prototype.hasOwnProperty.call(localStorage, key)) continue;
                total += (localStorage[key].length + key.length) * 2;
            }
        } catch { }
        return (total / 1024).toFixed(1);
    }

    function getBaseUrl() {
        return (state.settings.base_url || API_BASE_URL_DEFAULT).replace(/\/$/, '');
    }

    function getTodayDateKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function loadApiUsage() {
        const saved = lsGet(LS.API_USAGE);
        state.apiUsageByKey = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    }

    function saveApiUsage() {
        lsSet(LS.API_USAGE, state.apiUsageByKey);
    }

    function getUsageRecordForKey(keyId) {
        if (!keyId) return null;
        const today = getTodayDateKey();
        const current = state.apiUsageByKey[keyId];
        if (!current || current.date !== today) {
            state.apiUsageByKey[keyId] = {
                date: today,
                prompt_tokens: 0,
                completion_tokens: 0,
                prompt_cost: 0,
                completion_cost: 0,
                total_cost: 0,
            };
            saveApiUsage();
        }
        return state.apiUsageByKey[keyId];
    }

    function getDailySpendForKey(keyId) {
        const record = getUsageRecordForKey(keyId);
        return record ? Number(record.total_cost || 0) : 0;
    }

    function getActiveDailySpend() {
        const active = getActiveApiKeyRecord();
        return active ? getDailySpendForKey(active.id) : 0;
    }

    function formatMoney(amount) {
        const value = Number(amount || 0);
        return `$${value.toFixed(2)}`;
    }

    function calculateUsageCost(model, usage) {
        const promptRate = parseFloat(model?.pricing?.prompt || 0);
        const completionRate = parseFloat(model?.pricing?.completion || 0);
        const promptTokens = Number(usage?.prompt_tokens || 0);
        const completionTokens = Number(usage?.completion_tokens || 0);

        return {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            prompt_cost: promptRate ? (promptTokens / 1_000_000) * promptRate : 0,
            completion_cost: completionRate ? (completionTokens / 1_000_000) * completionRate : 0,
        };
    }

    function addUsageForActiveKey(model, usage) {
        const active = getActiveApiKeyRecord();
        if (!active || !usage) return null;

        const record = getUsageRecordForKey(active.id);
        if (!record) return null;

        const delta = calculateUsageCost(model, usage);
        record.prompt_tokens += delta.prompt_tokens;
        record.completion_tokens += delta.completion_tokens;
        record.prompt_cost += delta.prompt_cost;
        record.completion_cost += delta.completion_cost;
        record.total_cost = record.prompt_cost + record.completion_cost;
        record.date = getTodayDateKey();
        saveApiUsage();
        return record;
    }

    function syncApiUsageState() {
        const today = getTodayDateKey();
        let changed = false;
        for (const keyId of Object.keys(state.apiUsageByKey)) {
            const record = state.apiUsageByKey[keyId];
            if (!record || record.date !== today) {
                state.apiUsageByKey[keyId] = {
                    date: today,
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    prompt_cost: 0,
                    completion_cost: 0,
                    total_cost: 0,
                };
                changed = true;
            }
        }
        if (changed) saveApiUsage();
    }

    function resetActiveKeyUsage() {
        const active = getActiveApiKeyRecord();
        if (!active) return false;

        state.apiUsageByKey[active.id] = {
            date: getTodayDateKey(),
            prompt_tokens: 0,
            completion_tokens: 0,
            prompt_cost: 0,
            completion_cost: 0,
            total_cost: 0,
        };
        saveApiUsage();
        updateSpendDisplays();
        updateApiStatus();
        updateConnStatusDisplay();
        return true;
    }

    function setActiveKeyUsageTotal(amount) {
        const active = getActiveApiKeyRecord();
        if (!active) return false;

        const numericAmount = Math.max(0, Number(amount));
        if (!Number.isFinite(numericAmount)) return false;

        state.apiUsageByKey[active.id] = {
            date: getTodayDateKey(),
            prompt_tokens: 0,
            completion_tokens: 0,
            prompt_cost: numericAmount,
            completion_cost: 0,
            total_cost: numericAmount,
        };
        saveApiUsage();
        updateSpendDisplays();
        updateApiStatus();
        updateConnStatusDisplay();
        return true;
    }

    function addActiveKeyUsageAmount(amount) {
        const active = getActiveApiKeyRecord();
        if (!active) return false;

        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount < 0) return false;

        const record = getUsageRecordForKey(active.id);
        record.prompt_cost = Number(record.prompt_cost || 0) + numericAmount;
        record.total_cost = Number(record.total_cost || 0) + numericAmount;
        record.date = getTodayDateKey();
        saveApiUsage();
        updateSpendDisplays();
        updateApiStatus();
        updateConnStatusDisplay();
        return true;
    }

    function compactTextForTransport(text, maxChars = 240) {
        const cleaned = String(text || '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleaned) return '';
        return cleaned.length > maxChars ? cleaned.slice(0, maxChars).trim() + '…' : cleaned;
    }

    function compactMessageContentForTransport(content) {
        if (typeof content === 'string') {
            return compactTextForTransport(content, 4000);
        }

        if (!Array.isArray(content)) {
            return content;
        }

        return content.map((part) => {
            if (!part || typeof part !== 'object') return part;
            if (part.type === 'text') {
                return { ...part, text: compactTextForTransport(part.text, 4000) };
            }
            return part;
        });
    }

    function compactMessageForTransport(message) {
        if (!message || typeof message !== 'object') return message;
        return {
            role: message.role,
            content: compactMessageContentForTransport(message.content),
        };
    }

    function createOpenRouterClient() {
        return new OpenRouter({
            apiKey: getApiKey(),
            baseURL: getBaseUrl(),
        });
    }

    function generateLocalTitle(text) {
        const cleaned = String(text || '')
            .replace(/\s+/g, ' ')
            .replace(/["'`*_~]/g, '')
            .trim();
        if (!cleaned) return 'New Conversation';

        const words = cleaned.split(' ')
            .filter(Boolean)
            .slice(0, 6)
            .map(word => word.replace(/^[^\w]+|[^\w]+$/g, ''))
            .filter(Boolean);

        const title = words.join(' ');
        return title ? title.slice(0, 80) : 'New Conversation';
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 3: SETTINGS
    // ─────────────────────────────────────────────────────────────────────────────

    function loadSettings() {
        loadApiKeys();
        loadApiUsage();
        const saved = lsGet(LS.SETTINGS) || {};
        state.settings = { ...DEFAULT_SETTINGS, ...saved };
        if (!saved.base_url || saved.base_url === LEGACY_API_BASE_URL || saved.base_url === 'https://ai.hackclub.com/proxy/v1') {
            state.settings.base_url = API_BASE_URL_DEFAULT;
        }
        applySettings();
    }

    function saveSettings() {
        lsSet(LS.SETTINGS, state.settings);
        applySettings();
    }

    function applySettings() {
        document.documentElement.style.setProperty('--font-size', state.settings.font_size + 'px');
        const mc = document.getElementById('messages-container');
        if (mc) mc.classList.toggle('compact', !!state.settings.compact_mode);

        const codeThemeMap = {
            dark: 'github-dark-dimmed',
            light: 'github',
            'github-dark': 'github-dark',
        };
        const hljsEl = document.getElementById('hljs-theme');
        if (hljsEl) {
            const theme = codeThemeMap[state.settings.code_theme] || 'github-dark-dimmed';
            hljsEl.href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${theme}.min.css`;
        }
    }

    function saveSettingsFromUI() {
        // Commit the API form to the selected key so typed changes are not lost.
        upsertApiKeyFromUI();

        const baseUrlInput = document.getElementById('base-url-input');
        if (baseUrlInput) state.settings.base_url = baseUrlInput.value.trim() || API_BASE_URL_DEFAULT;

        // Generation tab
        const maxTokInput = document.getElementById('max-tokens-input');
        if (maxTokInput) state.settings.max_tokens = parseInt(maxTokInput.value, 10) || 4096;

        const tempSlider = document.getElementById('temperature-slider');
        if (tempSlider) state.settings.temperature = parseFloat(tempSlider.value);

        const thinkDefault = document.getElementById('thinking-default-toggle');
        if (thinkDefault) state.settings.thinking_mode = thinkDefault.checked;

        const thinkBudget = document.getElementById('thinking-budget-slider');
        if (thinkBudget) state.settings.thinking_budget = parseInt(thinkBudget.value, 10);

        const sysPrompt = document.getElementById('system-prompt-input');
        if (sysPrompt) state.settings.system_prompt = sysPrompt.value;

        // Prompting tab fields
        const personaEl = document.getElementById('persona-input');
        if (personaEl) state.settings.persona = personaEl.value;

        const instrTpl = document.getElementById('instruction-template-input');
        if (instrTpl) state.settings.instruction_template = instrTpl.value;

        const fewShotToggle = document.getElementById('enable-few-shot-toggle');
        if (fewShotToggle) state.settings.enable_few_shot = !!fewShotToggle.checked;

        const fewShotExamples = document.getElementById('few-shot-examples-input');
        if (fewShotExamples) state.settings.few_shot_examples = fewShotExamples.value;

        const toneSelect = document.getElementById('instruction-tone-select');
        if (toneSelect) state.settings.instruction_tone = toneSelect.value;

        const maxSysSlider = document.getElementById('max-system-prompt-tokens-input');
        if (maxSysSlider) state.settings.max_system_prompt_tokens = parseInt(maxSysSlider.value, 10) || 1024;

        // Interface tab
        const fontSlider = document.getElementById('font-size-slider');
        if (fontSlider) state.settings.font_size = parseInt(fontSlider.value, 10);

        const compactToggle = document.getElementById('compact-mode-toggle');
        if (compactToggle) state.settings.compact_mode = compactToggle.checked;

        const enterSendToggle = document.getElementById('enter-send-toggle');
        if (enterSendToggle) state.settings.enter_to_send = enterSendToggle.checked;

        const showTokensToggle = document.getElementById('show-tokens-toggle');
        if (showTokensToggle) state.settings.show_token_count = showTokensToggle.checked;

        const autoTitleToggle = document.getElementById('auto-title-toggle');
        if (autoTitleToggle) state.settings.auto_title = autoTitleToggle.checked;

        const codeThemeRadio = document.querySelector('input[name="code-theme"]:checked');
        if (codeThemeRadio) state.settings.code_theme = codeThemeRadio.value;

        syncApiUsageState();
        saveSettings();
        updateApiStatus();
        showToast('Settings saved', 'success');
        closeSettings();
    }

    function loadSettingsIntoUI() {
        updateApiKeyFields();
        renderApiKeysList();

        const baseUrlInput = document.getElementById('base-url-input');
        if (baseUrlInput) baseUrlInput.value = state.settings.base_url;

        // Generation
        syncSlider('max-tokens-slider', 'max-tokens-input', 'max-tokens-display', state.settings.max_tokens);
        syncSlider('temperature-slider', null, 'temperature-display', state.settings.temperature);
        syncSlider('thinking-budget-slider', null, 'thinking-budget-display', state.settings.thinking_budget, v => v.toLocaleString() + ' tokens');

        const thinkDefault = document.getElementById('thinking-default-toggle');
        if (thinkDefault) thinkDefault.checked = !!state.settings.thinking_mode;

        const sysPrompt = document.getElementById('system-prompt-input');
        if (sysPrompt) sysPrompt.value = state.settings.system_prompt || '';

        // Prompting tab
        const personaEl = document.getElementById('persona-input');
        if (personaEl) personaEl.value = state.settings.persona || '';

        const instrTpl = document.getElementById('instruction-template-input');
        if (instrTpl) instrTpl.value = state.settings.instruction_template || '';

        const fewShotToggle = document.getElementById('enable-few-shot-toggle');
        if (fewShotToggle) fewShotToggle.checked = !!state.settings.enable_few_shot;

        const fewShotExamples = document.getElementById('few-shot-examples-input');
        if (fewShotExamples) fewShotExamples.value = state.settings.few_shot_examples || '';

        const toneSelect = document.getElementById('instruction-tone-select');
        if (toneSelect) toneSelect.value = state.settings.instruction_tone || 'neutral';

        syncSlider('max-system-prompt-tokens-slider', 'max-system-prompt-tokens-input', 'max-system-prompt-tokens-display', state.settings.max_system_prompt_tokens || 1024, v => v.toLocaleString() + ' tokens');

        // Interface
        syncSlider('font-size-slider', null, 'font-size-display', state.settings.font_size, v => v + 'px');

        const compactToggle = document.getElementById('compact-mode-toggle');
        if (compactToggle) compactToggle.checked = !!state.settings.compact_mode;

        const enterSendToggle = document.getElementById('enter-send-toggle');
        if (enterSendToggle) enterSendToggle.checked = state.settings.enter_to_send !== false;

        const showTokensToggle = document.getElementById('show-tokens-toggle');
        if (showTokensToggle) showTokensToggle.checked = state.settings.show_token_count !== false;

        const autoTitleToggle = document.getElementById('auto-title-toggle');
        if (autoTitleToggle) autoTitleToggle.checked = state.settings.auto_title !== false;

        const codeThemeRadio = document.querySelector(`input[name="code-theme"][value="${state.settings.code_theme}"]`);
        if (codeThemeRadio) codeThemeRadio.checked = true;

        // Storage usage
        const usedKB = parseFloat(getStorageUsedKB());
        const maxKB = 5120; // 5MB typical localStorage limit
        const pct = Math.min(100, (usedKB / maxKB) * 100);
        const bar = document.getElementById('storage-usage-bar');
        const label = document.getElementById('storage-usage-label');
        if (bar) bar.style.width = pct + '%';
        if (label) label.textContent = `${usedKB} KB used of ~5 MB`;

        // Models updated time
        const ts = lsGet(LS.MODELS_TS);
        const mu = document.getElementById('models-last-updated');
        if (mu) mu.textContent = ts ? `Updated ${relativeTime(ts)}` : 'Not yet loaded';

        // Model pickers
        updateSettingsModelPicker('settings-chat-model-btn', 'settings-chat-model-label', 'settings-chat-model-dropdown', 'chat');
        updateSettingsModelPicker('settings-title-model-btn', 'settings-title-model-label', 'settings-title-model-dropdown', 'title');

        // Connection status
        updateConnStatusDisplay();
    }

    function syncSlider(sliderId, inputId, displayId, value, fmt) {
        const slider = document.getElementById(sliderId);
        const input = inputId ? document.getElementById(inputId) : null;
        const display = document.getElementById(displayId);
        if (slider) slider.value = value;
        if (input) input.value = value;
        if (display) display.textContent = fmt ? fmt(value) : value;
    }

    function setupSettingsSliders() {
        // Max tokens
        const maxSlider = document.getElementById('max-tokens-slider');
        const maxInput = document.getElementById('max-tokens-input');
        const maxDisplay = document.getElementById('max-tokens-display');
        if (maxSlider && maxInput && maxDisplay) {
            maxSlider.addEventListener('input', () => {
                maxInput.value = maxSlider.value;
                maxDisplay.textContent = Number(maxSlider.value).toLocaleString();
            });
            maxInput.addEventListener('input', () => {
                maxSlider.value = maxInput.value;
                maxDisplay.textContent = Number(maxInput.value).toLocaleString();
            });
        }

        // Temperature
        const tempSlider = document.getElementById('temperature-slider');
        const tempDisplay = document.getElementById('temperature-display');
        if (tempSlider && tempDisplay) {
            tempSlider.addEventListener('input', () => {
                tempDisplay.textContent = parseFloat(tempSlider.value).toFixed(2);
            });
        }

        // Thinking budget
        const thinkSlider = document.getElementById('thinking-budget-slider');
        const thinkDisplay = document.getElementById('thinking-budget-display');
        if (thinkSlider && thinkDisplay) {
            thinkSlider.addEventListener('input', () => {
                thinkDisplay.textContent = Number(thinkSlider.value).toLocaleString() + ' tokens';
            });
        }

        // Max system prompt tokens
        const maxSysSlider = document.getElementById('max-system-prompt-tokens-slider');
        const maxSysInput = document.getElementById('max-system-prompt-tokens-input');
        const maxSysDisplay = document.getElementById('max-system-prompt-tokens-display');
        if (maxSysSlider && maxSysInput && maxSysDisplay) {
            maxSysSlider.addEventListener('input', () => {
                maxSysInput.value = maxSysSlider.value;
                maxSysDisplay.textContent = Number(maxSysSlider.value).toLocaleString() + ' tokens';
            });
            maxSysInput.addEventListener('input', () => {
                maxSysSlider.value = maxSysInput.value;
                maxSysDisplay.textContent = Number(maxSysInput.value).toLocaleString() + ' tokens';
            });
        }

        // Font size
        const fontSlider = document.getElementById('font-size-slider');
        const fontDisplay = document.getElementById('font-size-display');
        if (fontSlider && fontDisplay) {
            fontSlider.addEventListener('input', () => {
                fontDisplay.textContent = fontSlider.value + 'px';
                document.documentElement.style.setProperty('--font-size', fontSlider.value + 'px');
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 4: MODEL FETCHING & MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────────

    async function fetchModels(forceRefresh = false) {
        const cached = lsGet(LS.MODELS);
        const ts = lsGet(LS.MODELS_TS);
        const cachedLooksLikeFallback = Array.isArray(cached)
            && cached.length === FALLBACK_MODELS.length
            && cached.every(model => FALLBACK_MODELS.some(fallback => fallback.id === model.id));

        if (!forceRefresh && cached && ts && (Date.now() - ts) < MODELS_CACHE_TTL && !cachedLooksLikeFallback) {
            state.models = cached;
            return cached;
        }

        try {
            const client = createOpenRouterClient();
            const response = await client.listModels();
            const liveModels = Array.isArray(response?.data)
                ? response.data
                : Array.isArray(response?.models)
                    ? response.models
                    : Array.isArray(response)
                        ? response
                        : [];

            const normalizedLiveModels = liveModels
                .map((model) => {
                    const id = model?.id || model?.name;
                    if (!id) return null;

                    const architecture = model.architecture || ((model.input_modalities || model.output_modalities) ? {
                        input_modalities: model.input_modalities || [],
                        output_modalities: model.output_modalities || [],
                    } : undefined);

                    return {
                        ...model,
                        id,
                        name: model.name || id.split('/').pop(),
                        architecture,
                        context_length: model.context_length || model.contextLength || null,
                    };
                })
                .filter(Boolean);

            const mergedById = new Map(FALLBACK_MODELS.map(model => [model.id, model]));
            for (const model of normalizedLiveModels) {
                mergedById.set(model.id, { ...mergedById.get(model.id), ...model });
            }

            state.models = Array.from(mergedById.values());
            lsSet(LS.MODELS, state.models);
            lsSet(LS.MODELS_TS, Date.now());
            return state.models;
        } catch (err) {
            state.models = FALLBACK_MODELS;
            lsSet(LS.MODELS, state.models);
            lsSet(LS.MODELS_TS, Date.now());
            console.warn('Model fetch failed, using fallback models:', err);
            return state.models;
        }
    }

    function getModelById(id) {
        return state.models.find(m => m.id === id) || null;
    }

    function modelCan(model, feature) {
        if (!model) return false;
        const params = model.supported_parameters || [];
        const arch = model.architecture || {};
        const inMods = arch.input_modalities || arch.modality?.split(',').map(s => s.trim()) || [];
        const outMods = arch.output_modalities || [];
        switch (feature) {
            case 'thinking': return params.includes('reasoning') || params.includes('include_reasoning') || params.includes('thinking');
            case 'vision': return inMods.includes('image') || inMods.includes('image+text');
            case 'imageGen': return outMods.includes('image');
            case 'webSearch': return !!(model.pricing && model.pricing.web_search);
            case 'free': return model.pricing && model.pricing.prompt === '0' && model.pricing.completion === '0';
            case 'audio': return inMods.includes('audio');
            case 'video': return inMods.includes('video');
            default: return false;
        }
    }

    function modelCapBadges(model) {
        const caps = [];
        if (modelCan(model, 'thinking')) caps.push('<span class="cap-badge thinking" title="Thinking/Reasoning">🧠</span>');
        if (modelCan(model, 'imageGen')) caps.push('<span class="cap-badge imagegen" title="Image Generation">🖼</span>');
        if (modelCan(model, 'webSearch')) caps.push('<span class="cap-badge search" title="Web Search">🔍</span>');
        if (modelCan(model, 'vision')) caps.push('<span class="cap-badge vision" title="Vision">👁</span>');
        if (modelCan(model, 'free')) caps.push('<span class="cap-badge free" title="Free">FREE</span>');
        return caps.join('');
    }

    function getProviderFromId(modelId) {
        return (modelId || '').split('/')[0] || 'unknown';
    }

    function formatContextLength(n) {
        if (!n) return '';
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
        if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
        return String(n);
    }

    function getProviderColorClass(provider) {
        const known = ['anthropic', 'openai', 'google', 'mistral', 'deepseek', 'xai', 'qwen'];
        return known.includes(provider.toLowerCase()) ? `provider-${provider.toLowerCase()}` : 'provider-default';
    }

    function groupModelsByProvider(models) {
        const groups = {};
        for (const m of models) {
            const provider = getProviderFromId(m.id);
            if (!groups[provider]) groups[provider] = [];
            groups[provider].push(m);
        }
        return groups;
    }

    function renderModelDropdown(containerEl, searchInputEl, onSelect, currentModelId) {
        let filteredModels = [...state.models];

        function buildList(query = '') {
            containerEl.innerHTML = '';
            const q = query.toLowerCase();
            const filtered = filteredModels.filter(m =>
                !q || (m.name || m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
            );

            if (!filtered.length) {
                const empty = document.createElement('div');
                empty.style.cssText = 'padding:16px;text-align:center;color:var(--text-tertiary);font-size:12px';
                empty.textContent = 'No models found';
                containerEl.appendChild(empty);
                return;
            }

            const groups = groupModelsByProvider(filtered);
            const frag = document.createDocumentFragment();
            let focusableItems = [];

            for (const [provider, models] of Object.entries(groups)) {
                const labelEl = document.createElement('div');
                labelEl.className = 'model-group-label';
                labelEl.innerHTML = `<span class="provider-dot ${getProviderColorClass(provider)}"></span>${provider}`;
                frag.appendChild(labelEl);

                for (const model of models) {
                    const item = document.createElement('div');
                    item.className = 'model-item' + (model.id === currentModelId ? ' selected' : '');
                    item.dataset.modelId = model.id;
                    item.setAttribute('role', 'option');
                    item.setAttribute('aria-selected', model.id === currentModelId ? 'true' : 'false');
                    item.setAttribute('tabindex', '0');

                    const ctx = model.context_length ? formatContextLength(model.context_length) : '';
                    item.innerHTML = `
            <span class="provider-dot ${getProviderColorClass(provider)}"></span>
            <span class="model-item-name">${escapeHtml(model.name || model.id)}</span>
            ${ctx ? `<span class="model-item-ctx">${ctx}</span>` : ''}
            <span class="model-item-caps">${modelCapBadges(model)}</span>
          `;
                    item.addEventListener('click', () => onSelect(model.id));
                    item.addEventListener('keydown', e => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(model.id); }
                    });
                    frag.appendChild(item);
                    focusableItems.push(item);
                }
            }
            containerEl.appendChild(frag);

            // Keyboard navigation within the list
            containerEl._focusableItems = focusableItems;
        }

        buildList();

        if (searchInputEl) {
            searchInputEl.addEventListener('input', debounce(() => buildList(searchInputEl.value), 150));
            searchInputEl.addEventListener('keydown', e => {
                if (!containerEl._focusableItems) return;
                const items = containerEl._focusableItems;
                const focused = containerEl.querySelector('.model-item.focused');
                let idx = focused ? items.indexOf(focused) : -1;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (focused) focused.classList.remove('focused');
                    idx = Math.min(idx + 1, items.length - 1);
                    items[idx]?.classList.add('focused');
                    items[idx]?.scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (focused) focused.classList.remove('focused');
                    idx = Math.max(idx - 1, 0);
                    items[idx]?.classList.add('focused');
                    items[idx]?.scrollIntoView({ block: 'nearest' });
                } else if (e.key === 'Enter') {
                    if (focused) { e.preventDefault(); focused.click(); }
                }
            });
        }
    }

    function updateSettingsModelPicker(btnId, labelId, dropdownId, type) {
        const btn = document.getElementById(btnId);
        const label = document.getElementById(labelId);
        const ddEl = document.getElementById(dropdownId);
        if (!btn || !label || !ddEl) return;

        const current = type === 'chat' ? state.settings.chat_model : state.settings.title_model;
        const model = getModelById(current);
        label.textContent = model ? (model.name || model.id) : (current || 'Select model');

        const listEl = ddEl.querySelector('.dropdown-list');
        const searchEl = ddEl.querySelector('.dropdown-search');
        if (!listEl) return;

        renderModelDropdown(listEl, searchEl, (modelId) => {
            if (type === 'chat') {
                state.settings.chat_model = modelId;
                const m = getModelById(modelId);
                label.textContent = m ? (m.name || m.id) : modelId;
            } else {
                state.settings.title_model = modelId;
                const m = getModelById(modelId);
                label.textContent = m ? (m.name || m.id) : modelId;
            }
            ddEl.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        }, current);

        btn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = !ddEl.classList.contains('hidden');
            closeDropdowns();
            if (!isOpen) {
                ddEl.classList.remove('hidden');
                btn.setAttribute('aria-expanded', 'true');
                searchEl?.focus();
                state.currentDropdown = ddEl;
            }
        };
    }

    function renderAllModelDropdowns() {
        // Main header dropdown
        const headerList = document.getElementById('model-list');
        const headerSearch = document.getElementById('model-search');
        if (headerList) {
            renderModelDropdown(headerList, headerSearch, (modelId) => {
                state.settings.chat_model = modelId;
                const model = getModelById(modelId);
                const label = document.getElementById('model-selector-label');
                if (label) label.textContent = model ? (model.name || model.id) : modelId;
                document.getElementById('model-dropdown')?.classList.add('hidden');
                document.getElementById('model-selector-btn')?.setAttribute('aria-expanded', 'false');
                updateCapabilityButtons();
                updateDetailsPanel();
            }, state.settings.chat_model);
        }
        // Settings pickers
        updateSettingsModelPicker('settings-chat-model-btn', 'settings-chat-model-label', 'settings-chat-model-dropdown', 'chat');
        updateSettingsModelPicker('settings-title-model-btn', 'settings-title-model-label', 'settings-title-model-dropdown', 'title');

        // Update header label
        const model = getModelById(state.settings.chat_model);
        const label = document.getElementById('model-selector-label');
        if (label) label.textContent = model ? (model.name || model.id) : (state.settings.chat_model || 'Select Model');
    }

    function updateCapabilityButtons() {
        const model = getModelById(state.settings.chat_model);
        const thinkingBtn = document.getElementById('thinking-btn');
        const websearchBtn = document.getElementById('websearch-btn');

        if (thinkingBtn) {
            const canThink = modelCan(model, 'thinking');
            thinkingBtn.style.opacity = canThink ? '1' : '0.4';
            thinkingBtn.title = canThink ? 'Thinking Mode (Ctrl+Shift+T)' : 'Thinking not supported by this model';
        }
        if (websearchBtn) {
            const canSearch = modelCan(model, 'webSearch');
            websearchBtn.style.opacity = canSearch ? '1' : '0.4';
            websearchBtn.title = canSearch ? 'Web Search' : 'Web search not supported by this model';
        }
    }

    function switchModel(modelId) {
        state.settings.chat_model = modelId;
        const model = getModelById(modelId);
        const label = document.getElementById('model-selector-label');
        if (label) label.textContent = model ? (model.name || model.id) : modelId;
        updateCapabilityButtons();
        updateDetailsPanel();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 5: CONVERSATION MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────────

    function loadConversations() {
        state.conversations = lsGet(LS.CONVERSATIONS) || [];
    }

    function saveConversations() {
        lsSet(LS.CONVERSATIONS, state.conversations);
    }

    function createConversation() {
        const conv = {
            id: uuid(),
            title: 'New Conversation',
            created_at: Date.now(),
            updated_at: Date.now(),
            model: state.settings.chat_model,
            system_prompt: state.settings.system_prompt,
            messages: [],
            pinned: false,
            tags: [],
        };
        state.conversations.unshift(conv);
        saveConversations();
        return conv;
    }

    function getActiveConversation() {
        return state.conversations.find(c => c.id === state.activeConvId) || null;
    }

    function setActiveConversation(id) {
        state.activeConvId = id;
        lsSet(LS.ACTIVE_CONV, id);
        renderMessages();
        renderSidebar();
        updateHeaderForConversation();
        updateDetailsPanel();
    }

    function addMessageToConversation(convId, message) {
        const conv = state.conversations.find(c => c.id === convId);
        if (!conv) return;
        conv.messages.push(message);
        conv.updated_at = Date.now();
        saveConversations();
    }

    function deleteConversation(id) {
        state.conversations = state.conversations.filter(c => c.id !== id);
        if (state.activeConvId === id) {
            const next = state.conversations[0];
            state.activeConvId = next ? next.id : null;
        }
        saveConversations();
        renderSidebar();
        if (state.activeConvId) {
            setActiveConversation(state.activeConvId);
        } else {
            renderMessages();
            updateHeaderForConversation();
        }
    }

    function duplicateConversation(id) {
        const orig = state.conversations.find(c => c.id === id);
        if (!orig) return;
        const copy = JSON.parse(JSON.stringify(orig));
        copy.id = uuid();
        copy.title = orig.title + ' (copy)';
        copy.created_at = Date.now();
        copy.updated_at = Date.now();
        const idx = state.conversations.findIndex(c => c.id === id);
        state.conversations.splice(idx + 1, 0, copy);
        saveConversations();
        renderSidebar();
    }

    function pinConversation(id) {
        const conv = state.conversations.find(c => c.id === id);
        if (!conv) return;
        conv.pinned = !conv.pinned;
        saveConversations();
        renderSidebar();
    }

    function renameConversation(id, newTitle) {
        const conv = state.conversations.find(c => c.id === id);
        if (!conv) return;
        conv.title = newTitle.trim() || 'Untitled';
        saveConversations();
    }

    function newConversation() {
        const conv = createConversation();
        state.activeConvId = conv.id;
        lsSet(LS.ACTIVE_CONV, conv.id);
        renderSidebar();
        renderMessages();
        updateHeaderForConversation();
        document.getElementById('message-input')?.focus();
    }

    function clearChat() {
        const conv = getActiveConversation();
        if (!conv || !conv.messages.length) return;
        showConfirm('Clear all messages in this conversation?', () => {
            conv.messages = [];
            conv.updated_at = Date.now();
            saveConversations();
            renderMessages();
        });
    }

    function clearAllConversations() {
        state.conversations = [];
        state.activeConvId = null;
        lsDel(LS.ACTIVE_CONV);
        saveConversations();
        renderSidebar();
        renderMessages();
        updateHeaderForConversation();
    }

    function updateHeaderForConversation() {
        const conv = getActiveConversation();
        const titleDisplay = document.getElementById('chat-title-display');
        const titleInput = document.getElementById('chat-title-input');
        if (titleDisplay) {
            titleDisplay.textContent = conv ? conv.title : 'New Conversation';
            titleDisplay.classList.remove('hidden');
        }
        if (titleInput) {
            titleInput.classList.add('hidden');
        }
        // Update model selector
        const label = document.getElementById('model-selector-label');
        if (label) {
            const model = getModelById(state.settings.chat_model);
            label.textContent = model ? (model.name || model.id) : (state.settings.chat_model || 'Select Model');
        }
    }

    function startTitleEdit() {
        const conv = getActiveConversation();
        if (!conv) return;
        const titleDisplay = document.getElementById('chat-title-display');
        const titleInput = document.getElementById('chat-title-input');
        if (!titleDisplay || !titleInput) return;
        titleInput.value = conv.title;
        titleDisplay.classList.add('hidden');
        titleInput.classList.remove('hidden');
        titleInput.focus();
        titleInput.select();

        function finishEdit() {
            const newTitle = titleInput.value.trim() || conv.title;
            renameConversation(conv.id, newTitle);
            titleDisplay.textContent = newTitle;
            titleDisplay.classList.remove('hidden');
            titleInput.classList.add('hidden');
            renderSidebar();
        }

        titleInput.onblur = finishEdit;
        titleInput.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finishEdit(); }
            if (e.key === 'Escape') { titleDisplay.classList.remove('hidden'); titleInput.classList.add('hidden'); }
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 6: SIDEBAR RENDERING
    // ─────────────────────────────────────────────────────────────────────────────

    function renderSidebar() {
        const list = document.getElementById('conv-list');
        const empty = document.getElementById('conv-empty');
        if (!list) return;

        const searchEl = document.getElementById('sidebar-search');
        const search = (searchEl ? searchEl.value : '').toLowerCase();

        let convs = state.conversations.filter(c =>
            !search ||
            c.title.toLowerCase().includes(search) ||
            c.messages.some(m => {
                const txt = typeof m.content === 'string' ? m.content :
                    (Array.isArray(m.content) ? (m.content.find(p => p.type === 'text')?.text || '') : '');
                return txt.toLowerCase().includes(search);
            })
        );

        if (!convs.length) {
            list.innerHTML = '';
            if (empty) empty.classList.remove('hidden');
            return;
        }
        if (empty) empty.classList.add('hidden');

        // Sort: pinned first, then by updated_at desc
        convs.sort((a, b) => {
            if (a.pinned !== b.pinned) return b.pinned - a.pinned;
            return b.updated_at - a.updated_at;
        });

        const pinned = convs.filter(c => c.pinned);
        const unpinned = convs.filter(c => !c.pinned);

        function timeGroup(ts) {
            const diff = Date.now() - ts;
            if (diff < 86_400_000) return 'Today';
            if (diff < 172_800_000) return 'Yesterday';
            if (diff < 604_800_000) return 'This Week';
            if (diff < 2_592_000_000) return 'This Month';
            return 'Older';
        }

        const frag = document.createDocumentFragment();

        // Pinned section
        if (pinned.length) {
            const lbl = document.createElement('div');
            lbl.className = 'conv-group-label';
            lbl.textContent = 'Pinned';
            frag.appendChild(lbl);
            for (const c of pinned) frag.appendChild(buildConvItem(c));
        }

        // Grouped unpinned
        let lastGroup = null;
        for (const c of unpinned) {
            const grp = timeGroup(c.updated_at);
            if (grp !== lastGroup) {
                const lbl = document.createElement('div');
                lbl.className = 'conv-group-label';
                lbl.textContent = grp;
                frag.appendChild(lbl);
                lastGroup = grp;
            }
            frag.appendChild(buildConvItem(c));
        }

        list.innerHTML = '';
        list.appendChild(frag);
    }

    function buildConvItem(conv) {
        const item = document.createElement('div');
        item.className = 'conv-item' + (conv.id === state.activeConvId ? ' active' : '');
        item.dataset.convId = conv.id;

        item.innerHTML = `
      ${conv.pinned ? '<span class="conv-item-pin-icon">📌</span>' : ''}
      <span class="conv-item-title">${escapeHtml(conv.title)}</span>
      <span class="conv-item-time">${relativeTime(conv.updated_at)}</span>
      <div class="conv-item-actions">
        <button class="conv-action-btn" data-action="pin" title="${conv.pinned ? 'Unpin' : 'Pin'}">
          ${conv.pinned ? '📌' : '📍'}
        </button>
        <button class="conv-action-btn" data-action="rename" title="Rename">✏️</button>
        <button class="conv-action-btn" data-action="duplicate" title="Duplicate">📋</button>
        <button class="conv-action-btn danger" data-action="delete" title="Delete">🗑️</button>
      </div>
    `;

        item.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action) {
                e.stopPropagation();
                handleConvAction(action, conv.id, { shiftKey: e.shiftKey });
                return;
            }
            setActiveConversation(conv.id);
            // Close sidebar on mobile
            if (window.innerWidth <= 768) closeMobileSidebar();
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showConvContextMenu(e.clientX, e.clientY, conv.id);
        });

        return item;
    }

    function handleConvAction(action, convId, options = {}) {
        switch (action) {
            case 'pin': pinConversation(convId); break;
            case 'rename': startInlineRename(convId); break;
            case 'duplicate': duplicateConversation(convId); showToast('Conversation duplicated', 'success'); break;
            case 'delete':
                if (options.shiftKey) {
                    deleteConversation(convId);
                } else {
                    showConfirm('Delete this conversation?', () => deleteConversation(convId));
                }
                break;
        }
    }

    function startInlineRename(convId) {
        const item = document.querySelector(`.conv-item[data-conv-id="${convId}"]`);
        if (!item) return;
        const titleEl = item.querySelector('.conv-item-title');
        const conv = state.conversations.find(c => c.id === convId);
        if (!titleEl || !conv) return;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = conv.title;
        input.style.cssText = 'width:100%;background:var(--bg-4);border:1px solid var(--border-focus);border-radius:3px;color:var(--text-primary);padding:2px 4px;font-size:13px;font-family:var(--font-body);outline:none';
        titleEl.replaceWith(input);
        input.focus();
        input.select();

        function finish() {
            const val = input.value.trim() || conv.title;
            renameConversation(convId, val);
            if (convId === state.activeConvId) {
                const td = document.getElementById('chat-title-display');
                if (td) td.textContent = val;
            }
            renderSidebar();
        }
        input.onblur = finish;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(); }
            if (e.key === 'Escape') renderSidebar();
        };
    }

    // Context menu for right-click on conversation
    function showConvContextMenu(x, y, convId) {
        removeContextMenu();
        const conv = state.conversations.find(c => c.id === convId);
        if (!conv) return;
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--border-radius);box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:1000;min-width:160px;padding:4px;`;
        const actions = [
            { label: conv.pinned ? '📌 Unpin' : '📍 Pin', action: 'pin' },
            { label: '✏️ Rename', action: 'rename' },
            { label: '📋 Duplicate', action: 'duplicate' },
            { label: '🗑️ Delete', action: 'delete', danger: true },
        ];
        for (const a of actions) {
            const btn = document.createElement('button');
            btn.textContent = a.label;
            btn.style.cssText = `display:block;width:100%;background:transparent;border:none;color:${a.danger ? 'var(--danger)' : 'var(--text-primary)'};font-size:13px;font-family:var(--font-body);padding:6px 10px;text-align:left;cursor:pointer;border-radius:4px;`;
            btn.onmouseenter = () => { btn.style.background = 'var(--bg-3)'; };
            btn.onmouseleave = () => { btn.style.background = 'transparent'; };
            btn.onclick = (e) => { removeContextMenu(); handleConvAction(a.action, convId, { shiftKey: e.shiftKey }); };
            menu.appendChild(btn);
        }
        document.body.appendChild(menu);

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', removeContextMenu, { once: true });
        }, 10);

        // Keep within viewport
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (x - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (y - rect.height) + 'px';
    }

    function removeContextMenu() {
        document.getElementById('context-menu')?.remove();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 7: MESSAGE RENDERING
    // ─────────────────────────────────────────────────────────────────────────────

    function renderMessages() {
        const container = document.getElementById('messages-container');
        const emptyState = document.getElementById('empty-state');
        if (!container) return;

        const conv = getActiveConversation();

        if (!conv || conv.messages.filter(m => m.role !== 'system').length === 0) {
            const existingEmpty = container.querySelector('#empty-state');
            if (!existingEmpty) {
                container.innerHTML = '';
                if (emptyState) container.appendChild(emptyState);
            }
            if (emptyState) emptyState.classList.remove('hidden');
            updateNoKeyBanner();
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');

        // Remove empty state from container but keep it in DOM
        const existingEmpty = container.querySelector('#empty-state');
        if (existingEmpty) existingEmpty.remove();

        container.innerHTML = '';
        const frag = document.createDocumentFragment();

        for (const msg of conv.messages) {
            if (msg.role === 'system') continue;
            frag.appendChild(createMessageEl(msg));
        }
        container.appendChild(frag);
        scrollToBottom(false);
    }

    function createMessageEl(msg) {
        const el = document.createElement('div');
        el.className = `message ${msg.role}`;
        el.dataset.msgId = msg.id;

        // Avatar
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = msg.role === 'user' ? '👤' : '🤖';

        // Content wrapper
        const contentWrap = document.createElement('div');
        contentWrap.className = 'message-content-wrap';

        // Thinking block
        if (msg.thinking && msg.thinking.length > 0) {
            contentWrap.appendChild(createThinkingBlock(msg.thinking, msg.thinkingDuration));
        }

        // Generated image
        if (msg.image_url) {
            contentWrap.appendChild(createImageOutput(msg.image_url));
        }

        // Attached files/images
        if (msg.role === 'user' && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
            contentWrap.appendChild(createAttachmentList(msg.attachments));
        }

        // Text content
        const textEl = document.createElement('div');
        textEl.className = msg.role === 'assistant' ? 'message-content md-content' : 'message-content user-content';

        if (msg.role === 'assistant') {
            textEl.innerHTML = renderMarkdown(typeof msg.content === 'string' ? msg.content : '');
            renderKatex(textEl);
        } else {
            const text = typeof msg.content === 'string' ? msg.content
                : (Array.isArray(msg.content) ? (msg.content.find(p => p.type === 'text')?.text || '') : '');
            textEl.textContent = text;
        }

        contentWrap.appendChild(textEl);

        // Message footer
        const footer = document.createElement('div');
        footer.className = 'message-footer';

        if (msg.timestamp) {
            const ts = document.createElement('span');
            ts.className = 'message-timestamp';
            ts.title = new Date(msg.timestamp).toLocaleString();
            ts.textContent = relativeTime(msg.timestamp);
            footer.appendChild(ts);
        }

        if (msg.role === 'assistant' && msg.tokens && state.settings.show_token_count) {
            const total = (msg.tokens.input || 0) + (msg.tokens.output || 0);
            if (total > 0) {
                const tc = document.createElement('span');
                tc.className = 'token-count';
                tc.textContent = `~${total.toLocaleString()} tokens`;
                footer.appendChild(tc);
            }
        }

        if (msg.role === 'assistant' && msg.model) {
            const mb = document.createElement('span');
            mb.className = 'message-model-badge';
            mb.textContent = msg.model.split('/').pop();
            footer.appendChild(mb);
        }

        contentWrap.appendChild(footer);
        contentWrap.appendChild(createMessageActions(msg));

        el.appendChild(avatar);
        el.appendChild(contentWrap);
        return el;
    }

    function createMessageActions(msg) {
        const wrap = document.createElement('div');
        wrap.className = 'message-actions';

        const actions = [];

        // Copy
        actions.push({
            label: 'Copy', title: 'Copy text', fn: () => {
                const text = typeof msg.content === 'string' ? msg.content
                    : (Array.isArray(msg.content) ? (msg.content.find(p => p.type === 'text')?.text || '') : '');
                navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard', 'success'));
            }
        });

        if (msg.role === 'user') {
            actions.push({ label: 'Edit', title: 'Edit and resend', fn: () => editMessage(msg) });
        }

        if (msg.role === 'assistant') {
            actions.push({ label: 'Retry', title: 'Regenerate response', fn: () => regenerateMessage(msg) });
        }

        actions.push({ label: 'Del', title: 'Delete message', fn: () => deleteMessage(msg.id) });

        for (const a of actions) {
            const btn = document.createElement('button');
            btn.className = 'msg-action-btn';
            btn.textContent = a.label;
            btn.title = a.title;
            btn.addEventListener('click', a.fn);
            wrap.appendChild(btn);
        }
        return wrap;
    }

    function editMessage(msg) {
        const conv = getActiveConversation();
        if (!conv) return;
        const text = typeof msg.content === 'string' ? msg.content
            : (Array.isArray(msg.content) ? (msg.content.find(p => p.type === 'text')?.text || '') : '');
        const input = document.getElementById('message-input');
        if (input) {
            input.value = text;
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 240) + 'px';
            input.focus();
            updateTokenCounter(text);
        }
        // Remove the message and everything after it
        const idx = conv.messages.findIndex(m => m.id === msg.id);
        if (idx !== -1) {
            conv.messages.splice(idx);
            saveConversations();
            renderMessages();
        }
    }

    function deleteMessage(msgId) {
        const conv = getActiveConversation();
        if (!conv) return;
        conv.messages = conv.messages.filter(m => m.id !== msgId);
        saveConversations();
        renderMessages();
    }

    function regenerateMessage(msg) {
        const conv = getActiveConversation();
        if (!conv || state.isStreaming) return;
        // Find the preceding user message
        const idx = conv.messages.findIndex(m => m.id === msg.id);
        const userMsg = idx > 0 ? conv.messages.slice(0, idx).reverse().find(m => m.role === 'user') : null;
        if (!userMsg) return;

        // Remove the assistant message and re-trigger
        conv.messages = conv.messages.filter(m => m.id !== msg.id);
        saveConversations();
        renderMessages();

        // Trigger a new response without re-adding the user message
        sendMessageInternal(conv);
    }

    function createThinkingBlock(thinkingText, duration) {
        const details = document.createElement('details');
        details.className = 'thinking-block';
        const summary = document.createElement('summary');
        const dur = duration ? `Thought for ${(duration / 1000).toFixed(1)}s` : 'Thinking';
        summary.innerHTML = `<span>${dur}</span> <span style="margin-left:auto;font-size:10px;color:var(--text-tertiary)">▶ click to expand</span>`;
        const content = document.createElement('div');
        content.className = 'thinking-content';
        content.textContent = thinkingText;
        details.appendChild(summary);
        details.appendChild(content);
        return details;
    }

    function editLastUserMessage() {
        const conv = getActiveConversation();
        if (!conv) return;
        const userMsgs = conv.messages.filter(m => m.role === 'user');
        if (!userMsgs.length) return;
        const last = userMsgs[userMsgs.length - 1];
        editMessage(last);
    }

    function updateNoKeyBanner() {
        const banner = document.getElementById('no-key-banner');
        if (banner) banner.classList.toggle('hidden', !!getApiKey());
    }

    function renderStreamingPlaceholder(msgId) {
        const container = document.getElementById('messages-container');
        const emptyState = container.querySelector('#empty-state');
        if (emptyState) emptyState.remove();

        const el = document.createElement('div');
        el.className = 'message assistant';
        el.dataset.msgId = msgId;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.textContent = '🤖';

        const contentWrap = document.createElement('div');
        contentWrap.className = 'message-content-wrap';

        const thinkingWrap = document.createElement('div');
        thinkingWrap.className = 'streaming-thinking-wrap';

        const textEl = document.createElement('div');
        textEl.className = 'message-content md-content';

        const indicator = document.createElement('div');
        indicator.className = 'streaming-indicator';
        indicator.innerHTML = `<span class="streaming-dot"></span><span class="streaming-dot"></span><span class="streaming-dot"></span>`;
        textEl.appendChild(indicator);

        contentWrap.appendChild(thinkingWrap);
        contentWrap.appendChild(textEl);
        el.appendChild(avatar);
        el.appendChild(contentWrap);
        container.appendChild(el);

        if (isNearBottom(200)) scrollToBottom();
        return el;
    }

    function updateStreamingThinking(msgEl, thinkingText) {
        const wrap = msgEl.querySelector('.streaming-thinking-wrap');
        if (!wrap) return;
        let details = wrap.querySelector('.thinking-block');
        if (!details) {
            details = document.createElement('details');
            details.className = 'thinking-block';
            details.setAttribute('open', '');
            const summary = document.createElement('summary');
            summary.textContent = 'Thinking…';
            const content = document.createElement('div');
            content.className = 'thinking-content';
            details.appendChild(summary);
            details.appendChild(content);
            wrap.appendChild(details);
        }
        const content = details.querySelector('.thinking-content');
        if (content) content.textContent = thinkingText;
        if (isNearBottom(200)) scrollToBottom();
    }

    function updateStreamingContent(msgEl, text) {
        const textEl = msgEl.querySelector('.message-content');
        if (!textEl) return;
        textEl.innerHTML = renderMarkdown(text) + '<span class="typing-cursor"></span>';
        renderKatex(textEl);
        if (isNearBottom(200)) scrollToBottom();
    }

    function finalizeStreamedMessage(msgEl, text, thinking, thinkingDuration) {
        const textEl = msgEl.querySelector('.message-content');
        if (textEl) {
            textEl.innerHTML = renderMarkdown(text || '');
            renderKatex(textEl);
        }

        // Update thinking block
        const thinkWrap = msgEl.querySelector('.streaming-thinking-wrap');
        if (thinkWrap) {
            thinkWrap.innerHTML = '';
            if (thinking && thinking.length > 0) {
                thinkWrap.appendChild(createThinkingBlock(thinking, thinkingDuration));
            }
        }

        // Add footer
        const conv = getActiveConversation();
        const msg = conv?.messages.find(m => m.id === msgEl.dataset.msgId);
        if (msg) {
            const footer = document.createElement('div');
            footer.className = 'message-footer';
            const ts = document.createElement('span');
            ts.className = 'message-timestamp';
            ts.title = new Date(msg.timestamp).toLocaleString();
            ts.textContent = relativeTime(msg.timestamp);
            footer.appendChild(ts);

            if (state.settings.show_token_count && msg.tokens) {
                const total = (msg.tokens.input || 0) + (msg.tokens.output || 0);
                if (total > 0) {
                    const tc = document.createElement('span');
                    tc.className = 'token-count';
                    tc.textContent = `~${total.toLocaleString()} tokens`;
                    footer.appendChild(tc);
                }
            }

            if (msg.model) {
                const mb = document.createElement('span');
                mb.className = 'message-model-badge';
                mb.textContent = msg.model.split('/').pop();
                footer.appendChild(mb);
            }

            const contentWrap = msgEl.querySelector('.message-content-wrap');
            if (contentWrap) {
                contentWrap.appendChild(footer);
                contentWrap.appendChild(createMessageActions(msg));
            }
        }
    }

    function showErrorMessage(msgEl, errorText) {
        const textEl = msgEl?.querySelector('.message-content');
        if (textEl) {
            textEl.innerHTML = `<div class="error-message">⚠ ${escapeHtml(errorText)}</div>`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 8: MARKDOWN & CODE RENDERING
    // ─────────────────────────────────────────────────────────────────────────────

    function setupMarked() {
        if (typeof marked === 'undefined') return;

        const renderer = new marked.Renderer();

        renderer.code = (code, language) => {
            const lang = (language || 'plaintext').trim();
            let highlighted;
            try {
                if (typeof hljs !== 'undefined') {
                    if (hljs.getLanguage(lang)) {
                        highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
                    } else {
                        highlighted = hljs.highlightAuto(code).value;
                    }
                } else {
                    highlighted = escapeHtml(code);
                }
            } catch {
                highlighted = escapeHtml(code);
            }

            let encodedCode;
            try {
                encodedCode = btoa(unescape(encodeURIComponent(code)));
            } catch {
                encodedCode = btoa(code);
            }

            return `<div class="code-block">
        <div class="code-header">
          <span class="code-lang">${escapeHtml(lang)}</span>
          <button class="copy-code-btn" data-code="${encodedCode}">Copy</button>
        </div>
        <pre><code class="hljs language-${escapeHtml(lang)}">${highlighted}</code></pre>
      </div>`;
        };

        renderer.link = (href, title, text) =>
            `<a href="${href}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ''}>${text} ↗</a>`;

        marked.setOptions({ renderer, breaks: true, gfm: true });
    }

    function renderMarkdown(text) {
        if (!text) return '';
        try {
            return typeof marked !== 'undefined' ? marked.parse(text) : escapeHtml(text).replace(/\n/g, '<br>');
        } catch {
            return escapeHtml(text).replace(/\n/g, '<br>');
        }
    }

    function renderKatex(el) {
        if (typeof renderMathInElement !== 'function') return;
        try {
            renderMathInElement(el, {
                delimiters: [
                    { left: '$$', right: '$$', display: true },
                    { left: '$', right: '$', display: false },
                    { left: '\\[', right: '\\]', display: true },
                    { left: '\\(', right: '\\)', display: false },
                ],
                throwOnError: false,
            });
        } catch { }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 9: STREAMING & API CALLS
    // ─────────────────────────────────────────────────────────────────────────────

    async function sendMessage(userText, attachments = []) {
        if (!userText.trim() && !attachments.length) return;
        if (state.isStreaming) return;
        if (!getApiKey()) {
            showToast('Add your API key in Settings first', 'error');
            openSettings('api');
            return;
        }

        let conv = getActiveConversation();
        if (!conv) {
            conv = createConversation();
            state.activeConvId = conv.id;
            lsSet(LS.ACTIVE_CONV, conv.id);
        }

        const model = getModelById(state.settings.chat_model);

        const serializedAttachments = attachments.map(serializeAttachmentForMessage);
        const imageAttachments = attachments.filter(att => att.kind === 'image' && att.dataUrl);
        const textAttachments = attachments.filter(att => att.kind === 'text' && typeof att.text === 'string');
        const otherAttachments = attachments.filter(att => att.kind === 'file' || (att.kind === 'image' && !att.dataUrl));

        // Build user message content for the API.
        let userContent;
        const parts = [];
        const trimmedText = userText.trim();
        if (trimmedText) parts.push({ type: 'text', text: trimmedText });

        if (imageAttachments.length && modelCan(model, 'vision')) {
            for (const attachment of imageAttachments) {
                parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } });
            }
        }

        const shouldAddAttachmentSummary = attachments.length > 0 && (
            textAttachments.length > 0 ||
            otherAttachments.length > 0 ||
            (imageAttachments.length > 0 && !modelCan(model, 'vision'))
        );

        if (shouldAddAttachmentSummary) {
            parts.push({ type: 'text', text: buildAttachmentSummary(attachments, modelCan(model, 'vision')) });
        }

        userContent = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;

        const userMsg = {
            id: uuid(),
            role: 'user',
            content: userContent,
            attachments: serializedAttachments,
            timestamp: Date.now()
        };

        addMessageToConversation(conv.id, userMsg);

        // Clear empty state and add user message to DOM
        const container = document.getElementById('messages-container');
        const emptyState = document.getElementById('empty-state');
        if (emptyState) {
            emptyState.classList.add('hidden');
            const inContainer = container?.querySelector('#empty-state');
            if (inContainer) inContainer.remove();
        }

        if (container) container.appendChild(createMessageEl(userMsg));
        if (isNearBottom(200)) scrollToBottom();

        clearInput();
        renderSidebar();

        // Create assistant placeholder
        const assistantMsgId = uuid();
        const assistantMsg = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            thinking: '',
            model: state.settings.chat_model,
            tokens: { input: 0, output: 0 },
            timestamp: Date.now()
        };
        addMessageToConversation(conv.id, assistantMsg);

        const msgEl = renderStreamingPlaceholder(assistantMsgId);

        await sendMessageInternal(conv, assistantMsgId, msgEl, userContent);
    }

    async function sendMessageInternal(conv, assistantMsgId, msgEl, originalUserContent) {
        // If called from regenerate, find the placeholder
        if (!assistantMsgId || !msgEl) {
            assistantMsgId = uuid();
            const assistantMsg = {
                id: assistantMsgId,
                role: 'assistant',
                content: '',
                thinking: '',
                model: state.settings.chat_model,
                tokens: { input: 0, output: 0 },
                timestamp: Date.now()
            };
            addMessageToConversation(conv.id, assistantMsg);
            msgEl = renderStreamingPlaceholder(assistantMsgId);
        }

        const model = getModelById(state.settings.chat_model);

        // Build messages array for API
        const messages = [];
        const systemPrompt = conv.system_prompt || state.settings.system_prompt;
        if (systemPrompt) {
            messages.push({ role: 'system', content: compactTextForTransport(systemPrompt, 4000) });
        }
        for (const m of conv.messages) {
            if (m.id === assistantMsgId) continue;
            if (m.role === 'system') continue;
            messages.push(compactMessageForTransport(m));
        }

        const payload = {
            model: state.settings.chat_model,
            messages,
            max_tokens: state.settings.max_tokens,
            temperature: state.settings.temperature,
        };

        if (state.thinkingActive && modelCan(model, 'thinking')) {
            payload.include_reasoning = true;
            payload.reasoning = { max_tokens: state.settings.thinking_budget };
        }

        if (state.webSearchActive && modelCan(model, 'webSearch')) {
            payload.tools = [{ type: 'web_search' }];
        }

        state.isStreaming = true;
        state.abortController = new AbortController();
        setStreamingUI(true);

        let accText = '';
        let accThinking = '';
        let thinkingDuration = 0;

        try {
            const client = createOpenRouterClient();
            const response = await client.chat.send({
                ...payload,
                signal: state.abortController.signal,
            });

            const message = response?.choices?.[0]?.message || {};
            accText = typeof message.content === 'string' ? message.content : '';
            accThinking = typeof message.reasoning === 'string' ? message.reasoning : '';

            if (typeof message.reasoning === 'string' && message.reasoning.length > 0) {
                thinkingDuration = 0;
            }

            const usage = response?.usage;
            if (usage) {
                const finalMsgNow = conv.messages.find(m => m.id === assistantMsgId);
                if (finalMsgNow) {
                    finalMsgNow.tokens = {
                        input: usage.prompt_tokens || 0,
                        output: usage.completion_tokens || 0
                    };
                }
                addUsageForActiveKey(model, usage);
            }

            // Finalize
            const finalMsg = conv.messages.find(m => m.id === assistantMsgId);
            if (finalMsg) {
                finalMsg.content = accText;
                finalMsg.thinking = accThinking;
                finalMsg.thinkingDuration = thinkingDuration;
                // Estimate tokens if not provided
                if (!finalMsg.tokens.output && accText) {
                    finalMsg.tokens.output = Math.ceil(accText.length / 4);
                }
                saveConversations();
            }

            finalizeStreamedMessage(msgEl, accText, accThinking, thinkingDuration);
            renderSidebar();

            // Auto-title on first exchange
            const userMessages = conv.messages.filter(m => m.role === 'user');
            if (userMessages.length === 1 && state.settings.auto_title && conv.title === 'New Conversation') {
                const firstUserText = typeof userMessages[0].content === 'string'
                    ? userMessages[0].content
                    : (userMessages[0].content.find?.(p => p.type === 'text')?.text || '');
                autoGenerateTitle(conv.id, firstUserText);
            }

            updateDetailsPanel();
            updateSpendDisplays();

        } catch (err) {
            if (err.name === 'AbortError') {
                const finalMsg = conv.messages.find(m => m.id === assistantMsgId);
                if (finalMsg) {
                    finalMsg.content = accText;
                    finalMsg.thinking = accThinking;
                    finalMsg.thinkingDuration = thinkingDuration;
                    saveConversations();
                }
                finalizeStreamedMessage(msgEl, accText, accThinking, thinkingDuration);
                showToast('Generation stopped', 'info');
            } else {
                showErrorMessage(msgEl, err.message);
                // Remove failed placeholder from conversation
                const failedIdx = conv.messages.findIndex(m => m.id === assistantMsgId);
                if (failedIdx !== -1) conv.messages.splice(failedIdx, 1);
                saveConversations();
                showToast(`Error: ${err.message}`, 'error');
            }
        } finally {
            state.isStreaming = false;
            state.abortController = null;
            setStreamingUI(false);
        }
    }

    function setStreamingUI(streaming) {
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const input = document.getElementById('message-input');
        if (sendBtn) sendBtn.classList.toggle('hidden', streaming);
        if (stopBtn) stopBtn.classList.toggle('hidden', !streaming);
        if (input) input.disabled = streaming;
    }

    function stopGeneration() {
        if (state.abortController) state.abortController.abort();
    }

    function clearInput() {
        const input = document.getElementById('message-input');
        if (input) {
            input.value = '';
            input.style.height = 'auto';
            updateTokenCounter('');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 10: AUTO TITLE GENERATION
    // ─────────────────────────────────────────────────────────────────────────────

    async function autoGenerateTitle(convId, firstUserMessage) {
        if (!getApiKey() || !firstUserMessage.trim()) return;
        try {
            const client = createOpenRouterClient();
            const response = await client.chat.send({
                model: state.settings.title_model || 'openai/gpt-4o-mini',
                messages: [{
                    role: 'user',
                    content: `Write a short 3-6 word title for a conversation starting with: "${firstUserMessage.slice(0, 200)}". Reply with ONLY the title, no quotes, no period.`
                }],
                max_tokens: 30,
                temperature: 0.5,
            });
            const title = response?.choices?.[0]?.message?.content?.trim();
            if (title && title.length < 80) {
                renameConversation(convId, title);
                renderSidebar();
                if (convId === state.activeConvId) {
                    const td = document.getElementById('chat-title-display');
                    if (td) td.textContent = title;
                }
                return;
            }

            const fallbackTitle = generateLocalTitle(firstUserMessage);
            renameConversation(convId, fallbackTitle);
            renderSidebar();
            if (convId === state.activeConvId) {
                const td = document.getElementById('chat-title-display');
                if (td) td.textContent = fallbackTitle;
            }
        } catch {
            const fallbackTitle = generateLocalTitle(firstUserMessage);
            renameConversation(convId, fallbackTitle);
            renderSidebar();
            if (convId === state.activeConvId) {
                const td = document.getElementById('chat-title-display');
                if (td) td.textContent = fallbackTitle;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 11: IMAGE GENERATION
    // ─────────────────────────────────────────────────────────────────────────────

    function createImageOutput(imageUrl) {
        const wrap = document.createElement('div');
        wrap.className = 'generated-image-wrap';
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'generated-image';
        img.loading = 'lazy';
        img.addEventListener('click', () => openLightbox(imageUrl));
        const dlBtn = document.createElement('a');
        dlBtn.href = imageUrl;
        dlBtn.download = `hackclub-ai-${Date.now()}.png`;
        dlBtn.className = 'btn-secondary image-dl-btn';
        dlBtn.textContent = '⬇ Download';
        wrap.appendChild(img);
        wrap.appendChild(dlBtn);
        return wrap;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 12: INPUT HANDLING
    // ─────────────────────────────────────────────────────────────────────────────

    function setupInputHandlers() {
        const input = document.getElementById('message-input');
        const sendBtn = document.getElementById('send-btn');
        const stopBtn = document.getElementById('stop-btn');
        const attachBtn = document.getElementById('attach-btn');
        const fileInput = document.getElementById('file-input');
        const clearAttachmentsBtn = document.getElementById('clear-attachments-btn');
        const emptySettingsBtn = document.getElementById('empty-settings-btn');

        if (!input) return;

        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 240) + 'px';
            updateTokenCounter(input.value);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && state.settings.enter_to_send !== false && !state.isStreaming) {
                e.preventDefault();
                handleSend();
                return;
            }
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                handleSend();
                return;
            }
            if (e.key === 'ArrowUp' && !input.value.trim()) {
                e.preventDefault();
                editLastUserMessage();
            }
        });

        sendBtn?.addEventListener('click', handleSend);
        stopBtn?.addEventListener('click', stopGeneration);
        attachBtn?.addEventListener('click', () => fileInput?.click());
        fileInput?.addEventListener('change', handleFileAttach);
        clearAttachmentsBtn?.addEventListener('click', clearAttachments);
        emptySettingsBtn?.addEventListener('click', () => openSettings('api'));
    }

    function handleSend() {
        const input = document.getElementById('message-input');
        const text = input ? input.value : '';
        if (!text.trim() && !state.attachedFiles.length) return;

        if (!state.activeConvId) {
            const conv = createConversation();
            state.activeConvId = conv.id;
            lsSet(LS.ACTIVE_CONV, conv.id);
            renderSidebar();
        }

        sendMessage(text, state.attachedFiles);
        clearAttachments();
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
    }

    async function handleFileAttach(e) {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;

        const model = getModelById(state.settings.chat_model);
        const addedAttachments = [];

        try {
            for (const file of files) {
                if (file.size > 25 * 1024 * 1024) {
                    showToast(`Skipped ${file.name}: file is larger than 25MB`, 'warning');
                    continue;
                }

                const attachment = {
                    id: uuid(),
                    name: file.name,
                    size: file.size,
                    type: file.type || 'application/octet-stream',
                    kind: file.type?.startsWith('image/') ? 'image' : isTextLikeFile(file) ? 'text' : 'file',
                    file,
                };

                if (attachment.kind === 'image') {
                    attachment.dataUrl = await readOptimizedImageDataUrl(file);
                    if (!modelCan(model, 'vision')) {
                        showToast('Images are attached, but the current model cannot view them', 'warning');
                    }
                } else if (attachment.kind === 'text') {
                    attachment.text = await readFileAsText(file);
                }

                addedAttachments.push(attachment);
            }

            if (addedAttachments.length) {
                state.attachedFiles = state.attachedFiles.concat(addedAttachments);
                renderAttachmentPreview();
            }
        } catch (err) {
            showToast(`Attachment failed: ${err.message}`, 'error');
        }

        e.target.value = '';
    }

    function isTextLikeFile(file) {
        const type = String(file.type || '').toLowerCase();
        if (type.startsWith('text/')) return true;
        if (['application/json', 'application/xml', 'application/yaml', 'application/rtf'].includes(type)) return true;
        return /\.(txt|md|markdown|mdx|csv|tsv|json|js|jsx|ts|tsx|html|htm|css|scss|less|xml|yaml|yml|py|java|c|cc|cpp|h|hpp|go|rs|rb|php|sh|toml|ini|env|sql|log)$/i.test(file.name);
    }

    function formatFileSize(bytes) {
        if (!Number.isFinite(bytes)) return '';
        const units = ['B', 'KB', 'MB', 'GB'];
        let value = bytes;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }
        const display = value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1);
        return `${display} ${units[unitIndex]}`;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(String(ev.target?.result || ''));
            reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}`));
            reader.readAsDataURL(file);
        });
    }

    async function readOptimizedImageDataUrl(file) {
        const originalDataUrl = await readFileAsDataUrl(file);

        try {
            const image = await loadImageFromDataUrl(originalDataUrl);
            const maxDimension = 1280;
            const scale = Math.min(maxDimension / image.width, maxDimension / image.height, 1);
            const width = Math.max(1, Math.round(image.width * scale));
            const height = Math.max(1, Math.round(image.height * scale));

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            if (!context) return originalDataUrl;

            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);

            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.72);
            return optimizedDataUrl.length < originalDataUrl.length ? optimizedDataUrl : originalDataUrl;
        } catch {
            return originalDataUrl;
        }
    }

    function loadImageFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Unable to decode image'));
            image.src = dataUrl;
        });
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(String(ev.target?.result || ''));
            reader.onerror = () => reject(reader.error || new Error(`Unable to read ${file.name}`));
            reader.readAsText(file);
        });
    }

    function clearAttachments() {
        state.attachedFiles = [];
        renderAttachmentPreview();
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
    }

    function serializeAttachmentForMessage(attachment) {
        const serialized = {
            id: attachment.id,
            name: attachment.name,
            size: attachment.size,
            type: attachment.type,
            kind: attachment.kind,
        };
        if (attachment.dataUrl) serialized.dataUrl = attachment.dataUrl;
        if (typeof attachment.text === 'string') serialized.text = attachment.text;
        return serialized;
    }

    function buildCompactAttachmentSnippet(attachment, visionSupported) {
        const pieces = [];
        const name = compactTextForTransport(attachment.name, 120);
        if (name) pieces.push(name);

        const size = formatFileSize(attachment.size);
        if (size) pieces.push(size);

        if (attachment.type) pieces.push(attachment.type);

        let line = pieces.length ? `- ${pieces.join(' · ')}` : '- Attachment';

        if (attachment.kind === 'text' && typeof attachment.text === 'string' && attachment.text.trim()) {
            const snippet = compactTextForTransport(attachment.text, 320);
            if (snippet) line += `: ${snippet}`;
        } else if (attachment.kind === 'image' && !visionSupported) {
            line += ': image attached separately';
        }

        return line;
    }

    function buildAttachmentSummary(attachments, visionSupported) {
        const lines = ['Attached files:'];
        for (const attachment of attachments) {
            lines.push(buildCompactAttachmentSnippet(attachment, visionSupported));
        }
        return compactTextForTransport(lines.join('\n'), 1200);
    }

    function createAttachmentList(attachments) {
        const wrap = document.createElement('div');
        wrap.className = 'attachment-list';
        for (const attachment of attachments) {
            wrap.appendChild(createAttachmentCard(attachment));
        }
        return wrap;
    }

    function createAttachmentCard(attachment, removable = false) {
        const item = document.createElement('div');
        item.className = `attachment-card ${attachment.kind}`;

        if (attachment.kind === 'image' && attachment.dataUrl) {
            const img = document.createElement('img');
            img.src = attachment.dataUrl;
            img.alt = attachment.name;
            img.className = 'attachment-image';
            img.addEventListener('click', () => openLightbox(attachment.dataUrl));
            item.appendChild(img);
        } else {
            const icon = document.createElement('div');
            icon.className = 'attachment-icon';
            icon.textContent = attachment.kind === 'text' ? 'TXT' : 'FILE';
            item.appendChild(icon);
        }

        const meta = document.createElement('div');
        meta.className = 'attachment-meta';

        const title = document.createElement('div');
        title.className = 'attachment-name';
        title.textContent = attachment.name;
        meta.appendChild(title);

        const details = document.createElement('div');
        details.className = 'attachment-details';
        details.textContent = [formatFileSize(attachment.size), attachment.type || 'unknown'].filter(Boolean).join(' · ');
        meta.appendChild(details);

        if (attachment.kind === 'text' && typeof attachment.text === 'string' && attachment.text.trim()) {
            const snippet = document.createElement('div');
            snippet.className = 'attachment-snippet';
            const previewText = attachment.text.trim().slice(0, 280);
            snippet.textContent = previewText + (attachment.text.trim().length > previewText.length ? '…' : '');
            meta.appendChild(snippet);
        }

        item.appendChild(meta);

        if (removable) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'attachment-remove-btn';
            removeBtn.setAttribute('aria-label', `Remove ${attachment.name}`);
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', () => {
                state.attachedFiles = state.attachedFiles.filter(att => att.id !== attachment.id);
                renderAttachmentPreview();
            });
            item.appendChild(removeBtn);
        }

        return item;
    }

    function renderAttachmentPreview() {
        const strip = document.getElementById('attachment-preview-strip');
        const list = document.getElementById('attachment-preview-list');
        if (!strip || !list) return;

        list.innerHTML = '';
        if (!state.attachedFiles.length) {
            strip.classList.add('hidden');
            return;
        }

        for (const attachment of state.attachedFiles) {
            list.appendChild(createAttachmentCard(attachment, true));
        }
        strip.classList.remove('hidden');
    }

    function updateTokenCounter(text) {
        const count = Math.ceil((text || '').length / 4);
        const model = getModelById(state.settings.chat_model);
        const ctxLen = model?.context_length || 0;
        const counter = document.getElementById('token-counter');
        if (counter) {
            counter.textContent = ctxLen
                ? `~${count.toLocaleString()} / ${formatContextLength(ctxLen)} tokens`
                : `~${count.toLocaleString()} tokens`;
        }
        const contextBar = document.getElementById('context-warning');
        if (ctxLen && contextBar) {
            const pct = count / ctxLen;
            contextBar.classList.toggle('hidden', pct < 0.8);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 13: COMMAND PALETTE
    // ─────────────────────────────────────────────────────────────────────────────

    function openCommandPalette() {
        const modal = document.getElementById('command-palette');
        const input = document.getElementById('command-input');
        if (!modal) return;
        closeDropdowns();
        modal.classList.remove('hidden');
        if (input) { input.value = ''; input.focus(); }
        renderCommandResults('');
        state.commandPaletteOpen = true;
        state.commandSelectedIndex = -1;
    }

    function closeCommandPalette() {
        document.getElementById('command-palette')?.classList.add('hidden');
        state.commandPaletteOpen = false;
        state.commandSelectedIndex = -1;
    }

    function renderCommandResults(query) {
        const results = document.getElementById('command-results');
        if (!results) return;
        const q = query.toLowerCase().trim();
        const items = [];

        // Actions
        const actions = [
            { type: 'action', label: 'New Conversation', icon: '✏️', shortcut: 'Ctrl+N', fn: () => { newConversation(); closeCommandPalette(); } },
            { type: 'action', label: 'Open Settings', icon: '⚙️', shortcut: 'Ctrl+,', fn: () => { openSettings(); closeCommandPalette(); } },
            { type: 'action', label: 'Toggle Thinking Mode', icon: '🧠', shortcut: 'Ctrl+Shift+T', fn: () => { toggleThinking(); closeCommandPalette(); } },
            { type: 'action', label: 'Toggle Web Search', icon: '🔍', fn: () => { toggleWebSearch(); closeCommandPalette(); } },
            { type: 'action', label: 'Clear Current Chat', icon: '🗑️', shortcut: 'Ctrl+L', fn: () => { clearChat(); closeCommandPalette(); } },
            { type: 'action', label: 'Export Chat (Markdown)', icon: '⬇️', shortcut: 'Ctrl+Shift+E', fn: () => { exportChat('markdown-dl'); closeCommandPalette(); } },
            { type: 'action', label: 'Export Chat (JSON)', icon: '📄', fn: () => { exportChat('json'); closeCommandPalette(); } },
            { type: 'action', label: 'View Keyboard Shortcuts', icon: '⌨️', fn: () => { openSettings('shortcuts'); closeCommandPalette(); } },
        ];
        items.push(...actions.filter(a => !q || a.label.toLowerCase().includes(q)));

        // Conversations
        const convMatches = state.conversations
            .filter(c => !q || c.title.toLowerCase().includes(q))
            .slice(0, 5)
            .map(c => ({
                type: 'conversation',
                label: c.title,
                icon: '💬',
                fn: () => { setActiveConversation(c.id); closeCommandPalette(); }
            }));
        items.push(...convMatches);

        // Models
        const modelMatches = state.models
            .filter(m => !q || (m.name || m.id).toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
            .slice(0, 4)
            .map(m => ({
                type: 'model',
                label: `Switch to ${m.name || m.id}`,
                icon: '🔄',
                fn: () => { switchModel(m.id); closeCommandPalette(); }
            }));
        items.push(...modelMatches);

        state.commandItems = items;
        state.commandSelectedIndex = -1;

        results.innerHTML = '';
        if (!items.length) {
            results.innerHTML = '<div class="command-empty">No results found</div>';
            return;
        }

        const frag = document.createDocumentFragment();
        let lastType = null;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type !== lastType) {
                const label = document.createElement('div');
                label.className = 'command-section-label';
                label.textContent = { action: 'Actions', conversation: 'Conversations', model: 'Models' }[item.type] || item.type;
                frag.appendChild(label);
                lastType = item.type;
            }

            const el = document.createElement('div');
            el.className = 'command-item';
            el.dataset.index = i;

            let labelHtml = escapeHtml(item.label);
            if (q) {
                const re = new RegExp(`(${escapeRegex(q)})`, 'gi');
                labelHtml = labelHtml.replace(re, '<mark>$1</mark>');
            }

            el.innerHTML = `
        <span class="command-item-icon">${item.icon}</span>
        <span class="command-item-label">${labelHtml}</span>
        ${item.shortcut ? `<span class="command-item-shortcut">${item.shortcut.split('+').map(k => `<kbd>${k}</kbd>`).join('')}</span>` : ''}
        <span class="command-item-type">${item.type}</span>
      `;
            el.addEventListener('click', () => item.fn());
            el.addEventListener('mouseenter', () => {
                results.querySelectorAll('.command-item.focused').forEach(el => el.classList.remove('focused'));
                el.classList.add('focused');
                state.commandSelectedIndex = i;
            });
            frag.appendChild(el);
        }
        results.appendChild(frag);
    }

    function handleCommandPaletteNav(e) {
        const items = document.querySelectorAll('#command-results .command-item');
        if (!items.length) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            state.commandSelectedIndex = Math.min(state.commandSelectedIndex + 1, items.length - 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            state.commandSelectedIndex = Math.max(state.commandSelectedIndex - 1, 0);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const idx = state.commandSelectedIndex;
            if (idx >= 0 && state.commandItems[idx]) {
                state.commandItems[idx].fn();
            } else if (items.length > 0) {
                state.commandItems[0]?.fn();
            }
            return;
        } else if (e.key === 'Escape') {
            closeCommandPalette();
            return;
        } else {
            return;
        }

        items.forEach(el => el.classList.remove('focused'));
        if (state.commandSelectedIndex >= 0 && items[state.commandSelectedIndex]) {
            items[state.commandSelectedIndex].classList.add('focused');
            items[state.commandSelectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 14: SETTINGS MODAL
    // ─────────────────────────────────────────────────────────────────────────────

    function openSettings(tabId) {
        const modal = document.getElementById('settings-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        loadSettingsIntoUI();
        if (tabId) switchSettingsTab(tabId);
        document.getElementById('api-key-name-input')?.focus();
    }

    function closeSettings() {
        document.getElementById('settings-modal')?.classList.add('hidden');
    }

    function switchSettingsTab(tabId) {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-pane').forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
        const tab = document.querySelector(`.settings-tab[data-tab="${tabId}"]`);
        const pane = document.getElementById(`tab-${tabId}`);
        if (tab) tab.classList.add('active');
        if (pane) { pane.classList.remove('hidden'); pane.classList.add('active'); }
    }

    function setupApiKeyTest() {
        const testBtn = document.getElementById('api-key-test-btn');
        if (!testBtn) return;
        testBtn.addEventListener('click', async () => {
            const keyInput = document.getElementById('api-key-input');
            const nameInput = document.getElementById('api-key-name-input');
            const statusEl = document.getElementById('api-key-status');
            const key = keyInput?.value.trim() || getApiKey();
            const name = nameInput?.value.trim() || getActiveApiKeyRecord()?.name || 'API Key';
            if (!key) {
                showApiKeyStatus('Enter an API key first', 'error');
                return;
            }
            testBtn.textContent = 'Testing…';
            testBtn.disabled = true;
            try {
                const baseUrl = (document.getElementById('base-url-input')?.value || state.settings.base_url).trim();
                const client = new OpenRouter({ apiKey: key, baseURL: baseUrl });
                const response = await client.chat.send({
                    model: 'openai/gpt-4o-mini',
                    messages: [{ role: 'user', content: 'Hello!' }],
                    max_tokens: 1,
                    temperature: 0,
                });
                if (response?.choices?.[0]?.message) {
                    showApiKeyStatus('✓ Connected successfully', 'success');
                    const matching = state.apiKeys.find(record => record.key === key);
                    if (matching) {
                        state.activeApiKeyId = matching.id;
                        saveApiKeys();
                        renderApiKeysList();
                        updateApiKeyFields();
                    }
                    updateApiStatus();
                    updateConnStatusDisplay();
                } else {
                    showApiKeyStatus('✕ Failed', 'error');
                }
            } catch (err) {
                showApiKeyStatus(`✕ ${err.message}`, 'error');
            } finally {
                testBtn.textContent = 'Test';
                testBtn.disabled = false;
            }
        });
    }

    function showApiKeyStatus(msg, type) {
        const el = document.getElementById('api-key-status');
        if (!el) return;
        el.textContent = msg;
        el.className = `status-line ${type}`;
        el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 4000);
    }

    function setupApiKeyToggle() {
        const btn = document.getElementById('api-key-show-btn');
        const input = document.getElementById('api-key-input');
        if (!btn || !input) return;
        btn.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            btn.textContent = show ? '🙈' : '👁';
        });
    }

    function updateApiStatus() {
        const dot = document.getElementById('api-status-dot');
        const label = document.getElementById('api-status-label');
        const active = getActiveApiKeyRecord();
        const hasKey = !!active;
        if (dot) dot.className = hasKey ? 'connected' : '';
        if (label) label.textContent = hasKey ? `Connected: ${active.name}` : 'No API Key';
        updateSpendDisplays();
    }

    function updateConnStatusDisplay() {
        const el = document.getElementById('conn-status-display');
        if (!el) return;
        const active = getActiveApiKeyRecord();
        if (active) {
            el.textContent = `Connected: ${active.name}`;
            el.className = 'status-badge connected';
        } else {
            el.textContent = 'Not connected';
            el.className = 'status-badge';
        }
        updateSpendDisplays();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 15: HEADER CONTROLS
    // ─────────────────────────────────────────────────────────────────────────────

    function toggleThinking() {
        state.thinkingActive = !state.thinkingActive;
        const btn = document.getElementById('thinking-btn');
        if (btn) btn.dataset.active = state.thinkingActive ? 'true' : 'false';
        showToast(`Thinking mode ${state.thinkingActive ? 'enabled' : 'disabled'}`, 'info');
    }

    function toggleWebSearch() {
        state.webSearchActive = !state.webSearchActive;
        const btn = document.getElementById('websearch-btn');
        if (btn) btn.dataset.active = state.webSearchActive ? 'true' : 'false';
        showToast(`Web search ${state.webSearchActive ? 'enabled' : 'disabled'}`, 'info');
    }

    function toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        if (window.innerWidth <= 768) {
            // Mobile: overlay toggle
            const isOpen = sidebar.classList.contains('open');
            if (isOpen) {
                closeMobileSidebar();
            } else {
                sidebar.classList.add('open');
                const overlay = document.getElementById('sidebar-overlay');
                if (overlay) overlay.classList.remove('hidden');
            }
        } else {
            // Desktop: hide/show sidebar entirely
            sidebar.style.display = sidebar.style.display === 'none' ? '' : 'none';
        }
    }

    function closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        sidebar?.classList.remove('open');
        overlay?.classList.add('hidden');
    }

    function toggleDetailsPanel() {
        const panel = document.getElementById('details-panel');
        if (!panel) return;
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) updateDetailsPanel();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 16: MODEL SELECTOR HEADER DROPDOWN
    // ─────────────────────────────────────────────────────────────────────────────

    function setupModelSelectorBtn() {
        const btn = document.getElementById('model-selector-btn');
        const dropdown = document.getElementById('model-dropdown');
        if (!btn || !dropdown) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !dropdown.classList.contains('hidden');
            closeDropdowns();
            if (!isOpen) {
                dropdown.classList.remove('hidden');
                btn.setAttribute('aria-expanded', 'true');
                state.currentDropdown = dropdown;
                document.getElementById('model-search')?.focus();
                // Re-render list
                renderAllModelDropdowns();
            }
        });
    }

    function closeDropdowns() {
        document.querySelectorAll('.dropdown').forEach(d => d.classList.add('hidden'));
        document.getElementById('model-selector-btn')?.setAttribute('aria-expanded', 'false');
        state.currentDropdown = null;
    }

    function setupExportDropdown() {
        const btn = document.getElementById('export-btn');
        const dropdown = document.getElementById('export-dropdown');
        if (!btn || !dropdown) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = !dropdown.classList.contains('hidden');
            closeDropdowns();
            if (!isOpen) {
                dropdown.classList.remove('hidden');
                state.currentDropdown = dropdown;
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 17: DETAILS PANEL
    // ─────────────────────────────────────────────────────────────────────────────

    function updateDetailsPanel() {
        const panel = document.getElementById('details-panel');
        if (!panel || panel.classList.contains('hidden')) return;

        const model = getModelById(state.settings.chat_model);
        const conv = getActiveConversation();

        const setEl = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.textContent = text || '—';
        };

        setEl('details-model-name', model ? (model.name || model.id) : state.settings.chat_model);
        setEl('details-model-provider', model ? `Provider: ${getProviderFromId(model.id)}` : '');
        setEl('details-model-ctx', model?.context_length ? `Context: ${formatContextLength(model.context_length)} tokens` : '');

        const capsEl = document.getElementById('details-model-caps');
        if (capsEl) capsEl.innerHTML = model ? modelCapBadges(model) : '';

        // Pricing
        const pricingIn = model?.pricing?.prompt ? `Input: ${formatPrice(model.pricing.prompt)}/M` : 'Input: —';
        const pricingOut = model?.pricing?.completion ? `Output: ${formatPrice(model.pricing.completion)}/M` : 'Output: —';
        setEl('details-pricing-in', pricingIn);
        setEl('details-pricing-out', pricingOut);

        // Conversation stats
        if (conv) {
            const msgs = conv.messages.filter(m => m.role !== 'system');
            setEl('details-msg-count', `${msgs.length} messages`);

            const totalTokens = msgs.reduce((sum, m) => {
                const txt = typeof m.content === 'string' ? m.content : (m.content?.find?.(p => p.type === 'text')?.text || '');
                return sum + Math.ceil(txt.length / 4);
            }, 0);
            setEl('details-token-est', `~${totalTokens.toLocaleString()} tokens (est.)`);

            if (model?.pricing?.prompt && model?.pricing?.completion) {
                const inputCost = (totalTokens / 2 / 1_000_000) * parseFloat(model.pricing.prompt);
                const outputCost = (totalTokens / 2 / 1_000_000) * parseFloat(model.pricing.completion);
                setEl('details-cost-est', `~$${(inputCost + outputCost).toFixed(4)} (est.)`);
            } else {
                setEl('details-cost-est', 'Cost: N/A');
            }
        } else {
            setEl('details-msg-count', 'No conversation');
            setEl('details-token-est', '—');
            setEl('details-cost-est', '—');
        }

        const active = getActiveApiKeyRecord();
        setEl('details-spend-today', active ? `Today: ${formatMoney(getDailySpendForKey(active.id))} (${active.name})` : 'Today: —');

        // Parameters
        setEl('details-temp', `Temperature: ${state.settings.temperature}`);
        setEl('details-max-tokens', `Max tokens: ${state.settings.max_tokens.toLocaleString()}`);
        setEl('details-thinking-status', `Thinking: ${state.thinkingActive ? 'enabled' : 'disabled'}`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 18: EXPORT & IMPORT
    // ─────────────────────────────────────────────────────────────────────────────

    function exportChat(format) {
        const conv = getActiveConversation();
        if (!conv) { showToast('No active conversation', 'warning'); return; }

        if (format === 'markdown' || format === 'markdown-dl') {
            let md = `# ${conv.title}\n\n`;
            md += `*Exported from HackClub AI · ${new Date().toLocaleString()}*\n\n---\n\n`;
            for (const m of conv.messages) {
                if (m.role === 'system') continue;
                const role = m.role === 'user' ? '**You**' : `**Assistant** *(${(m.model || '').split('/').pop() || 'AI'})*`;
                const text = typeof m.content === 'string' ? m.content
                    : (m.content?.find?.(p => p.type === 'text')?.text || '');
                md += `${role}\n\n${text}\n\n---\n\n`;
            }
            if (format === 'markdown') {
                navigator.clipboard.writeText(md).then(() => showToast('Copied as Markdown', 'success'))
                    .catch(() => showToast('Copy failed', 'error'));
            } else {
                downloadText(md, `${sanitizeFilename(conv.title)}.md`, 'text/markdown');
                showToast('Downloaded as Markdown', 'success');
            }
        } else if (format === 'json') {
            const exportData = {
                version: 2,
                exported_at: new Date().toISOString(),
                meta: buildExportMeta(),
                conversation: conv,
            };
            downloadText(JSON.stringify(exportData, null, 2), `${sanitizeFilename(conv.title)}.json`, 'application/json');
            showToast('Downloaded as JSON', 'success');
        } else if (format === 'pdf') {
            openPdfExport(conv);
            showToast('Opened PDF export', 'success');
        } else if (format === 'html') {
            const html = buildExportHTML(conv);
            downloadText(html, `${sanitizeFilename(conv.title)}.html`, 'text/html');
            showToast('Downloaded as HTML', 'success');
        }
    }

    function buildExportHTML(conv, printMode = false) {
        const messages = conv.messages.filter(m => m.role !== 'system').map(m => {
            const text = typeof m.content === 'string' ? m.content
                : (m.content?.find?.(p => p.type === 'text')?.text || '');
            return `<div class="msg ${m.role}">
        <div class="role">${m.role === 'user' ? '👤 You' : '🤖 Assistant'}</div>
        <div class="content">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
        <div class="time">${m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}</div>
      </div>`;
        }).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(conv.title)}</title>
<style>
  @page { size: auto; margin: 14mm; }
  * { box-sizing: border-box; }
  body{font-family:Arial,Helvetica,sans-serif;background:${printMode ? '#ffffff' : '#0a0a0a'};color:${printMode ? '#111111' : '#efefef'};max-width:800px;margin:0 auto;padding:32px 16px;line-height:1.6}
  h1{color:${printMode ? '#111111' : '#e8d5b0'};margin-bottom:8px}
  .meta{color:${printMode ? '#555555' : '#555'};font-size:13px;margin-bottom:32px}
  .msg{margin-bottom:24px;padding:16px;border-radius:8px;border:1px solid ${printMode ? '#d7d7d7' : '#242424'};break-inside:avoid;page-break-inside:avoid}
  .msg.user{background:${printMode ? '#f3f3f3' : '#222'};border-radius:12px 12px 4px 12px}
  .msg.assistant{background:${printMode ? '#ffffff' : '#111'}}
  .role{font-size:12px;color:${printMode ? '#666666' : '#888'};margin-bottom:8px;font-weight:600}
  .content{font-size:14px;white-space:pre-wrap;word-break:break-word}
  .time{font-size:10px;color:${printMode ? '#777777' : '#555'};margin-top:8px}
  @media print {
    body { padding: 0; max-width: none; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(conv.title)}</h1>
<div class="meta">Exported ${new Date().toLocaleString()}</div>
${messages}
<script>
  window.addEventListener('load', () => {
    if (location.search.includes('autoprint=1')) {
      setTimeout(() => window.print(), 250);
    }
  });
</script>
</body>
</html>`;
    }

    function openPdfExport(conv) {
        const html = buildExportHTML(conv, true);
        const popup = window.open('', '_blank', 'noopener,noreferrer,width=1024,height=768');
        if (!popup) {
            showToast('Popup blocked. Allow popups to export PDF.', 'error');
            return;
        }

        popup.document.open();
        popup.document.write(html.replace('</head>', '</head>').replace('</body>', '</body>'));
        popup.document.close();

        const ready = () => {
            try {
                popup.focus();
                popup.print();
            } catch (err) {
                showToast(`PDF export failed: ${err.message}`, 'error');
            }
        };

        if (popup.document.readyState === 'complete') {
            setTimeout(ready, 250);
        } else {
            popup.addEventListener('load', () => setTimeout(ready, 250), { once: true });
        }
    }

    function downloadText(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function exportAllConversations() {
        const data = {
            version: 2,
            exported_at: new Date().toISOString(),
            meta: buildExportMeta(),
            conversations: state.conversations,
        };
        downloadText(JSON.stringify(data, null, 2), `hackclub-ai-export-${Date.now()}.json`, 'application/json');
        showToast(`Exported ${state.conversations.length} conversations`, 'success');
    }

    function buildExportMeta() {
        const meta = {
            settings: { ...state.settings },
        };
        if (state.apiKeys.length) {
            meta.api_keys = state.apiKeys;
            meta.active_api_key_id = state.activeApiKeyId;
        }
        if (state.apiUsageByKey && Object.keys(state.apiUsageByKey).length) {
            meta.api_usage_by_key = state.apiUsageByKey;
        }
        return meta;
    }

    function applyImportedMeta(meta) {
        if (!meta || typeof meta !== 'object') return;

        if (Array.isArray(meta.api_keys)) {
            state.apiKeys = meta.api_keys.map(normalizeApiKeyRecord).filter(Boolean);
            state.activeApiKeyId = state.apiKeys.find(key => key.id === meta.active_api_key_id)?.id || state.apiKeys[0]?.id || null;
            saveApiKeys();
            renderApiKeysList();
            updateApiKeyFields();
            updateApiStatus();
            updateConnStatusDisplay();
        } else if (meta.api_key && typeof meta.api_key === 'string') {
            setApiKey(meta.api_key, 'Imported API Key');
        }

        if (meta.api_usage_by_key && typeof meta.api_usage_by_key === 'object' && !Array.isArray(meta.api_usage_by_key)) {
            state.apiUsageByKey = meta.api_usage_by_key;
            syncApiUsageState();
            updateSpendDisplays();
        }

        if (meta.settings && typeof meta.settings === 'object') {
            state.settings = { ...DEFAULT_SETTINGS, ...state.settings, ...meta.settings };
            saveSettings();
            loadSettingsIntoUI();
            updateApiStatus();
        }
    }

    function importConversations(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                let data = JSON.parse(ev.target.result);
                let convs;
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    applyImportedMeta(data.meta);
                }

                if (Array.isArray(data)) {
                    convs = data;
                } else if (data.conversation) {
                    convs = [data.conversation];
                } else if (data.conversations) {
                    convs = data.conversations;
                } else if (data.id && data.messages) {
                    convs = [data];
                } else {
                    throw new Error('Invalid format');
                }
                // Merge (skip duplicates by id)
                const existingIds = new Set(state.conversations.map(c => c.id));
                const newConvs = convs.filter(c => !existingIds.has(c.id));
                state.conversations = [...newConvs, ...state.conversations];
                saveConversations();
                renderSidebar();
                showToast(`Imported ${newConvs.length} conversations` + (data?.meta ? ' and imported settings' : ''), 'success');
            } catch (err) {
                showToast('Import failed: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    function sanitizeFilename(name) {
        return (name || 'conversation').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 19: TOAST SYSTEM
    // ─────────────────────────────────────────────────────────────────────────────

    function showToast(message, type = 'info') {
        const stack = document.getElementById('toast-stack');
        if (!stack) return;

        while (stack.children.length >= 3) stack.removeChild(stack.firstChild);

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
        toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${escapeHtml(message)}</span>`;
        stack.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            const handler = () => toast.remove();
            toast.addEventListener('animationend', handler, { once: true });
            setTimeout(handler, 300); // fallback
        }, 3500);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 20: KEYBOARD SHORTCUTS
    // ─────────────────────────────────────────────────────────────────────────────

    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            const tag = document.activeElement?.tagName?.toLowerCase();
            const inInput = tag === 'input' || tag === 'textarea';
            const ctrlOrMeta = e.ctrlKey || e.metaKey;

            // Escape — close modals / stop generation
            if (e.key === 'Escape') {
                if (state.isStreaming) { stopGeneration(); return; }
                if (state.commandPaletteOpen) { closeCommandPalette(); return; }
                if (!document.getElementById('settings-modal')?.classList.contains('hidden')) { closeSettings(); return; }
                if (!document.getElementById('lightbox')?.classList.contains('hidden')) { closeLightbox(); return; }
                if (!document.getElementById('confirm-dialog')?.classList.contains('hidden')) {
                    document.getElementById('confirm-dialog')?.classList.add('hidden'); return;
                }
                closeDropdowns();
                return;
            }

            if (ctrlOrMeta) {
                switch (e.key.toLowerCase()) {
                    case 'n':
                        if (!inInput) { e.preventDefault(); newConversation(); }
                        break;
                    case 'k':
                        e.preventDefault();
                        state.commandPaletteOpen ? closeCommandPalette() : openCommandPalette();
                        break;
                    case ',':
                        e.preventDefault();
                        openSettings();
                        break;
                    case 'l':
                        e.preventDefault();
                        clearChat();
                        break;
                    case '/':
                        e.preventDefault();
                        openSettings('shortcuts');
                        break;
                    case 't':
                        if (e.shiftKey) { e.preventDefault(); toggleThinking(); }
                        break;
                    case 'e':
                        if (e.shiftKey) { e.preventDefault(); exportChat('markdown-dl'); }
                        break;
                }
            }

            // ? key — shortcuts
            if (e.key === '?' && !inInput && !ctrlOrMeta) {
                openSettings('shortcuts');
            }
        });

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.dropdown') &&
                !e.target.closest('#model-selector-btn') &&
                !e.target.closest('#export-btn') &&
                !e.target.closest('.model-picker-btn')) {
                closeDropdowns();
            }
            // Close context menu
            if (!e.target.closest('#context-menu')) {
                removeContextMenu();
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 21: SCROLL MANAGEMENT
    // ─────────────────────────────────────────────────────────────────────────────

    function scrollToBottom(smooth = true) {
        const container = document.getElementById('messages-container');
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
    }

    function isNearBottom(threshold = 120) {
        const c = document.getElementById('messages-container');
        if (!c) return true;
        return c.scrollHeight - c.scrollTop - c.clientHeight < threshold;
    }

    function setupScrollHandler() {
        const c = document.getElementById('messages-container');
        const btn = document.getElementById('scroll-to-bottom-btn');
        if (!c || !btn) return;
        c.addEventListener('scroll', () => {
            btn.classList.toggle('hidden', isNearBottom(80));
        });
        btn.addEventListener('click', () => scrollToBottom());
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 22: LIGHTBOX & CONFIRM DIALOG
    // ─────────────────────────────────────────────────────────────────────────────

    function openLightbox(url) {
        const lb = document.getElementById('lightbox');
        const img = document.getElementById('lightbox-img');
        const dl = document.getElementById('lightbox-download');
        if (!lb || !img) return;
        img.src = url;
        if (dl) dl.href = url;
        lb.classList.remove('hidden');
    }

    function closeLightbox() {
        document.getElementById('lightbox')?.classList.add('hidden');
    }

    function showConfirm(message, onConfirm) {
        const dialog = document.getElementById('confirm-dialog');
        const msgEl = document.getElementById('confirm-message');
        if (!dialog || !msgEl) { if (confirm(message)) onConfirm(); return; }
        msgEl.textContent = message;
        dialog.classList.remove('hidden');
        const okBtn = document.getElementById('confirm-ok-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        const cleanup = () => dialog.classList.add('hidden');
        if (okBtn) {
            const newOk = okBtn.cloneNode(true);
            okBtn.parentNode.replaceChild(newOk, okBtn);
            newOk.addEventListener('click', () => { cleanup(); onConfirm(); }, { once: true });
        }
        if (cancelBtn) {
            const newCancel = cancelBtn.cloneNode(true);
            cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
            newCancel.addEventListener('click', cleanup, { once: true });
        }
    }

    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        state.commandPaletteOpen = false;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 23: UTILITY FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────────

    function relativeTime(ts) {
        const diff = Date.now() - ts;
        if (diff < 60_000) return 'just now';
        if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
        if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
        if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
        return new Date(ts).toLocaleDateString();
    }

    function formatPrice(p) {
        if (!p || p === '0') return 'Free';
        const n = parseFloat(p) * 1_000_000;
        return `$${n.toFixed(2)}`;
    }

    function debounce(fn, delay) {
        let t;
        return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // SECTION 24: INITIALIZATION
    // ─────────────────────────────────────────────────────────────────────────────

    function init() {
        loadSettings();
        loadConversations();

        setupMarked();
        setupKeyboardShortcuts();
        setupInputHandlers();
        setupScrollHandler();
        setupSettingsSliders();
        setupApiKeyTest();
        setupApiKeyToggle();
        setupModelSelectorBtn();
        setupExportDropdown();

        // Restore last active conversation
        const lastId = lsGet(LS.ACTIVE_CONV);
        if (lastId && state.conversations.find(c => c.id === lastId)) {
            state.activeConvId = lastId;
        } else if (state.conversations.length > 0) {
            state.activeConvId = state.conversations[0].id;
        }

        renderSidebar();
        renderMessages();
        updateHeaderForConversation();
        updateApiStatus();
        updateNoKeyBanner();

        // Fetch models async — don't block render
        fetchModels().then(() => {
            renderAllModelDropdowns();
            updateCapabilityButtons();
            updateDetailsPanel();
        }).catch(err => console.warn('Model fetch failed:', err));

        // ── Wire up static buttons ──

        document.getElementById('new-chat-btn')?.addEventListener('click', newConversation);

        document.getElementById('settings-btn')?.addEventListener('click', () => openSettings());

        document.getElementById('api-status')?.addEventListener('click', () => openSettings('api'));

        document.getElementById('thinking-btn')?.addEventListener('click', toggleThinking);

        document.getElementById('websearch-btn')?.addEventListener('click', toggleWebSearch);

        document.getElementById('clear-chat-btn')?.addEventListener('click', clearChat);

        document.getElementById('sidebar-toggle-btn')?.addEventListener('click', toggleSidebar);

        document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileSidebar);

        document.getElementById('details-toggle-btn')?.addEventListener('click', toggleDetailsPanel);

        document.getElementById('details-close-btn')?.addEventListener('click', toggleDetailsPanel);

        document.getElementById('settings-close-btn')?.addEventListener('click', closeSettings);

        document.getElementById('settings-save-btn')?.addEventListener('click', saveSettingsFromUI);

        document.getElementById('settings-modal')?.querySelector('.modal-backdrop')
            ?.addEventListener('click', closeSettings);

        document.getElementById('api-keys-list')?.addEventListener('change', e => {
            const radio = e.target.closest('input[name="active-api-key"]');
            if (radio) selectApiKey(radio.value);
        });

        document.getElementById('save-api-key-btn')?.addEventListener('click', () => {
            if (upsertApiKeyFromUI()) {
                showToast('API key saved', 'success');
            } else {
                showToast('Enter a name and API key first', 'warning');
            }
        });

        document.getElementById('add-api-key-btn')?.addEventListener('click', () => {
            if (addApiKeyFromUI()) {
                showToast('API key added', 'success');
            } else {
                showToast('Enter a name and API key first', 'warning');
            }
        });

        document.getElementById('api-key-name-input')?.addEventListener('input', renderApiKeysList);
        document.getElementById('api-key-input')?.addEventListener('input', renderApiKeysList);

        document.getElementById('reload-models-btn')?.addEventListener('click', () => {
            showToast('Reloading models…', 'info');
            fetchModels(true).then(() => {
                renderAllModelDropdowns();
                const mu = document.getElementById('models-last-updated');
                if (mu) mu.textContent = `Updated just now`;
                showToast('Models reloaded', 'success');
            }).catch(() => showToast('Failed to reload models', 'error'));
        });

        document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);

        document.getElementById('lightbox')?.querySelector('.modal-backdrop')
            ?.addEventListener('click', closeLightbox);

        document.getElementById('command-palette')?.querySelector('.modal-backdrop')
            ?.addEventListener('click', closeCommandPalette);

        document.getElementById('command-input')?.addEventListener('input',
            debounce(e => renderCommandResults(e.target.value), 100));

        document.getElementById('command-input')?.addEventListener('keydown', handleCommandPaletteNav);

        document.getElementById('sidebar-search')?.addEventListener('input',
            debounce(() => renderSidebar(), 200));

        // Export dropdown
        document.getElementById('export-dropdown')?.addEventListener('click', e => {
            const fmt = e.target.dataset.export;
            if (fmt) { exportChat(fmt); closeDropdowns(); }
        });

        // Settings tab switching
        document.getElementById('settings-nav')?.addEventListener('click', e => {
            const tab = e.target.closest('[data-tab]');
            if (tab) switchSettingsTab(tab.dataset.tab);
        });

        // Suggestion cards
        document.getElementById('suggestion-grid')?.addEventListener('click', e => {
            const card = e.target.closest('.suggestion-card');
            if (card) {
                const input = document.getElementById('message-input');
                if (input) {
                    input.value = card.dataset.prompt || '';
                    input.dispatchEvent(new Event('input'));
                }
                handleSend();
            }
        });

        // Chat title rename
        document.getElementById('chat-title-display')?.addEventListener('click', startTitleEdit);

        // Copy code buttons (event delegation)
        document.getElementById('messages-container')?.addEventListener('click', e => {
            const btn = e.target.closest('.copy-code-btn');
            if (btn) {
                const encoded = btn.dataset.code;
                let text;
                try { text = decodeURIComponent(escape(atob(encoded))); }
                catch { try { text = atob(encoded); } catch { text = encoded; } }
                navigator.clipboard.writeText(text).then(() => {
                    btn.textContent = 'Copied!';
                    btn.classList.add('copied');
                    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
                }).catch(() => showToast('Copy failed', 'error'));
            }
        });

        // Data tab buttons
        document.getElementById('export-all-btn')?.addEventListener('click', exportAllConversations);

        document.getElementById('import-btn')?.addEventListener('click', () =>
            document.getElementById('import-file-input')?.click());

        document.getElementById('import-file-input')?.addEventListener('change', importConversations);

        document.getElementById('clear-all-convs-btn')?.addEventListener('click', () =>
            showConfirm('Delete ALL conversations? This cannot be undone.', clearAllConversations));

        document.getElementById('reset-usage-btn')?.addEventListener('click', () => {
            showConfirm('Reset today\'s usage for the active API key?', () => {
                if (resetActiveKeyUsage()) {
                    showToast('Usage reset for today', 'success');
                } else {
                    showToast('No active API key selected', 'warning');
                }
            });
        });

        document.getElementById('set-usage-btn')?.addEventListener('click', () => {
            const usageInput = document.getElementById('api-usage-input');
            if (setActiveKeyUsageTotal(usageInput?.value)) {
                showToast('Usage updated', 'success');
            } else {
                showToast('Enter a valid usage amount', 'warning');
            }
        });

        document.getElementById('add-usage-btn')?.addEventListener('click', () => {
            const usageInput = document.getElementById('api-usage-input');
            if (addActiveKeyUsageAmount(usageInput?.value)) {
                showToast('Usage added', 'success');
            } else {
                showToast('Enter a valid usage amount', 'warning');
            }
        });

        document.getElementById('api-usage-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('set-usage-btn')?.click();
            }
        });

        document.getElementById('clear-api-key-btn')?.addEventListener('click', () =>
            showConfirm('Remove the selected API key?', () => {
                const active = getActiveApiKeyRecord();
                if (active && state.apiUsageByKey[active.id]) {
                    delete state.apiUsageByKey[active.id];
                    saveApiUsage();
                }
                removeActiveApiKey();
                updateApiStatus();
                showToast('API key removed', 'info');
            }));

        // Thinking default toggle initial state
        if (state.settings.thinking_mode) {
            state.thinkingActive = true;
            const btn = document.getElementById('thinking-btn');
            if (btn) btn.dataset.active = 'true';
        }

        // Focus input
        setTimeout(() => document.getElementById('message-input')?.focus(), 100);
    }

    // ── Start the app when DOM is ready ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();