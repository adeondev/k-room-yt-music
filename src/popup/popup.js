(function () {
    'use strict';

    const { Presets } = self.YTMS;
    const LIMITS = Presets.LIMITS;

    const elements = {
        app: document.querySelector('.app'),
        enabled: document.getElementById('enabled-toggle'),
        langSelect: document.getElementById('lang-select'),
        presets: document.getElementById('presets'),
        presetDescription: document.getElementById('preset-description'),
        eqPresets: document.getElementById('eq-presets'),
        ratio: document.getElementById('ratio'),
        ratioOutput: document.getElementById('ratio-output'),
        makeup: document.getElementById('makeup'),
        makeupOutput: document.getElementById('makeup-output'),
        advancedToggle: document.getElementById('advanced-toggle'),
        advanced: document.getElementById('advanced'),
        threshold: document.getElementById('threshold'),
        thresholdOutput: document.getElementById('threshold-output'),
        knee: document.getElementById('knee'),
        kneeOutput: document.getElementById('knee-output'),
        attack: document.getElementById('attack'),
        attackOutput: document.getElementById('attack-output'),
        release: document.getElementById('release'),
        releaseOutput: document.getElementById('release-output'),
        limiterThreshold: document.getElementById('limiter-threshold'),
        limiterThresholdOutput: document.getElementById('limiter-threshold-output'),
        limiterEnabled: document.getElementById('limiter-enabled'),
        highpassEnabled: document.getElementById('highpass-enabled'),
        highpassFrequency: document.getElementById('highpass-frequency'),
        highpassFrequencyOutput: document.getElementById('highpass-frequency-output'),
        meterCompressor: document.getElementById('meter-compressor'),
        meterCompressorValue: document.getElementById('meter-compressor-value'),
        meterLimiter: document.getElementById('meter-limiter'),
        meterLimiterValue: document.getElementById('meter-limiter-value'),
        meterAutoGainBoost: document.getElementById('meter-autogain-boost'),
        meterAutoGainCut: document.getElementById('meter-autogain-cut'),
        meterAutoGainValue: document.getElementById('meter-autogain-value'),
        adaptiveMeter: document.getElementById('adaptive-meter'),
        meterCrest: document.getElementById('meter-crest'),
        meterCrestValue: document.getElementById('meter-crest-value'),
        adaptiveHint: document.getElementById('adaptive-hint'),
        autoGainEnabled: document.getElementById('autogain-enabled'),
        autoGainTarget: document.getElementById('autogain-target'),
        autoGainTargetOutput: document.getElementById('autogain-target-output'),
        autoGainBoost: document.getElementById('autogain-boost'),
        autoGainBoostOutput: document.getElementById('autogain-boost-output'),
        autoGainCut: document.getElementById('autogain-cut'),
        autoGainCutOutput: document.getElementById('autogain-cut-output'),
        autoGainResponse: document.getElementById('autogain-response'),
        autoGainResponseOutput: document.getElementById('autogain-response-output'),
        reset: document.getElementById('reset-btn'),
        versionLabel: document.getElementById('version-label'),
        mediaPrev: document.getElementById('media-prev'),
        mediaPlayPause: document.getElementById('media-play-pause'),
        mediaNext: document.getElementById('media-next'),
        mediaTimeCurrent: document.getElementById('media-time-current'),
        mediaTimeRemaining: document.getElementById('media-time-remaining'),
        mediaProgress: document.getElementById('media-progress'),
        scanBadge: document.getElementById('scan-badge'),
        mediaTrackInfo: document.getElementById('media-track-info'),
        mediaArtwork: document.getElementById('media-artwork'),
        mediaTitle: document.getElementById('media-title'),
        mediaArtist: document.getElementById('media-artist')
    };

    let state = null;
    let metersTimer = null;
    let activeTabId = null;
    let updateQueue = Promise.resolve();
    let currentLang = 'pt-BR';
    let i18nData = {};
    let isSeeking = false;

    const EQ_GRAPH = (() => {
        const BANDS = Presets.EQ_BANDS;
        const LABELS = ['60', '250', '1K', '4K', '12K'];
        const DB_MIN = -12, DB_MAX = 12, PR = 7;
        const P = { l: 30, r: 10, t: 14, b: 22 };
        let cv, cx, W, H, gains = [0,0,0,0,0], drag = -1, changeFn = null;

        function ar() { return { x: P.l, y: P.t, w: W - P.l - P.r, h: H - P.t - P.b }; }
        function fX(f) { const a = ar(); return a.x + (Math.log10(f) - Math.log10(BANDS[0])) / (Math.log10(BANDS[4]) - Math.log10(BANDS[0])) * a.w; }
        function gY(db) { const a = ar(); return a.y + (DB_MAX - db) / (DB_MAX - DB_MIN) * a.h; }
        function yG(y) { const a = ar(); return DB_MAX - (y - a.y) / a.h * (DB_MAX - DB_MIN); }
        function pts() { return BANDS.map((f, i) => ({ x: fX(f), y: gY(gains[i]) })); }

        function spline(ctx, all) {
            ctx.moveTo(all[0].x, all[0].y);
            for (let i = 0; i < all.length - 1; i++) {
                const c0 = all[Math.max(0, i-1)], c1 = all[i], c2 = all[i+1], c3 = all[Math.min(all.length-1, i+2)];
                ctx.bezierCurveTo(
                    c1.x + (c2.x - c0.x) / 3, c1.y + (c2.y - c0.y) / 3,
                    c2.x - (c3.x - c1.x) / 3, c2.y - (c3.y - c1.y) / 3,
                    c2.x, c2.y
                );
            }
        }

        function draw() {
            if (!cx) return;
            cx.clearRect(0, 0, W, H);
            const a = ar();
            cx.fillStyle = '#141414'; cx.fillRect(0, 0, W, H);

            [-12, -6, 0, 6, 12].forEach(db => {
                const y = gY(db);
                cx.beginPath(); cx.moveTo(a.x, y); cx.lineTo(a.x + a.w, y);
                cx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
                cx.lineWidth = 1; cx.stroke();
            });
            cx.strokeStyle = 'rgba(255,255,255,0.06)';
            BANDS.forEach(f => { const x = fX(f); cx.beginPath(); cx.moveTo(x, a.y); cx.lineTo(x, a.y + a.h); cx.stroke(); });

            cx.font = '9px system-ui,sans-serif'; cx.textAlign = 'right'; cx.textBaseline = 'middle';
            [-12, -6, 6, 12].forEach(db => { cx.fillStyle = 'rgba(255,255,255,0.3)'; cx.fillText((db > 0 ? '+' : '') + db, a.x - 4, gY(db)); });
            cx.fillStyle = 'rgba(255,255,255,0.5)'; cx.fillText('0', a.x - 4, gY(0));
            cx.textAlign = 'center'; cx.textBaseline = 'top'; cx.fillStyle = 'rgba(255,255,255,0.3)';
            BANDS.forEach((f, i) => cx.fillText(LABELS[i], fX(f), a.y + a.h + 6));

            const p = pts();
            const all = [{ x: a.x - 10, y: p[0].y }, ...p, { x: a.x + a.w + 10, y: p[4].y }];
            const zY = gY(0);

            cx.beginPath(); spline(cx, all);
            cx.lineTo(a.x + a.w + 10, zY); cx.lineTo(a.x - 10, zY); cx.closePath();
            const gr = cx.createLinearGradient(0, a.y, 0, a.y + a.h);
            gr.addColorStop(0, 'rgba(255,0,51,0.18)'); gr.addColorStop(0.5, 'rgba(255,0,51,0.04)'); gr.addColorStop(1, 'rgba(255,0,51,0.18)');
            cx.fillStyle = gr; cx.fill();

            cx.beginPath(); spline(cx, all);
            cx.strokeStyle = '#ff0033'; cx.lineWidth = 2; cx.stroke();

            p.forEach((pt, i) => {
                cx.beginPath(); cx.arc(pt.x, pt.y, PR, 0, Math.PI * 2);
                cx.fillStyle = drag === i ? '#ff3366' : '#ff0033'; cx.fill();
                cx.strokeStyle = '#fff'; cx.lineWidth = 2; cx.stroke();
                if (drag === i) {
                    cx.fillStyle = '#fff'; cx.font = 'bold 10px system-ui,sans-serif';
                    cx.textAlign = 'center'; cx.textBaseline = 'bottom';
                    cx.fillText((gains[i] >= 0 ? '+' : '') + gains[i].toFixed(1) + ' dB', pt.x, pt.y - PR - 4);
                }
            });
        }

        function hit(mx, my) {
            const p = pts();
            for (let i = 0; i < p.length; i++) { const dx = mx - p[i].x, dy = my - p[i].y; if (dx*dx + dy*dy <= (PR+5)*(PR+5)) return i; }
            return -1;
        }
        function mpos(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
        function clmp(y) { return Math.max(DB_MIN, Math.min(DB_MAX, Math.round(yG(y) * 2) / 2)); }

        return {
            get dragging() { return drag; },
            set onChange(fn) { changeFn = fn; },
            init() {
                cv = document.getElementById('eq-graph');
                if (!cv) return;
                cx = cv.getContext('2d');
                const dpr = window.devicePixelRatio || 1;
                const rect = cv.parentElement.getBoundingClientRect();
                W = Math.floor(rect.width); H = 140;
                cv.width = W * dpr; cv.height = H * dpr;
                cv.style.width = W + 'px'; cv.style.height = H + 'px';
                cx.setTransform(dpr, 0, 0, dpr, 0, 0);

                cv.addEventListener('mousedown', e => { const p = mpos(e), h = hit(p.x, p.y); if (h >= 0) { drag = h; cv.style.cursor = 'grabbing'; draw(); } });
                cv.addEventListener('mousemove', e => {
                    const p = mpos(e);
                    if (drag >= 0) { gains[drag] = clmp(p.y); draw(); if (changeFn) changeFn(gains); }
                    else { cv.style.cursor = hit(p.x, p.y) >= 0 ? 'grab' : 'default'; }
                });
                const up = () => { if (drag >= 0) { drag = -1; cv.style.cursor = 'default'; draw(); } };
                window.addEventListener('mouseup', up);
                cv.addEventListener('touchstart', e => { e.preventDefault(); const p = mpos(e.touches[0]), h = hit(p.x, p.y); if (h >= 0) { drag = h; draw(); } }, { passive: false });
                cv.addEventListener('touchmove', e => { e.preventDefault(); if (drag >= 0) { gains[drag] = clmp(mpos(e.touches[0]).y); draw(); if (changeFn) changeFn(gains); } }, { passive: false });
                window.addEventListener('touchend', up);
                draw();
            },
            setGains(g) { gains = g.map(v => Number(v) || 0); draw(); },
            getGains() { return [...gains]; },
            draw
        };
    })();

    function formatTime(s) {
        if (!isFinite(s) || isNaN(s)) return '0:00';
        s = Math.max(0, s);
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + sec.toString().padStart(2, '0');
    }

    function updateProgressFill(el) {
        if (!el) return;
        const val = parseFloat(el.value) || 0;
        const max = parseFloat(el.max) || 100;
        const p = max > 0 ? (val / max) * 100 : 0;
        el.style.background = `linear-gradient(to right, #ff0033 0%, #ff0033 ${p}%, #3a3a3a ${p}%, #3a3a3a 100%)`;
    }

    async function loadTranslations() {
        try {
            const stored = await chrome.storage.local.get('ytms_lang');
            currentLang = stored.ytms_lang || 'pt-BR';
            const res = await fetch('../locales/locales.json');
            const locales = await res.json();
            i18nData = locales[currentLang] || locales['pt-BR'];
            
            if (elements.langSelect) {
                elements.langSelect.value = currentLang;
            }
            
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.getAttribute('data-i18n');
                if (i18nData[key]) {
                    if (el.tagName === 'TITLE') {
                        // skip
                    } else {
                        el.textContent = i18nData[key];
                    }
                }
            });
            
            if(i18nData.appTitle) document.title = i18nData.appTitle + " Volume Stabilizer";
            if(i18nData.toggleTitle && elements.enabled.parentElement) {
                elements.enabled.parentElement.title = i18nData.toggleTitle;
            }
        } catch (e) {
            console.error("Failed to load translations", e);
        }
    }

    function setRange(input, range) {
        input.min = range.min;
        input.max = range.max;
        input.step = range.step;
    }

    function configureRanges() {
        setRange(elements.ratio, LIMITS.ratio);
        setRange(elements.makeup, LIMITS.makeupGain);
        setRange(elements.threshold, LIMITS.threshold);
        setRange(elements.knee, LIMITS.knee);
        setRange(elements.attack, { min: 0, max: 500, step: 1 });
        setRange(elements.release, { min: 0, max: 2000, step: 10 });
        setRange(elements.limiterThreshold, LIMITS.limiterThreshold);
        setRange(elements.highpassFrequency, LIMITS.highpassFrequency);
        setRange(elements.autoGainTarget, LIMITS.autoGainTarget);
        setRange(elements.autoGainBoost, LIMITS.autoGainBoost);
        setRange(elements.autoGainCut, LIMITS.autoGainCut);
        setRange(elements.autoGainResponse, LIMITS.autoGainResponse);
    }

    function renderPresets(activeId) {
        elements.presets.innerHTML = '';
        Object.values(Presets.ALL).forEach((preset) => {
            const btn = document.createElement('button');
            btn.className = 'preset';
            btn.type = 'button';
            const lblKey = 'preset_' + preset.id + '_label';
            const descKey = 'preset_' + preset.id + '_desc';
            btn.textContent = i18nData[lblKey] || preset.label;
            btn.dataset.preset = preset.id;
            btn.setAttribute('aria-pressed', preset.id === activeId ? 'true' : 'false');
            btn.title = i18nData[descKey] || preset.description;
            btn.addEventListener('click', () => applyPreset(preset.id));
            elements.presets.appendChild(btn);
        });
    }

    function renderEqPresets() {
        if (!elements.eqPresets || !Presets.EQ_PRESETS) return;
        elements.eqPresets.innerHTML = '';
        Object.values(Presets.EQ_PRESETS).forEach((eq) => {
            const btn = document.createElement('button');
            btn.className = 'eq-preset';
            btn.type = 'button';
            const lblKey = 'eq_' + eq.id + '_label';
            btn.textContent = i18nData[lblKey] || eq.label;
            btn.dataset.eq = eq.id;
            btn.setAttribute('aria-pressed', 'false');
            btn.addEventListener('click', () => applyEqPreset(eq.id));
            elements.eqPresets.appendChild(btn);
        });
    }

    function findMatchingPreset(settings) {
        for (const preset of Object.values(Presets.ALL)) {
            if (deepEqualSettings(preset, settings)) return preset.id;
        }
        return null;
    }

    function deepEqualSettings(a, b) {
        return (
            a.enabled === b.enabled &&
            a.highpass.enabled === b.highpass.enabled &&
            a.highpass.frequency === b.highpass.frequency &&
            a.compressor.threshold === b.compressor.threshold &&
            a.compressor.knee === b.compressor.knee &&
            a.compressor.ratio === b.compressor.ratio &&
            a.compressor.attack === b.compressor.attack &&
            a.compressor.release === b.compressor.release &&
            a.makeupGain === b.makeupGain &&
            a.limiter.enabled === b.limiter.enabled &&
            a.limiter.threshold === b.limiter.threshold &&
            a.limiter.ratio === b.limiter.ratio &&
            a.autoGain.enabled === b.autoGain.enabled &&
            a.autoGain.targetDb === b.autoGain.targetDb &&
            a.autoGain.maxBoostDb === b.autoGain.maxBoostDb &&
            a.autoGain.maxCutDb === b.autoGain.maxCutDb &&
            a.autoGain.responseMs === b.autoGain.responseMs &&
            ((a.autoGain.mode) || 'realtime') === ((b.autoGain.mode) || 'realtime') &&
            a.adaptive.enabled === b.adaptive.enabled &&
            a.adaptive.headroomDb === b.adaptive.headroomDb &&
            a.adaptive.minRatio === b.adaptive.minRatio &&
            a.adaptive.maxRatio === b.adaptive.maxRatio &&
            ((a.eq && a.eq.id) || 'flat') === ((b.eq && b.eq.id) || 'flat')
        );
    }

    function format(value, digits = 2) {
        return Number(value).toFixed(digits);
    }

    function renderFromState() {
        if (!state) return;

        elements.enabled.checked = state.enabled !== false;
        elements.app.classList.toggle('is-disabled', state.enabled === false);

        elements.ratio.value = state.compressor.ratio;
        elements.ratioOutput.textContent = `${format(state.compressor.ratio, 1)} : 1`;

        elements.makeup.value = state.makeupGain;
        elements.makeupOutput.textContent = `${format(state.makeupGain, 2)}×`;

        elements.threshold.value = state.compressor.threshold;
        elements.thresholdOutput.textContent = `${format(state.compressor.threshold, 1)} dB`;

        elements.knee.value = state.compressor.knee;
        elements.kneeOutput.textContent = `${format(state.compressor.knee, 1)}`;

        elements.attack.value = Math.round(state.compressor.attack * 1000);
        elements.attackOutput.textContent = `${elements.attack.value} ms`;

        elements.release.value = Math.round(state.compressor.release * 1000);
        elements.releaseOutput.textContent = `${elements.release.value} ms`;

        elements.limiterEnabled.checked = state.limiter.enabled;
        elements.limiterThreshold.value = state.limiter.threshold;
        elements.limiterThresholdOutput.textContent = `${format(state.limiter.threshold, 1)} dB`;
        elements.limiterThreshold.disabled = !state.limiter.enabled;

        elements.highpassEnabled.checked = state.highpass.enabled;
        elements.highpassFrequency.value = state.highpass.frequency;
        elements.highpassFrequencyOutput.textContent = `${Math.round(state.highpass.frequency)} Hz`;
        elements.highpassFrequency.disabled = !state.highpass.enabled;

        elements.autoGainEnabled.checked = state.autoGain.enabled;
        elements.autoGainTarget.value = state.autoGain.targetDb;
        elements.autoGainTargetOutput.textContent = `${format(state.autoGain.targetDb, 1)} dB`;
        elements.autoGainTarget.disabled = !state.autoGain.enabled;

        elements.autoGainBoost.value = state.autoGain.maxBoostDb;
        elements.autoGainBoostOutput.textContent = `+${format(state.autoGain.maxBoostDb, 1)} dB`;
        elements.autoGainBoost.disabled = !state.autoGain.enabled;

        elements.autoGainCut.value = state.autoGain.maxCutDb;
        elements.autoGainCutOutput.textContent = `−${format(state.autoGain.maxCutDb, 1)} dB`;
        elements.autoGainCut.disabled = !state.autoGain.enabled;

        elements.autoGainResponse.value = state.autoGain.responseMs;
        elements.autoGainResponseOutput.textContent = `${Math.round(state.autoGain.responseMs)} ms`;
        elements.autoGainResponse.disabled = !state.autoGain.enabled;

        const adaptiveOn = !!(state.adaptive && state.adaptive.enabled);
        elements.adaptiveMeter.hidden = !adaptiveOn;
        elements.adaptiveHint.hidden = !adaptiveOn;
        if (adaptiveOn) {
            elements.adaptiveHint.textContent = i18nData.hintSmartActive || 'Modo Inteligente ativo: compressão se adapta ao perfil da música.';
        }
        elements.ratio.disabled = adaptiveOn;
        elements.threshold.disabled = adaptiveOn;

        const matched = findMatchingPreset(state);
        document.querySelectorAll('.preset').forEach((btn) => {
            btn.setAttribute(
                'aria-pressed',
                btn.dataset.preset === matched ? 'true' : 'false'
            );
        });

        const activeEq = (state.eq && state.eq.id) || (Presets.DEFAULT_EQ_ID || 'flat');
        document.querySelectorAll('.eq-preset').forEach((btn) => {
            btn.setAttribute(
                'aria-pressed',
                btn.dataset.eq === activeEq ? 'true' : 'false'
            );
        });

        if (matched && Presets.ALL[matched]) {
            const descKey = 'preset_' + matched + '_desc';
            elements.presetDescription.textContent = i18nData[descKey] || Presets.ALL[matched].description;
        } else {
            elements.presetDescription.textContent = i18nData.hintCustomPreset || 'Configuração personalizada.';
        }

        if (EQ_GRAPH.dragging < 0) {
            let eqGains;
            if (state.eq && Array.isArray(state.eq.gains)) {
                eqGains = state.eq.gains;
            } else {
                const p = Presets.EQ_PRESETS[(state.eq && state.eq.id) || 'flat'];
                eqGains = p ? [...p.gains] : [0, 0, 0, 0, 0];
            }
            EQ_GRAPH.setGains(eqGains);
        }
    }

    async function getActiveYtmTab() {
        const tabs = await chrome.tabs.query({
            url: '*://music.youtube.com/*',
            active: true,
            currentWindow: true
        });
        if (tabs.length > 0) return tabs[0];
        const anyTab = await chrome.tabs.query({ url: '*://music.youtube.com/*' });
        return anyTab[0] || null;
    }

    function sendMessage(message) {
        return new Promise((resolve) => {
            if (activeTabId == null) {
                resolve(null);
                return;
            }
            try {
                chrome.tabs.sendMessage(activeTabId, message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(null);
                        return;
                    }
                    resolve(response || null);
                });
            } catch (_) {
                resolve(null);
            }
        });
    }

    async function initialize() {
        await loadTranslations();
        configureRanges();
        renderPresets(Presets.DEFAULT_PRESET_ID);
        renderEqPresets();
        EQ_GRAPH.init();
        EQ_GRAPH.onChange = (gains) => {
            state.eq = { id: 'custom', gains: [...gains] };
            document.querySelectorAll('.eq-preset').forEach(b => b.setAttribute('aria-pressed', 'false'));
            enqueuePersist();
        };
        elements.versionLabel.textContent =
            'v' + (chrome.runtime.getManifest().version || '—');

        const tab = await getActiveYtmTab();
        if (!tab) {
            state = Presets.clone(Presets.DEFAULT_PRESET_ID);
            renderFromState();
            loadFromStorageFallback();
            return;
        }
        activeTabId = tab.id;

        const response = await sendMessage({ type: 'YTMS_GET_STATE' });
        if (!response || !response.settings) {
            loadFromStorageFallback();
            return;
        }

        state = Presets.clamp(response.settings);
        renderFromState();
        startMetersPolling();
    }

    async function loadFromStorageFallback() {
        try {
            const data = await chrome.storage.local.get(Presets.STORAGE_KEY);
            state = data[Presets.STORAGE_KEY]
                ? Presets.clamp(data[Presets.STORAGE_KEY])
                : Presets.clone(Presets.DEFAULT_PRESET_ID);
        } catch (_) {
            state = Presets.clone(Presets.DEFAULT_PRESET_ID);
        }
        renderFromState();
    }

    function enqueuePersist() {
        updateQueue = updateQueue.then(async () => {
            renderFromState();
            if (activeTabId != null) {
                await sendMessage({ type: 'YTMS_SET_SETTINGS', settings: state });
            } else {
                await chrome.storage.local.set({ [Presets.STORAGE_KEY]: state });
            }
        });
    }

    function bindControlEvents() {
        if (elements.langSelect) {
            elements.langSelect.addEventListener('change', async (e) => {
                await chrome.storage.local.set({ ytms_lang: e.target.value });
                location.reload();
            });
        }

        elements.enabled.addEventListener('change', () => {
            state.enabled = elements.enabled.checked;
            enqueuePersist();
        });

        elements.ratio.addEventListener('input', () => {
            state.compressor.ratio = Number(elements.ratio.value);
            enqueuePersist();
        });

        elements.makeup.addEventListener('input', () => {
            state.makeupGain = Number(elements.makeup.value);
            enqueuePersist();
        });

        elements.threshold.addEventListener('input', () => {
            state.compressor.threshold = Number(elements.threshold.value);
            enqueuePersist();
        });

        elements.knee.addEventListener('input', () => {
            state.compressor.knee = Number(elements.knee.value);
            enqueuePersist();
        });

        elements.attack.addEventListener('input', () => {
            state.compressor.attack = Number(elements.attack.value) / 1000;
            enqueuePersist();
        });

        elements.release.addEventListener('input', () => {
            state.compressor.release = Number(elements.release.value) / 1000;
            enqueuePersist();
        });

        elements.limiterEnabled.addEventListener('change', () => {
            state.limiter.enabled = elements.limiterEnabled.checked;
            enqueuePersist();
        });

        elements.limiterThreshold.addEventListener('input', () => {
            state.limiter.threshold = Number(elements.limiterThreshold.value);
            enqueuePersist();
        });

        elements.highpassEnabled.addEventListener('change', () => {
            state.highpass.enabled = elements.highpassEnabled.checked;
            enqueuePersist();
        });

        elements.highpassFrequency.addEventListener('input', () => {
            state.highpass.frequency = Number(elements.highpassFrequency.value);
            enqueuePersist();
        });

        elements.autoGainEnabled.addEventListener('change', () => {
            state.autoGain.enabled = elements.autoGainEnabled.checked;
            enqueuePersist();
        });

        elements.autoGainTarget.addEventListener('input', () => {
            state.autoGain.targetDb = Number(elements.autoGainTarget.value);
            enqueuePersist();
        });

        elements.autoGainBoost.addEventListener('input', () => {
            state.autoGain.maxBoostDb = Number(elements.autoGainBoost.value);
            enqueuePersist();
        });

        elements.autoGainCut.addEventListener('input', () => {
            state.autoGain.maxCutDb = Number(elements.autoGainCut.value);
            enqueuePersist();
        });

        elements.autoGainResponse.addEventListener('input', () => {
            state.autoGain.responseMs = Number(elements.autoGainResponse.value);
            enqueuePersist();
        });

        elements.advancedToggle.addEventListener('click', () => {
            const expanded =
                elements.advancedToggle.getAttribute('aria-expanded') === 'true';
            elements.advancedToggle.setAttribute('aria-expanded', String(!expanded));
            elements.advanced.hidden = expanded;
        });

        elements.reset.addEventListener('click', async () => {
            state = Presets.clone(Presets.DEFAULT_PRESET_ID);
            renderFromState();
            if (activeTabId != null) {
                await sendMessage({ type: 'YTMS_RESET' });
            } else {
                await chrome.storage.local.set({ [Presets.STORAGE_KEY]: state });
            }
        });

        if (elements.mediaPrev) {
            elements.mediaPrev.addEventListener('click', async () => {
                if (activeTabId != null) await sendMessage({ type: 'YTMS_MEDIA_CONTROL', action: 'prev' });
            });
        }
        if (elements.mediaPlayPause) {
            elements.mediaPlayPause.addEventListener('click', async () => {
                if (activeTabId != null) await sendMessage({ type: 'YTMS_MEDIA_CONTROL', action: 'play-pause' });
            });
        }
        if (elements.mediaNext) {
            elements.mediaNext.addEventListener('click', async () => {
                if (activeTabId != null) await sendMessage({ type: 'YTMS_MEDIA_CONTROL', action: 'next' });
            });
        }
        
        if (elements.mediaProgress) {
            elements.mediaProgress.addEventListener('input', (e) => {
                isSeeking = true;
                const val = parseFloat(e.target.value);
                const max = parseFloat(e.target.max);
                elements.mediaTimeCurrent.textContent = formatTime(val);
                elements.mediaTimeRemaining.textContent = '-' + formatTime(max - val);
                updateProgressFill(e.target);
            });
            elements.mediaProgress.addEventListener('change', async (e) => {
                isSeeking = false;
                if (activeTabId != null) {
                    await sendMessage({ type: 'YTMS_MEDIA_SEEK', time: parseFloat(e.target.value) });
                }
            });
        }
    }

    async function applyPreset(presetId) {
        state = Presets.clone(presetId);
        renderFromState();
        if (activeTabId != null) {
            await sendMessage({ type: 'YTMS_APPLY_PRESET', presetId });
        } else {
            await chrome.storage.local.set({ [Presets.STORAGE_KEY]: state });
        }
    }

    async function applyEqPreset(eqId) {
        if (!state) return;
        const preset = Presets.EQ_PRESETS[eqId];
        const gains = preset ? [...preset.gains] : [0, 0, 0, 0, 0];
        state.eq = { id: eqId, gains };
        renderFromState();
        enqueuePersist();
    }

    function startMetersPolling() {
        stopMetersPolling();
        metersTimer = setInterval(async () => {
            const meters = await sendMessage({ type: 'YTMS_GET_METERS' });
            if (!meters) return;
            updateMeter(elements.meterCompressor, elements.meterCompressorValue, meters.compressor);
            updateMeter(elements.meterLimiter, elements.meterLimiterValue, meters.limiter);
            updateBipolarMeter(meters.autoGainDb || 0);
            updateCrestMeter(meters.crestDb || 0, meters.adaptiveRatio || 0);
            
            if (meters.scanPhase !== undefined && elements.scanBadge) {
                if (meters.scanPhase === 'scanning') {
                    elements.scanBadge.className = 'scan-badge scan-badge--scanning';
                    elements.scanBadge.textContent = i18nData.badgeScanning || '⏳ SCANNING';
                } else if (meters.scanPhase === 'locked') {
                    elements.scanBadge.className = 'scan-badge scan-badge--locked';
                    elements.scanBadge.textContent = i18nData.badgeLocked || '🔒 LOCKED';
                } else {
                    elements.scanBadge.className = 'scan-badge scan-badge--hidden';
                }
            }

            if (meters.metadata && elements.mediaTrackInfo) {
                const { title, artist, artwork } = meters.metadata;
                if (title || artist) {
                    elements.mediaTrackInfo.style.display = 'flex';
                    elements.mediaTitle.textContent = title || '';
                    elements.mediaArtist.textContent = artist || '';
                    if (artwork) {
                        elements.mediaArtwork.src = artwork;
                        elements.mediaArtwork.style.display = 'block';
                    } else {
                        elements.mediaArtwork.style.display = 'none';
                    }
                } else {
                    elements.mediaTrackInfo.style.display = 'none';
                }
            }
            
            if (meters.currentTime !== undefined && meters.duration !== undefined &&
                isFinite(meters.duration) && meters.duration > 0) {
                const ct = Math.min(meters.currentTime, meters.duration);
                if (!isSeeking && elements.mediaProgress) {
                    elements.mediaProgress.max = meters.duration;
                    elements.mediaProgress.value = ct;
                    elements.mediaTimeCurrent.textContent = formatTime(ct);
                    elements.mediaTimeRemaining.textContent = '-' + formatTime(meters.duration - ct);
                    updateProgressFill(elements.mediaProgress);
                }
            }

            if (elements.scanBadge) {
                const phase = meters.scanPhase;
                const isScanMode = state && state.autoGain && state.autoGain.mode === 'scan';
                if (isScanMode && (phase === 'scanning' || phase === 'locked')) {
                    elements.scanBadge.hidden = false;
                    elements.scanBadge.className = 'scan-badge ' +
                        (phase === 'locked' ? 'scan-badge--locked' : 'scan-badge--scanning');
                    elements.scanBadge.textContent = phase === 'locked'
                        ? ('🔒 ' + (i18nData.scanPhaseLocked || 'Locked'))
                        : ('🔍 ' + (i18nData.scanPhaseScanning || 'Scanning...'));
                } else {
                    elements.scanBadge.hidden = true;
                }
            }
        }, 120);
    }

    function updateCrestMeter(crestDb, ratio) {
        if (!state || !state.adaptive || !state.adaptive.enabled) return;
        const percent = Math.min(100, (crestDb / 24) * 100);
        elements.meterCrest.style.width = `${percent}%`;

        let label = '';
        if (crestDb < 8) label = i18nData.dynCrushed || 'esmagada';
        else if (crestDb < 14) label = i18nData.dynBalanced || 'equilibrada';
        else label = i18nData.dynDynamic || 'dinâmica';

        const ratioText = ratio > 0 ? ` · ratio ${format(ratio, 1)}:1` : '';
        elements.meterCrestValue.textContent = `${format(crestDb, 1)} dB · ${label}`;
        elements.adaptiveHint.textContent =
            `${i18nData.hintSmartTrack || 'Modo Inteligente: faixa'} ${label}${ratioText}`;
    }

    function updateBipolarMeter(gainDb) {
        const maxRange = 12;
        const clamped = Math.max(-maxRange, Math.min(maxRange, gainDb));
        const percent = (Math.abs(clamped) / maxRange) * 50;
        if (clamped >= 0) {
            elements.meterAutoGainBoost.style.width = `${percent}%`;
            elements.meterAutoGainCut.style.width = '0%';
        } else {
            elements.meterAutoGainCut.style.width = `${percent}%`;
            elements.meterAutoGainBoost.style.width = '0%';
        }
        const sign = clamped >= 0 ? '+' : '';
        elements.meterAutoGainValue.textContent = `${sign}${format(clamped, 1)} dB`;
    }

    function stopMetersPolling() {
        if (metersTimer) {
            clearInterval(metersTimer);
            metersTimer = null;
        }
    }

    function updateMeter(barEl, outEl, reductionDb) {
        const clamped = Math.min(0, Math.max(-24, reductionDb || 0));
        const percent = Math.abs(clamped) / 24 * 100;
        barEl.style.width = `${percent}%`;
        outEl.textContent = `${format(clamped, 1)} dB`;
    }

    window.addEventListener('unload', stopMetersPolling);

    bindControlEvents();
    initialize();
})();
