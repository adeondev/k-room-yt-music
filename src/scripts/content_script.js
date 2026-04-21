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
        if (engine.isAttached() && engine.isSameElement(video)) return true;

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

    function observeDom() {
        const observer = new MutationObserver(() => {
            tryAttach();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
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

    async function boot() {
        currentSettings = await loadSettings();
        setupMessaging();
        watchStorage();

        if (!tryAttach()) {
            observeDom();
        }

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) tryAttach();
        });
    }

    boot();
})();
