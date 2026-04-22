(function (root) {
    'use strict';

    const PRESETS = Object.freeze({
        progressive: {
            id: 'progressive',
            label: 'Progressive (Recommended)',
            description: 'Analisa os primeiros segundos da faixa, calcula a loudness média e trava o volume ideal. Sem oscilações.',
            enabled: true,
            highpass: { enabled: true, frequency: 30 },
            autoGain: {
                enabled: true,
                mode: 'scan',
                targetDb: -24,
                maxBoostDb: 3,
                maxCutDb: 6,
                responseMs: 800
            },
            compressor: {
                threshold: -6,
                knee: 12,
                ratio: 1.5,
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
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 },
            eq: { id: 'flat' }
        },
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
                responseMs: 800
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
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 },
            eq: { id: 'flat' }
        },
        smart: {
            id: 'smart',
            label: 'Inteligente',
            description: 'Detecta o perfil de cada faixa (dinâmica ou esmagada) e ajusta compressão em tempo real.',
            enabled: true,
            highpass: { enabled: true, frequency: 30 },
            autoGain: {
                enabled: true,
                targetDb: -19,
                maxBoostDb: 14,
                maxCutDb: 12,
                responseMs: 900
            },
            compressor: {
                threshold: -20,
                knee: 8,
                ratio: 3.5,
                attack: 0.006,
                release: 0.2
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
            adaptive: { enabled: true, headroomDb: 6, minRatio: 2.5, maxRatio: 5 },
            eq: { id: 'flat' }
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
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 },
            eq: { id: 'flat' }
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
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 },
            eq: { id: 'flat' }
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
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 },
            eq: { id: 'flat' }
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
            adaptive: { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 },
            eq: { id: 'flat' }
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

    const STORAGE_KEY = 'ytms.settings.v4';
    const DEFAULT_PRESET_ID = 'progressive';

    const EQ_BANDS = Object.freeze([60, 250, 1000, 4000, 12000]);

    const EQ_PRESETS = Object.freeze({
        flat:       { id: 'flat',       label: 'Flat',            gains: [0, 0, 0, 0, 0] },
        bass:       { id: 'bass',       label: 'Grave',           gains: [6, 3, 0, 0, 0] },
        bassReduce: { id: 'bassReduce', label: 'Menos grave',     gains: [-5, -3, 0, 0, 0] },
        treble:     { id: 'treble',     label: 'Agudo',           gains: [0, 0, 0, 3, 6] },
        trebleReduce: { id: 'trebleReduce', label: 'Menos agudo', gains: [0, 0, 0, -3, -5] },
        vocal:      { id: 'vocal',      label: 'Vocal',           gains: [-2, -1, 3, 2, 0] },
        loudness:   { id: 'loudness',   label: 'Presença',        gains: [4, 1, -1, 2, 4] },
        pop:        { id: 'pop',        label: 'Pop',             gains: [1, 2, 3, 2, 1] },
        rock:       { id: 'rock',       label: 'Rock',            gains: [4, 2, -1, 2, 4] },
        electronic: { id: 'electronic', label: 'Eletrônica',      gains: [5, 2, 0, 2, 4] },
        hiphop:     { id: 'hiphop',     label: 'Hip-Hop',         gains: [5, 3, 0, 1, 3] },
        jazz:       { id: 'jazz',       label: 'Jazz',            gains: [3, 2, 1, 2, 3] },
        classical:  { id: 'classical',  label: 'Clássica',        gains: [3, 2, 0, 2, 3] },
        acoustic:   { id: 'acoustic',   label: 'Acústica',        gains: [3, 1, 1, 2, 3] },
        deep:       { id: 'deep',       label: 'Profundo',        gains: [4, 2, 1, -2, -3] },
        smallSpk:   { id: 'smallSpk',   label: 'Alto-falantes pequenos', gains: [3, 2, 0, 1, 2] },
        spoken:     { id: 'spoken',     label: 'Fala',            gains: [-3, -1, 3, 3, 0] }
    });

    const DEFAULT_EQ_ID = 'flat';

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
        if (!s.autoGain.mode || (s.autoGain.mode !== 'scan' && s.autoGain.mode !== 'realtime')) {
            s.autoGain.mode = 'realtime';
        }

        if (!s.adaptive) {
            s.adaptive = { enabled: false, headroomDb: 6, minRatio: 2, maxRatio: 6 };
        }
        s.adaptive.enabled = Boolean(s.adaptive.enabled);
        s.adaptive.headroomDb = clamp(s.adaptive.headroomDb, { min: 0, max: 18 });
        s.adaptive.minRatio = clamp(s.adaptive.minRatio, LIMITS.ratio);
        s.adaptive.maxRatio = clamp(s.adaptive.maxRatio, LIMITS.ratio);

        if (!s.eq) {
            s.eq = { id: DEFAULT_EQ_ID };
        } else if (s.eq.id === 'custom') {
            if (!Array.isArray(s.eq.gains)) {
                s.eq = { id: DEFAULT_EQ_ID };
            } else {
                s.eq.gains = s.eq.gains.slice(0, 5).map(g =>
                    Math.min(12, Math.max(-12, Math.round((Number(g) || 0) * 2) / 2))
                );
                while (s.eq.gains.length < 5) s.eq.gains.push(0);
            }
        } else if (!EQ_PRESETS[s.eq.id]) {
            s.eq = { id: DEFAULT_EQ_ID };
        }

        return s;
    }

    root.YTMS = root.YTMS || {};
    root.YTMS.Presets = {
        ALL: PRESETS,
        LIMITS: LIMITS,
        STORAGE_KEY: STORAGE_KEY,
        DEFAULT_PRESET_ID: DEFAULT_PRESET_ID,
        EQ_PRESETS: EQ_PRESETS,
        EQ_BANDS: EQ_BANDS,
        DEFAULT_EQ_ID: DEFAULT_EQ_ID,
        clone: clonePreset,
        clamp: clampSettings
    };
})(typeof self !== 'undefined' ? self : window);
