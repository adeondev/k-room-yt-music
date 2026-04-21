(function (root) {
    'use strict';

    const AUTO_GAIN_TICK_MS = 50;
    const SILENCE_GATE_DB = -55;
    const ANALYSER_FFT = 2048;

    class AudioEngine {
        constructor() {
            this.context = null;
            this.source = null;
            this.mediaElement = null;
            this.settings = null;
            this.nodes = this._emptyNodes();
            this._attached = false;
            this._analyserBuffer = null;
            this._emaMeanSquare = 0;
            this._peakEnvelope = 0;
            this._autoGainTimer = null;
            this._currentAutoGainDb = 0;
            this._currentCrestDb = 0;
            this._currentAdaptiveRatio = 0;
            this._currentAdaptiveThresholdDb = 0;
        }

        isAttached() {
            return this._attached;
        }

        isSameElement(el) {
            return this.mediaElement === el;
        }

        attach(mediaElement, settings) {
            if (this._attached && this.mediaElement === mediaElement) {
                this.apply(settings);
                return;
            }

            if (this._attached && this.mediaElement !== mediaElement) {
                this._teardown();
            }

            const Ctx = root.AudioContext || root.webkitAudioContext;
            if (!Ctx) {
                throw new Error('Web Audio API não disponível.');
            }

            this.context = new Ctx();
            try {
                this.source = this.context.createMediaElementSource(mediaElement);
            } catch (err) {
                this.context.close().catch(() => {});
                this.context = null;
                throw err;
            }

            this.mediaElement = mediaElement;
            this._buildGraph();
            this._attached = true;
            this.apply(settings);

            this._installResumeListeners();
            this._startAutoGainLoop();
        }

        apply(settings) {
            if (!this._attached || !settings) {
                this.settings = settings || null;
                return;
            }

            this.settings = settings;
            this._ensureResumed();

            if (settings.enabled === false) {
                this._routeBypass();
                return;
            }

            this._routeProcessing();
            this._applyHighpass(settings.highpass);
            this._applyCompressor(settings.compressor);
            this._applyMakeup(settings.makeupGain);
            this._applyLimiter(settings.limiter);
            this._applyAutoGain(settings.autoGain);

            if (!settings.adaptive || !settings.adaptive.enabled) {
                this._currentAdaptiveRatio = 0;
                this._currentAdaptiveThresholdDb = 0;
            }
        }

        getMeters() {
            if (!this._attached) {
                return {
                    compressor: 0,
                    limiter: 0,
                    autoGainDb: 0,
                    inputDb: -Infinity,
                    crestDb: 0,
                    adaptiveRatio: 0,
                    adaptiveThresholdDb: 0,
                    contextState: 'detached'
                };
            }
            return {
                compressor: this.nodes.compressor ? this.nodes.compressor.reduction : 0,
                limiter: this.nodes.limiter ? this.nodes.limiter.reduction : 0,
                autoGainDb: this._currentAutoGainDb,
                inputDb: this._measureInputDb(),
                crestDb: this._currentCrestDb,
                adaptiveRatio: this._currentAdaptiveRatio,
                adaptiveThresholdDb: this._currentAdaptiveThresholdDb,
                contextState: this.context ? this.context.state : 'unknown'
            };
        }

        _emptyNodes() {
            return {
                input: null,
                highpass: null,
                analyser: null,
                autoGain: null,
                compressor: null,
                makeup: null,
                limiter: null,
                output: null
            };
        }

        _buildGraph() {
            const ctx = this.context;
            this.nodes.input = ctx.createGain();
            this.nodes.input.gain.value = 1.0;

            this.nodes.highpass = ctx.createBiquadFilter();
            this.nodes.highpass.type = 'highpass';
            this.nodes.highpass.Q.value = 0.707;

            this.nodes.analyser = ctx.createAnalyser();
            this.nodes.analyser.fftSize = ANALYSER_FFT;
            this.nodes.analyser.smoothingTimeConstant = 0;
            this._analyserBuffer = new Float32Array(this.nodes.analyser.fftSize);

            this.nodes.autoGain = ctx.createGain();
            this.nodes.autoGain.gain.value = 1.0;

            this.nodes.compressor = ctx.createDynamicsCompressor();
            this.nodes.makeup = ctx.createGain();
            this.nodes.limiter = ctx.createDynamicsCompressor();

            this.nodes.output = ctx.createGain();
            this.nodes.output.gain.value = 1.0;

            this.source.connect(this.nodes.input);
        }

        _routeProcessing() {
            this._disconnectChain();
            const n = this.nodes;
            n.input.connect(n.highpass);
            n.highpass.connect(n.analyser);
            n.analyser.connect(n.autoGain);
            n.autoGain.connect(n.compressor);
            n.compressor.connect(n.makeup);
            n.makeup.connect(n.limiter);
            n.limiter.connect(n.output);
            n.output.connect(this.context.destination);
        }

        _routeBypass() {
            this._disconnectChain();
            this.nodes.input.connect(this.nodes.output);
            this.nodes.output.connect(this.context.destination);
        }

        _disconnectChain() {
            for (const node of Object.values(this.nodes)) {
                if (!node) continue;
                try { node.disconnect(); } catch (_) { }
            }
        }

        _applyHighpass(hp) {
            const node = this.nodes.highpass;
            const now = this.context.currentTime;
            const freq = hp && hp.enabled ? hp.frequency : 20;
            node.frequency.setTargetAtTime(freq, now, 0.01);
        }

        _applyCompressor(c) {
            const node = this.nodes.compressor;
            const now = this.context.currentTime;
            node.threshold.setTargetAtTime(c.threshold, now, 0.01);
            node.knee.setTargetAtTime(c.knee, now, 0.01);
            node.ratio.setTargetAtTime(c.ratio, now, 0.01);
            node.attack.setTargetAtTime(c.attack, now, 0.01);
            node.release.setTargetAtTime(c.release, now, 0.01);
        }

        _applyMakeup(gain) {
            const now = this.context.currentTime;
            this.nodes.makeup.gain.setTargetAtTime(gain, now, 0.02);
        }

        _applyLimiter(l) {
            const node = this.nodes.limiter;
            const now = this.context.currentTime;
            if (l && l.enabled) {
                node.threshold.setTargetAtTime(l.threshold, now, 0.005);
                node.knee.setTargetAtTime(l.knee, now, 0.005);
                node.ratio.setTargetAtTime(l.ratio, now, 0.005);
                node.attack.setTargetAtTime(l.attack, now, 0.005);
                node.release.setTargetAtTime(l.release, now, 0.005);
            } else {
                node.threshold.setTargetAtTime(0, now, 0.005);
                node.ratio.setTargetAtTime(1, now, 0.005);
            }
        }

        _applyAutoGain(ag) {
            if (!ag || !ag.enabled) {
                const now = this.context.currentTime;
                this.nodes.autoGain.gain.setTargetAtTime(1, now, 0.2);
                this._currentAutoGainDb = 0;
            }
        }

        _startAutoGainLoop() {
            this._stopAutoGainLoop();
            this._autoGainTimer = setInterval(
                () => this._autoGainTick(),
                AUTO_GAIN_TICK_MS
            );
        }

        _stopAutoGainLoop() {
            if (this._autoGainTimer) {
                clearInterval(this._autoGainTimer);
                this._autoGainTimer = null;
            }
        }

        _autoGainTick() {
            if (!this._attached || !this.settings) return;
            if (this.settings.enabled === false) return;

            const sample = this._sampleAudio();
            if (sample === null) return;

            const alpha = AUTO_GAIN_TICK_MS / 2000;
            if (this._emaMeanSquare === 0) {
                this._emaMeanSquare = sample.meanSquare;
            } else {
                this._emaMeanSquare =
                    this._emaMeanSquare * (1 - alpha) + sample.meanSquare * alpha;
            }

            const peakSquared = sample.peak * sample.peak;
            if (peakSquared > this._peakEnvelope) {
                this._peakEnvelope = peakSquared;
            } else {
                const decay = Math.exp(-AUTO_GAIN_TICK_MS / 1000);
                this._peakEnvelope = this._peakEnvelope * decay;
            }

            const rmsDb = 10 * Math.log10(Math.max(this._emaMeanSquare, 1e-12));
            const peakDb = 10 * Math.log10(Math.max(this._peakEnvelope, 1e-12));
            this._currentCrestDb = Math.max(0, peakDb - rmsDb);

            if (rmsDb < SILENCE_GATE_DB) return;

            this._applyAutoGainUpdate(rmsDb);
            this._applyAdaptiveUpdate(rmsDb);
        }

        _applyAutoGainUpdate(rmsDb) {
            const ag = this.settings.autoGain;
            if (!ag || !ag.enabled) {
                this._currentAutoGainDb = 0;
                return;
            }

            let gainDb = ag.targetDb - rmsDb;
            if (gainDb > ag.maxBoostDb) gainDb = ag.maxBoostDb;
            if (gainDb < -ag.maxCutDb) gainDb = -ag.maxCutDb;

            this._currentAutoGainDb = gainDb;

            const gain = Math.pow(10, gainDb / 20);
            const now = this.context.currentTime;
            const tau = Math.max(0.05, (ag.responseMs || 500) / 1000 / 3);
            this.nodes.autoGain.gain.setTargetAtTime(gain, now, tau);
        }

        _applyAdaptiveUpdate(rmsDb) {
            const a = this.settings.adaptive;
            if (!a || !a.enabled) return;

            const crest = this._currentCrestDb;
            const dynamicity = Math.min(1, Math.max(0, (crest - 6) / 14));

            const ratio = a.maxRatio - dynamicity * (a.maxRatio - a.minRatio);

            const postAgcRmsDb =
                this.settings.autoGain && this.settings.autoGain.enabled
                    ? this.settings.autoGain.targetDb
                    : rmsDb;
            const threshold = Math.max(-40, Math.min(-3, postAgcRmsDb + a.headroomDb));

            this._currentAdaptiveRatio = ratio;
            this._currentAdaptiveThresholdDb = threshold;

            const now = this.context.currentTime;
            this.nodes.compressor.ratio.setTargetAtTime(ratio, now, 1.0);
            this.nodes.compressor.threshold.setTargetAtTime(threshold, now, 1.0);
        }

        _sampleAudio() {
            const analyser = this.nodes.analyser;
            if (!analyser || !this._analyserBuffer) return null;
            analyser.getFloatTimeDomainData(this._analyserBuffer);

            let sumSquares = 0;
            let peak = 0;
            const buf = this._analyserBuffer;
            for (let i = 0; i < buf.length; i++) {
                const v = buf[i];
                sumSquares += v * v;
                const abs = v < 0 ? -v : v;
                if (abs > peak) peak = abs;
            }
            return {
                meanSquare: sumSquares / buf.length,
                peak: peak
            };
        }

        _measureInputDb() {
            if (this._emaMeanSquare <= 0) return -Infinity;
            return 10 * Math.log10(this._emaMeanSquare);
        }

        _ensureResumed() {
            if (this.context && this.context.state === 'suspended') {
                this.context.resume().catch(() => {});
            }
        }

        _installResumeListeners() {
            const resume = () => this._ensureResumed();
            const opts = { capture: true, passive: true };
            root.document.addEventListener('click', resume, opts);
            root.document.addEventListener('keydown', resume, opts);
            root.document.addEventListener('play', resume, { capture: true });
        }

        _teardown() {
            this._stopAutoGainLoop();
            this._disconnectChain();
            try { this.source && this.source.disconnect(); } catch (_) {}
            if (this.context) {
                this.context.close().catch(() => {});
            }
            this.context = null;
            this.source = null;
            this.mediaElement = null;
            this.nodes = this._emptyNodes();
            this._attached = false;
            this._analyserBuffer = null;
            this._emaMeanSquare = 0;
            this._currentAutoGainDb = 0;
        }
    }

    root.YTMS = root.YTMS || {};
    root.YTMS.AudioEngine = AudioEngine;
})(typeof self !== 'undefined' ? self : window);
