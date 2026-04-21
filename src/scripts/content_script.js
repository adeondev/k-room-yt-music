(function () {
    'use strict';

    const { Presets, AudioEngine } = self.YTMS;
    const STORAGE_KEY = Presets.STORAGE_KEY;

    const engine = new AudioEngine();
    let currentSettings = null;
    let attachAttempts = 0;
    const MAX_LOG_ATTEMPTS = 3;

    function log(...args) {
        if (console && console.debug) {
            console.debug('[YT Music Stable Volume]', ...args);
        }
    }

    async function loadSettings() {
        try {
            const data = await chrome.storage.local.get(STORAGE_KEY);
            const stored = data[STORAGE_KEY];
            if (stored && typeof stored === 'object') {
                return Presets.clamp(stored);
            }
        } catch (err) {
            log('Falha ao ler storage, usando padrão.', err);
        }
        return Presets.clone(Presets.DEFAULT_PRESET_ID);
    }

    async function saveSettings(settings) {
        try {
            await chrome.storage.local.set({ [STORAGE_KEY]: settings });
        } catch (err) {
            log('Falha ao persistir settings.', err);
        }
    }

    function tryAttach() {
        const video = document.querySelector('video');
        if (!video) return false;
        if (engine.isAttached() && engine.isSameElement(video)) {
            engine.ensureRunning();
            return true;
        }

        try {
            engine.attach(video, currentSettings);
            log('Attached ao elemento de vídeo.');
            return true;
        } catch (err) {
            attachAttempts += 1;
            if (attachAttempts <= MAX_LOG_ATTEMPTS) {
                log('Não foi possível conectar ao áudio:', err.message);
            }
            return false;
        }
    }

    let observeScheduled = false;
    function scheduleAttachCheck() {
        if (observeScheduled) return;
        observeScheduled = true;
        requestAnimationFrame(() => {
            observeScheduled = false;
            tryAttach();
            injectNavButton();
            injectVisualizer();
        });
    }

    function observeDom() {
        const observer = new MutationObserver(scheduleAttachCheck);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    const PANEL_ID = 'ytms-kroom-panel';
    const BTN_ID = 'ytms-kroom-nav-btn';
    const VIZ_ID = 'ytms-kroom-viz';
    const STYLE_ID = 'ytms-kroom-style';
    const VIZ_BARS = 4;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${BTN_ID} {
                all: unset;
                width: 40px;
                height: 40px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 50%;
                cursor: pointer;
                margin: 0 4px;
                transition: background 160ms ease;
            }
            #${BTN_ID}:hover {
                background: rgba(255, 255, 255, 0.1);
            }
            #${BTN_ID}.is-open {
                background: rgba(255, 0, 51, 0.2);
            }
            #${BTN_ID} img {
                width: 24px;
                height: 24px;
                display: block;
                pointer-events: none;
            }
            #${PANEL_ID} {
                position: fixed;
                top: 64px;
                right: 16px;
                width: 380px;
                height: 640px;
                max-height: calc(100vh - 80px);
                border: 1px solid #303030;
                border-radius: 12px;
                background: #0f0f0f;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
                z-index: 2147483647;
                overflow: hidden;
            }
            #${VIZ_ID} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 3px;
                height: 40px;
                padding: 0 6px;
                margin: 0 2px;
                pointer-events: none;
                vertical-align: middle;
            }
            #${VIZ_ID} .ytms-kroom-viz-bar {
                display: inline-block;
                width: 3px;
                height: 2px;
                background: #ff0033;
                border-radius: 2px;
                will-change: height;
                box-shadow: 0 0 4px rgba(255, 0, 51, 0.5);
            }
            #${VIZ_ID}.is-idle .ytms-kroom-viz-bar {
                background: rgba(255, 255, 255, 0.25);
                box-shadow: none;
            }
        `;
        document.documentElement.appendChild(style);
    }

    function injectNavButton() {
        const rightContent = document.querySelector('#right-content');
        if (!rightContent) return;
        if (rightContent.querySelector('#' + BTN_ID)) return;

        injectStyles();

        const btn = document.createElement('button');
        btn.id = BTN_ID;
        btn.type = 'button';
        btn.title = 'K-ROOM Volume Control';
        btn.setAttribute('aria-label', 'K-ROOM Volume Control');

        const img = document.createElement('img');
        img.src = chrome.runtime.getURL('icons/icon.png');
        img.alt = 'K-ROOM';
        btn.appendChild(img);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePanel();
        });

        rightContent.insertBefore(btn, rightContent.firstChild);
        injectVisualizer();
    }

    function injectVisualizer() {
        const rightContent = document.querySelector('#right-content');
        if (!rightContent) return;
        if (rightContent.querySelector('#' + VIZ_ID)) return;

        const viz = document.createElement('div');
        viz.id = VIZ_ID;
        viz.classList.add('is-idle');
        viz.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < VIZ_BARS; i++) {
            const bar = document.createElement('span');
            bar.className = 'ytms-kroom-viz-bar';
            viz.appendChild(bar);
        }

        const btn = rightContent.querySelector('#' + BTN_ID);
        if (btn && btn.nextSibling) {
            rightContent.insertBefore(viz, btn.nextSibling);
        } else {
            rightContent.appendChild(viz);
        }

        startVizLoop();
    }

    const vizState = {
        running: false,
        heights: new Array(VIZ_BARS).fill(2),
        lastActive: 0
    };

    function startVizLoop() {
        if (vizState.running) return;
        vizState.running = true;

        const MAX_H = 14;
        const MIN_H = 2;

        const tick = () => {
            const viz = document.getElementById(VIZ_ID);
            if (!viz) {
                vizState.running = false;
                return;
            }

            const bars = viz.children;
            const bins = engine.isAttached() ? engine.getFrequencyBins(VIZ_BARS) : null;

            let anyActive = false;
            if (bins) {
                for (let i = 0; i < bars.length; i++) {
                    const shaped = Math.pow(bins[i], 0.7);
                    const target = MIN_H + shaped * (MAX_H - MIN_H);
                    const prev = vizState.heights[i];
                    const next = target > prev
                        ? target
                        : prev * 0.82 + target * 0.18;
                    vizState.heights[i] = next;
                    bars[i].style.height = next.toFixed(1) + 'px';
                    if (next > MIN_H + 1) anyActive = true;
                }
            } else {
                for (let i = 0; i < bars.length; i++) {
                    vizState.heights[i] = MIN_H;
                    bars[i].style.height = MIN_H + 'px';
                }
            }

            const now = performance.now();
            if (anyActive) vizState.lastActive = now;
            const idle = now - vizState.lastActive > 400;
            viz.classList.toggle('is-idle', idle);

            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }

    function togglePanel() {
        const btn = document.getElementById(BTN_ID);
        const existing = document.getElementById(PANEL_ID);
        if (existing) {
            existing.remove();
            if (btn) btn.classList.remove('is-open');
            return;
        }
        const iframe = document.createElement('iframe');
        iframe.id = PANEL_ID;
        iframe.src = chrome.runtime.getURL('src/popup/popup.html');
        iframe.setAttribute('title', 'K-ROOM');
        document.body.appendChild(iframe);
        if (btn) btn.classList.add('is-open');
    }

    function setupOutsideClose() {
        document.addEventListener('click', (e) => {
            const panel = document.getElementById(PANEL_ID);
            if (!panel) return;
            const btn = document.getElementById(BTN_ID);
            if (panel.contains(e.target)) return;
            if (btn && btn.contains(e.target)) return;
            panel.remove();
            if (btn) btn.classList.remove('is-open');
        }, true);

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById(PANEL_ID);
                if (panel) {
                    panel.remove();
                    const btn = document.getElementById(BTN_ID);
                    if (btn) btn.classList.remove('is-open');
                }
            }
        });
    }

    function setupMessaging() {
        chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
            if (!msg || typeof msg.type !== 'string') return false;

            switch (msg.type) {
                case 'YTMS_GET_STATE': {
                    reply({
                        settings: currentSettings,
                        attached: engine.isAttached(),
                        meters: engine.getMeters()
                    });
                    return false;
                }
                case 'YTMS_SET_SETTINGS': {
                    const next = Presets.clamp(msg.settings);
                    currentSettings = next;
                    engine.apply(next);
                    saveSettings(next);
                    reply({ ok: true, settings: next });
                    return false;
                }
                case 'YTMS_RESET': {
                    const next = Presets.clone(Presets.DEFAULT_PRESET_ID);
                    currentSettings = next;
                    engine.apply(next);
                    saveSettings(next);
                    reply({ ok: true, settings: next });
                    return false;
                }
                case 'YTMS_APPLY_PRESET': {
                    const next = Presets.clone(msg.presetId);
                    currentSettings = next;
                    engine.apply(next);
                    saveSettings(next);
                    reply({ ok: true, settings: next });
                    return false;
                }
                case 'YTMS_GET_METERS': {
                    reply(engine.getMeters());
                    return false;
                }
                default:
                    return false;
            }
        });
    }

    function watchStorage() {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes[STORAGE_KEY]) return;
            const next = changes[STORAGE_KEY].newValue;
            if (next && typeof next === 'object') {
                currentSettings = Presets.clamp(next);
                engine.apply(currentSettings);
            }
        });
    }

    function healthCheck() {
        const video = document.querySelector('video');

        if (!engine.isAttached()) {
            if (video) tryAttach();
            return;
        }

        if (!engine.isContextHealthy()) {
            engine.forceTeardown();
            if (video) tryAttach();
            return;
        }

        if (video && !engine.isSameElement(video)) {
            tryAttach();
            return;
        }

        engine.ensureRunning();
    }

    async function boot() {
        currentSettings = await loadSettings();
        setupMessaging();
        watchStorage();

        tryAttach();
        observeDom();
        injectStyles();
        injectNavButton();
        injectVisualizer();
        setupOutsideClose();

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) healthCheck();
        });

        window.addEventListener('focus', healthCheck);
        window.addEventListener('pageshow', healthCheck);
        window.addEventListener('online', healthCheck);

        setInterval(healthCheck, 2000);
    }

    boot();
})();
