(function (root) {
    'use strict';

    const PRESETS = Object.freeze({
        default: {
            id: 'default',
            label: 'Padrão (Estável)',
            description: 'Nivela o volume entre músicas e estabiliza a dinâmica. Sem distorção.',
            enabled: true,
            highpass: { enabled: true, frequency: 30 },
            autoGain: {
                enabled: true,
                targetDb: -20,
                maxBoostDb: 6,
                maxCutDb: 6,
                responseMs: 1500
            },
            compressor: {
                threshold: -20,
                knee: 6,
                ratio: 2.5,
                attack: 0.015,
                release: 0.25
            },
            makeupGain: 1.0,
            limiter: {
                enabled: true,
                threshold: -1,
                knee: 0,
                ratio: 20,
                attack: 0.001,
                release: 0.05
            },
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 }
        },
        smart: {
            id: 'smart',
            label: 'Inteligente',
            description: 'Detecta o perfil de cada faixa (dinâmica ou esmagada) e ajusta compressão em tempo real.',
            enabled: true,
            highpass: { enabled: true, frequency: 30 },
            autoGain: {
                enabled: true,
                targetDb: -20,
                maxBoostDb: 8,
                maxCutDb: 8,
                responseMs: 1800
            },
            compressor: {
                threshold: -20,
                knee: 8,
                ratio: 3,
                attack: 0.008,
                release: 0.25
            },
            makeupGain: 1.0,
            limiter: {
                enabled: true,
                threshold: -1,
                knee: 0,
                ratio: 20,
                attack: 0.001,
                release: 0.05
            },
            adaptive: { enabled: true, headroomDb: 6, minRatio: 2.5, maxRatio: 5 }
        },
        gentle: {
            id: 'gentle',
            label: 'Suave',
            description: 'Preserva a dinâmica, nivelamento discreto entre faixas.',
            enabled: true,
            highpass: { enabled: true, frequency: 25 },
            autoGain: {
                enabled: true,
                targetDb: -16,
                maxBoostDb: 6,
                maxCutDb: 3,
                responseMs: 800
            },
            compressor: {
                threshold: -12,
                knee: 10,
                ratio: 2,
                attack: 0.02,
                release: 0.3
            },
            makeupGain: 1.0,
            limiter: {
                enabled: true,
                threshold: -1,
                knee: 0,
                ratio: 20,
                attack: 0.001,
                release: 0.05
            },
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 }
        },
        strong: {
            id: 'strong',
            label: 'Forte',
            description: 'Nivelamento firme entre faixas com grandes variações de volume.',
            enabled: true,
            highpass: { enabled: true, frequency: 30 },
            autoGain: {
                enabled: true,
                targetDb: -19,
                maxBoostDb: 10,
                maxCutDb: 9,
                responseMs: 1200
            },
            compressor: {
                threshold: -22,
                knee: 6,
                ratio: 4,
                attack: 0.006,
                release: 0.18
            },
            makeupGain: 1.0,
            limiter: {
                enabled: true,
                threshold: -1,
                knee: 0,
                ratio: 20,
                attack: 0.001,
                release: 0.05
            },
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 }
        },
        night: {
            id: 'night',
            label: 'Modo Noturno',
            description: 'Eleva partes baixas e contém picos. Ideal para ouvir à noite.',
            enabled: true,
            highpass: { enabled: true, frequency: 40 },
            autoGain: {
                enabled: true,
                targetDb: -20,
                maxBoostDb: 18,
                maxCutDb: 12,
                responseMs: 500
            },
            compressor: {
                threshold: -30,
                knee: 10,
                ratio: 8,
                attack: 0.003,
                release: 0.25
            },
            makeupGain: 1.0,
            limiter: {
                enabled: true,
                threshold: -1.5,
                knee: 0,
                ratio: 20,
                attack: 0.001,
                release: 0.05
            },
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 }
        },
        off: {
            id: 'off',
            label: 'Desligado',
            description: 'Áudio original sem processamento.',
            enabled: false,
            highpass: { enabled: false, frequency: 20 },
            autoGain: {
                enabled: false,
                targetDb: -18,
                maxBoostDb: 12,
                maxCutDb: 6,
                responseMs: 500
            },
            compressor: {
                threshold: 0,
                knee: 0,
                ratio: 1,
                attack: 0.003,
                release: 0.25
            },
            makeupGain: 1.0,
            limiter: {
                enabled: false,
                threshold: 0,
                knee: 0,
                ratio: 1,
                attack: 0.001,
                release: 0.05
            },
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 }
        }
    });

    const LIMITS = Object.freeze({
        highpassFrequency: { min: 20, max: 200, step: 1 },
        threshold: { min: -60, max: 0, step: 0.5 },
        knee: { min: 0, max: 40, step: 0.5 },
        ratio: { min: 1, max: 20, step: 0.5 },
        attack: { min: 0, max: 1, step: 0.001 },
        release: { min: 0, max: 2, step: 0.01 },
        makeupGain: { min: 0, max: 2, step: 0.05 },
        limiterThreshold: { min: -6, max: 0, step: 0.1 },
        autoGainTarget: { min: -30, max: -6, step: 0.5 },
        autoGainBoost: { min: 0, max: 24, step: 0.5 },
        autoGainCut: { min: 0, max: 24, step: 0.5 },
        autoGainResponse: { min: 100, max: 3000, step: 50 }
    });

    const STORAGE_KEY = 'ytms.settings.v3';
    const DEFAULT_PRESET_ID = 'default';

    function clonePreset(id) {
        const preset = PRESETS[id] || PRESETS[DEFAULT_PRESET_ID];
        return JSON.parse(JSON.stringify(preset));
    }

    function clampSettings(settings) {
        const s = JSON.parse(JSON.stringify(settings));
        const clamp = (v, range) => Math.min(range.max, Math.max(range.min, Number(v)));

        s.highpass.frequency = clamp(s.highpass.frequency, LIMITS.highpassFrequency);
        s.compressor.threshold = clamp(s.compressor.threshold, LIMITS.threshold);
        s.compressor.knee = clamp(s.compressor.knee, LIMITS.knee);
        s.compressor.ratio = clamp(s.compressor.ratio, LIMITS.ratio);
        s.compressor.attack = clamp(s.compressor.attack, LIMITS.attack);
        s.compressor.release = clamp(s.compressor.release, LIMITS.release);
        s.makeupGain = clamp(s.makeupGain, LIMITS.makeupGain);
        s.limiter.threshold = clamp(s.limiter.threshold, LIMITS.limiterThreshold);

        if (!s.autoGain) {
            s.autoGain = {
                enabled: true,
                targetDb: -18,
                maxBoostDb: 12,
                maxCutDb: 6,
                responseMs: 500
            };
        }
        s.autoGain.targetDb = clamp(s.autoGain.targetDb, LIMITS.autoGainTarget);
        s.autoGain.maxBoostDb = clamp(s.autoGain.maxBoostDb, LIMITS.autoGainBoost);
        s.autoGain.maxCutDb = clamp(s.autoGain.maxCutDb, LIMITS.autoGainCut);
        s.autoGain.responseMs = clamp(s.autoGain.responseMs, LIMITS.autoGainResponse);
        s.autoGain.enabled = Boolean(s.autoGain.enabled);

        if (!s.adaptive) {
            s.adaptive = { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 };
        }
        s.adaptive.enabled = Boolean(s.adaptive.enabled);
        s.adaptive.headroomDb = clamp(s.adaptive.headroomDb, { min: 0, max: 18 });
        s.adaptive.minRatio = clamp(s.adaptive.minRatio, LIMITS.ratio);
        s.adaptive.maxRatio = clamp(s.adaptive.maxRatio, LIMITS.ratio);

        return s;
    }

    root.YTMS = root.YTMS || {};
    root.YTMS.Presets = {
        ALL: PRESETS,
        LIMITS: LIMITS,
        STORAGE_KEY: STORAGE_KEY,
        DEFAULT_PRESET_ID: DEFAULT_PRESET_ID,
        clone: clonePreset,
        clamp: clampSettings
    };
})(typeof self !== 'undefined' ? self : window);
