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
            this._silenceTicks = 0;
            this._trackChangeBoost = false;
            this._autoGainTimer = null;
            this._currentAutoGainDb = 0;
            this._currentCrestDb = 0;
            this._currentAdaptiveRatio = 0;
            this._currentAdaptiveThresholdDb = 0;
            this._currentRoute = null;
        }

        isAttached() {
            return this._attached;
        }

        isSameElement(el) {
            return this.mediaElement === el;
        }

        ensureRunning() {
            if (!this.context) return;
            if (this.context.state === 'closed') return;
            this._ensureResumed();
        }

        isElementConnected() {
            return !!(this.mediaElement && this.mediaElement.isConnected);
        }

        isContextHealthy() {
            return !!(this.context && this.context.state !== 'closed');
        }

        forceTeardown() {
            this._teardown();
        }

        getFrequencyBins(numBins) {
            const analyser = this.nodes.analyser;
            if (!analyser || !this._attached) return null;
            const bufferLength = analyser.frequencyBinCount;
            const data = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(data);

            const bins = new Array(numBins).fill(0);
            const usableLen = Math.floor(bufferLength * 0.6);
            const logBase = Math.log(usableLen + 1);
            let prevIdx = 0;
            for (let i = 0; i < numBins; i++) {
                const nextIdx = Math.max(
                    prevIdx + 1,
                    Math.floor((Math.exp(logBase * (i + 1) / numBins) - 1))
                );
                const end = Math.min(usableLen, nextIdx);
                let sum = 0;
                let count = 0;
                for (let j = prevIdx; j < end; j++) {
                    sum += data[j];
                    count++;
                }
                bins[i] = count ? (sum / count / 255) : 0;
                prevIdx = end;
            }
            return bins;
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

            const targetRoute = settings.enabled === false ? 'bypass' : 'processing';
            if (this._currentRoute !== targetRoute) {
                if (targetRoute === 'bypass') {
                    this._routeBypass();
                } else {
                    this._routeProcessing();
                }
                this._currentRoute = targetRoute;
            }

            if (settings.enabled === false) return;

            this._applyHighpass(settings.highpass);
            this._applyEq(settings.eq);
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

        _smoothParam(param, value, tau) {
            if (!this.context) return;
            const now = this.context.currentTime;
            if (param.cancelAndHoldAtTime) {
                param.cancelAndHoldAtTime(now);
            } else {
                param.cancelScheduledValues(now);
                param.setValueAtTime(param.value, now);
            }
            param.setTargetAtTime(value, now, tau);
        }

        _emptyNodes() {
            return {
                input: null,
                highpass: null,
                eq: null,
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

            const EQ_FREQS = (root.YTMS && root.YTMS.Presets && root.YTMS.Presets.EQ_BANDS) || [60, 250, 1000, 4000, 12000];
            this.nodes.eq = EQ_FREQS.map((freq) => {
                const filter = ctx.createBiquadFilter();
                filter.type = 'peaking';
                filter.frequency.value = freq;
                filter.Q.value = 1.0;
                filter.gain.value = 0;
                return filter;
            });

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
            let prev = n.highpass;
            for (const band of n.eq) {
                prev.connect(band);
                prev = band;
            }
            prev.connect(n.analyser);
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
                if (Array.isArray(node)) {
                    for (const sub of node) {
                        try { sub.disconnect(); } catch (_) { }
                    }
                    continue;
                }
                try { node.disconnect(); } catch (_) { }
            }
        }

        _applyHighpass(hp) {
            const freq = hp && hp.enabled ? hp.frequency : 20;
            this._smoothParam(this.nodes.highpass.frequency, freq, 0.01);
        }

        _applyEq(eq) {
            if (!this.nodes.eq) return;
            const presets = root.YTMS && root.YTMS.Presets && root.YTMS.Presets.EQ_PRESETS;
            const id = (eq && eq.id) ? eq.id : 'flat';
            const preset = (presets && presets[id]) || (presets && presets.flat);
            const gains = preset ? preset.gains : [0, 0, 0, 0, 0];
            for (let i = 0; i < this.nodes.eq.length; i++) {
                const g = (i < gains.length) ? gains[i] : 0;
                this._smoothParam(this.nodes.eq[i].gain, g, 0.05);
            }
        }

        _applyCompressor(c) {
            const node = this.nodes.compressor;
            this._smoothParam(node.threshold, c.threshold, 0.01);
            this._smoothParam(node.knee, c.knee, 0.01);
            this._smoothParam(node.ratio, c.ratio, 0.01);
            this._smoothParam(node.attack, c.attack, 0.01);
            this._smoothParam(node.release, c.release, 0.01);
        }

        _applyMakeup(gain) {
            this._smoothParam(this.nodes.makeup.gain, gain, 0.02);
        }

        _applyLimiter(l) {
            const node = this.nodes.limiter;
            if (l && l.enabled) {
                this._smoothParam(node.threshold, l.threshold, 0.005);
                this._smoothParam(node.knee, l.knee, 0.005);
                this._smoothParam(node.ratio, l.ratio, 0.005);
                this._smoothParam(node.attack, l.attack, 0.005);
                this._smoothParam(node.release, l.release, 0.005);
            } else {
                this._smoothParam(node.threshold, 0, 0.005);
                this._smoothParam(node.ratio, 1, 0.005);
            }
        }

        _applyAutoGain(ag) {
            if (!ag || !ag.enabled) {
                this._smoothParam(this.nodes.autoGain.gain, 1, 0.2);
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

            const instDb = 10 * Math.log10(Math.max(sample.meanSquare, 1e-12));

            if (instDb < SILENCE_GATE_DB) {
                this._silenceTicks = (this._silenceTicks || 0) + 1;
                return;
            }

            const longSilence = (this._silenceTicks || 0) > (3000 / AUTO_GAIN_TICK_MS);
            if (longSilence || this._emaMeanSquare === 0) {
                if (this._emaMeanSquare > 0) {
                    this._emaMeanSquare = this._emaMeanSquare * 0.5 + sample.meanSquare * 0.5;
                } else {
                    this._emaMeanSquare = sample.meanSquare;
                }
                this._peakEnvelope = sample.peak * sample.peak;
                this._trackChangeBoost = true;
            } else {
                const alpha = AUTO_GAIN_TICK_MS / 2000;
                this._emaMeanSquare =
                    this._emaMeanSquare * (1 - alpha) + sample.meanSquare * alpha;
            }
            this._silenceTicks = 0;

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

            this._applyAutoGainUpdate(rmsDb);
            this._applyAdaptiveUpdate(rmsDb);
        }

        _applyAutoGainUpdate(rmsDb) {
            const ag = this.settings.autoGain;
            if (!ag || !ag.enabled) {
                this._currentAutoGainDb = 0;
                this._trackChangeBoost = false;
                return;
            }

            let gainDb = ag.targetDb - rmsDb;
            if (gainDb > ag.maxBoostDb) gainDb = ag.maxBoostDb;
            if (gainDb < -ag.maxCutDb) gainDb = -ag.maxCutDb;

            this._currentAutoGainDb = gainDb;

            const gain = Math.pow(10, gainDb / 20);
            const baseTau = Math.max(0.05, (ag.responseMs || 500) / 1000 / 3);
            let tau = baseTau;
            if (this._trackChangeBoost) {
                tau = 0.25;
                this._trackChangeBoost = false;
            }
            this._smoothParam(this.nodes.autoGain.gain, gain, tau);
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

            this._smoothParam(this.nodes.compressor.ratio, ratio, 1.0);
            this._smoothParam(this.nodes.compressor.threshold, threshold, 1.0);
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
            root.document.addEventListener('playing', resume, { capture: true });
            root.addEventListener('focus', resume);
            if (this.mediaElement) {
                this.mediaElement.addEventListener('play', resume);
                this.mediaElement.addEventListener('playing', resume);
            }
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
            this._peakEnvelope = 0;
            this._silenceTicks = 0;
            this._trackChangeBoost = false;
            this._currentAutoGainDb = 0;
            this._currentCrestDb = 0;
            this._currentAdaptiveRatio = 0;
            this._currentAdaptiveThresholdDb = 0;
            this._currentRoute = null;
        }
    }

    root.YTMS = root.YTMS || {};
    root.YTMS.AudioEngine = AudioEngine;
})(typeof self !== 'undefined' ? self : window);
