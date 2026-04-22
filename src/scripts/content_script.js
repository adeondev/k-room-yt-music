(function () {
    'use strict';

    const { Presets, AudioEngine } = self.YTMS;
    const STORAGE_KEY = Presets.STORAGE_KEY;

    const engine = new AudioEngine();
    let currentSettings = null;
    let attachAttempts = 0;
    const MAX_LOG_ATTEMPTS = 3;
    let suspendedCount = 0;
    let _lastVideoId = null;

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
            attachAttempts = 0;
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
            #ytms-kroom-update-popup {
                position: fixed;
                bottom: 24px;
                right: 24px;
                width: 320px;
                background: rgba(15, 15, 15, 0.95);
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.08);
                border-radius: 16px;
                padding: 20px;
                box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.02);
                z-index: 2147483647;
                font-family: Roboto, Arial, sans-serif;
                color: #fff;
                display: flex;
                flex-direction: column;
                gap: 14px;
                transform: translateY(60px) scale(0.95);
                opacity: 0;
                pointer-events: none;
                transition: all 400ms cubic-bezier(0.175, 0.885, 0.32, 1.275);
            }
            #ytms-kroom-update-popup.is-visible {
                transform: translateY(0) scale(1);
                opacity: 1;
                pointer-events: auto;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-header {
                display: flex;
                align-items: center;
                gap: 12px;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-icon {
                width: 28px;
                height: 28px;
                border-radius: 6px;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-title {
                font-size: 16px;
                font-weight: 600;
                color: #ff0033;
                letter-spacing: 0.5px;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-desc {
                font-size: 14px;
                color: #ccc;
                line-height: 1.5;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-desc b {
                color: #fff;
                font-weight: 600;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-actions {
                display: flex;
                justify-content: flex-end;
                margin-top: 4px;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-btn {
                background: rgba(255, 0, 51, 0.15);
                border: 1px solid rgba(255, 0, 51, 0.3);
                color: #ff0033;
                padding: 8px 18px;
                border-radius: 20px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                transition: all 200ms ease;
            }
            #ytms-kroom-update-popup .ytms-kroom-update-btn:hover {
                background: rgba(255, 0, 51, 0.25);
                border-color: rgba(255, 0, 51, 0.5);
                transform: scale(1.05);
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
                    const m = engine.getMeters();
                    const v = document.querySelector('video');
                    if (v && isFinite(v.duration) && v.duration > 0) {
                        m.currentTime = Math.min(v.currentTime, v.duration);
                        m.duration = v.duration;
                    }
                    m.scanPhase = engine.getScanPhase();
                    m.metadata = { title: '', artist: '', artwork: '' };
                    if ('mediaSession' in navigator && navigator.mediaSession.metadata) {
                        const md = navigator.mediaSession.metadata;
                        m.metadata.title = md.title || '';
                        m.metadata.artist = md.artist || '';
                        if (md.artwork && md.artwork.length > 0) {
                            m.metadata.artwork = md.artwork[md.artwork.length - 1].src;
                        }
                    }
                    reply(m);
                    return false;
                }
                case 'YTMS_MEDIA_SEEK': {
                    const v = document.querySelector('video');
                    if (v && isFinite(v.duration) && v.duration > 0) v.currentTime = msg.time;
                    reply({ ok: true });
                    return false;
                }
                case 'YTMS_MEDIA_CONTROL': {
                    const clickSimulate = (sel) => {
                        const btn = document.querySelector(sel);
                        if (!btn) return false;
                        const opts = { bubbles: true, cancelable: true, view: window };
                        btn.dispatchEvent(new MouseEvent('pointerdown', opts));
                        btn.dispatchEvent(new MouseEvent('mousedown', opts));
                        btn.dispatchEvent(new MouseEvent('mouseup', opts));
                        btn.dispatchEvent(new MouseEvent('pointerup', opts));
                        btn.click();
                        return true;
                    };
                    if (msg.action === 'play-pause') {
                        const v = document.querySelector('video');
                        if (v) { v.paused ? v.play() : v.pause(); }
                        else { clickSimulate('#play-pause-button') || clickSimulate('.play-pause-button'); }
                    } else if (msg.action === 'next') {
                        clickSimulate('.next-button') || clickSimulate('.ytp-next-button');
                    } else if (msg.action === 'prev') {
                        clickSimulate('.previous-button') || clickSimulate('.ytp-prev-button');
                    }
                    reply({ ok: true });
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
            suspendedCount = 0;
            if (video) tryAttach();
            return;
        }

        if (!engine.isContextHealthy()) {
            suspendedCount = 0;
            engine.forceTeardown();
            if (video) setTimeout(tryAttach, 50);
            return;
        }

        if (video && !engine.isSameElement(video)) {
            suspendedCount = 0;
            tryAttach();
            return;
        }

        const { contextState } = engine.getMeters();
        if (contextState === 'suspended' && video && !video.paused) {
            suspendedCount++;
            if (suspendedCount >= 5) {
                log('AudioContext suspended por tempo demais — forçando reattach.');
                suspendedCount = 0;
                engine.forceTeardown();
                if (video) setTimeout(tryAttach, 50);
                return;
            }
        } else {
            suspendedCount = 0;
        }

        engine.ensureRunning();
    }

    function showUpdatePopup(current, remote) {
        if (document.getElementById('ytms-kroom-update-popup')) return;
        injectStyles();

        const isPt = navigator.language.startsWith('pt');
        const tTitle = isPt ? 'Atualização K-ROOM' : 'K-ROOM Update Available';
        const tDesc = isPt 
            ? `Sua extensão está desatualizada.<br>Atual: <b>${current}</b> &rarr; Nova: <b>${remote}</b>`
            : `Your extension is outdated.<br>Current: <b>${current}</b> &rarr; New: <b>${remote}</b>`;
        const tBtn = isPt ? 'Fechar' : 'Dismiss';

        const popup = document.createElement('div');
        popup.id = 'ytms-kroom-update-popup';

        const header = document.createElement('div');
        header.className = 'ytms-kroom-update-header';

        const icon = document.createElement('img');
        icon.src = chrome.runtime.getURL('icons/icon.png');
        icon.className = 'ytms-kroom-update-icon';
        icon.alt = 'K-ROOM';

        const title = document.createElement('div');
        title.className = 'ytms-kroom-update-title';
        title.textContent = tTitle;

        header.appendChild(icon);
        header.appendChild(title);

        const desc = document.createElement('div');
        desc.className = 'ytms-kroom-update-desc';
        desc.innerHTML = tDesc;

        const actions = document.createElement('div');
        actions.className = 'ytms-kroom-update-actions';

        const btn = document.createElement('button');
        btn.className = 'ytms-kroom-update-btn';
        btn.textContent = tBtn;
        btn.addEventListener('click', () => {
            popup.classList.remove('is-visible');
            setTimeout(() => popup.remove(), 400);
        });

        actions.appendChild(btn);
        popup.appendChild(header);
        popup.appendChild(desc);
        popup.appendChild(actions);

        document.documentElement.appendChild(popup);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                popup.classList.add('is-visible');
            });
        });
    }

    async function checkVersion() {
        try {
            const currentVersion = chrome.runtime.getManifest().version;
            const res = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'YTMS_CHECK_VERSION' }, (response) => {
                    resolve(response);
                });
            });

            if (res && res.version) {
                const remoteVersion = res.version;
                if (remoteVersion !== currentVersion) {
                    showUpdatePopup(currentVersion, remoteVersion);
                }
            }
        } catch (err) {
            log('Falha ao verificar versão', err);
        }
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
        checkVersion();

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) healthCheck();
        });

        document.addEventListener('play', (e) => {
            if (e.target.tagName === 'VIDEO') healthCheck();
        }, true);

        window.addEventListener('focus', healthCheck);
        window.addEventListener('pageshow', healthCheck);
        window.addEventListener('online', healthCheck);

        _lastVideoId = getVideoIdFromUrl();
        document.addEventListener('yt-navigate-finish', onPossibleTrackChange);
        window.addEventListener('popstate', onPossibleTrackChange);
        setInterval(onPossibleTrackChange, 1500);

        setInterval(healthCheck, 2000);
    }

    function getVideoIdFromUrl() {
        try {
            return new URL(window.location.href).searchParams.get('v') || null;
        } catch (_) {
            return null;
        }
    }

    function onPossibleTrackChange() {
        const vid = getVideoIdFromUrl();
        if (vid && vid !== _lastVideoId) {
            _lastVideoId = vid;
            if (currentSettings && currentSettings.autoGain &&
                currentSettings.autoGain.mode === 'scan') {
                engine.resetScan();
                log('Track change detected — scan reset.');
            }
        }
    }

    boot();
})();
