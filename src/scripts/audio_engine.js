(function (root) {
    'use strict';

    const AUTO_GAIN_TICK_MS = 50;
    const SILENCE_GATE_DB = -55;
    const ANALYSER_FFT = 2048;
    const SCAN_PROVISIONAL_MS = 1500;
    const SCAN_LOCK_MS = 12000;
    const SCAN_REFINE_UNTIL_MS = 30000;
    const SCAN_BLOCK_MS = 400;
    const ABSOLUTE_GATE_LUFS = -70;
    const TRUE_PEAK_CEILING_DB = -1;
    const PEAK_LIMITER_TRUST_DB = 8;
    const K_SHELF_FREQ = 1681.97;
    const K_SHELF_GAIN_DB = 3.999;
    const RELATIVE_GATE_LU = -10;
    const K_HPF_FREQ = 38.13;
    const K_HPF_Q = 0.5;
    const PERCEPTUAL_SHELF_FREQ = 250;
    const PERCEPTUAL_SHELF_DEFAULT_DB = 5;
    const PERCEPTUAL_PRESENCE_FREQ = 3150;
    const PERCEPTUAL_PRESENCE_GAIN_DB = 1.0;
    const PERCEPTUAL_PRESENCE_Q = 1.0;

    class AudioEngine {
        constructor() {
            this.context = null;
            this.source = null;
            this.mediaElement = null;
            this.settings = null;
            this.nodes = this._emptyNodes();
            this._attached = false;
            this._analyserKBuffer = null;
            this._analyserPeakBuffer = null;
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
            this._scanPhase = 'idle';
            this._scanBlocks = [];
            this._currentScanBlock = { sumMs: 0, elapsedMs: 0 };
            this._scanElapsedMs = 0;
            this._scanLockedGainDb = 0;
            this._trackElapsedMs = 0;
            this.debugLogs = [];
            this.debugStartTime = Date.now();
        }

        isAttached() {
            return this._attached;
        }

        isSameElement(el) {
            return this.mediaElement === el;
        }

        getMediaElement() {
            return this.mediaElement;
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

        resetScan() {
            this._resetScanState();
            this._scanPhase = 'scanning';
            this._currentAutoGainDb = 0;
            this._emaMeanSquare = 0;
            this._peakEnvelope = 0;
            this._silenceTicks = 0;
            if (this.nodes.autoGain) {
                this._smoothParam(this.nodes.autoGain.gain, 1.0, 0.15);
            }
        }

        resetForTrackChange() {
            this._emaMeanSquare = 0;
            this._peakEnvelope = 0;
            this._silenceTicks = 0;
            this._trackChangeBoost = true;
            this._trackElapsedMs = 0;
            if (this.settings && this.settings.autoGain && this.settings.autoGain.mode === 'scan') {
                this._resetScanState();
                this._scanPhase = 'scanning';
                this._currentAutoGainDb = 0;
                if (this.nodes.autoGain) {
                    this._smoothParam(this.nodes.autoGain.gain, 1.0, 0.15);
                }
            }
        }

        _resetScanState() {
            this._scanPhase = 'idle';
            this._scanBlocks = [];
            this._currentScanBlock = { sumMs: 0, elapsedMs: 0 };
            this._scanElapsedMs = 0;
            this._scanLockedGainDb = 0;
        }

        getScanPhase() {
            return this._scanPhase;
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

            this._applyPerceptual(settings.perceptual);

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

            const newMode = settings.autoGain ? (settings.autoGain.mode || 'realtime') : 'realtime';
            if (newMode !== 'scan' && this._scanPhase !== 'idle') {
                this._resetScanState();
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
                contextState: this.context ? this.context.state : 'unknown',
                scanPhase: this._scanPhase
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
                analyserK: null,
                analyserPeak: null,
                kFilterShelf: null,
                kFilterHpf: null,
                kFilterPerceptual: null,
                kFilterPresence: null,
                muteSink: null,
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

            this.nodes.kFilterShelf = ctx.createBiquadFilter();
            this.nodes.kFilterShelf.type = 'highshelf';
            this.nodes.kFilterShelf.frequency.value = K_SHELF_FREQ;
            this.nodes.kFilterShelf.gain.value = K_SHELF_GAIN_DB;

            this.nodes.kFilterHpf = ctx.createBiquadFilter();
            this.nodes.kFilterHpf.type = 'highpass';
            this.nodes.kFilterHpf.frequency.value = K_HPF_FREQ;
            this.nodes.kFilterHpf.Q.value = K_HPF_Q;

            this.nodes.kFilterPerceptual = ctx.createBiquadFilter();
            this.nodes.kFilterPerceptual.type = 'lowshelf';
            this.nodes.kFilterPerceptual.frequency.value = PERCEPTUAL_SHELF_FREQ;
            this.nodes.kFilterPerceptual.gain.value = -PERCEPTUAL_SHELF_DEFAULT_DB;

            this.nodes.kFilterPresence = ctx.createBiquadFilter();
            this.nodes.kFilterPresence.type = 'peaking';
            this.nodes.kFilterPresence.frequency.value = PERCEPTUAL_PRESENCE_FREQ;
            this.nodes.kFilterPresence.Q.value = PERCEPTUAL_PRESENCE_Q;
            this.nodes.kFilterPresence.gain.value = PERCEPTUAL_PRESENCE_GAIN_DB;

            this.nodes.analyserK = ctx.createAnalyser();
            this.nodes.analyserK.fftSize = ANALYSER_FFT;
            this.nodes.analyserK.smoothingTimeConstant = 0;
            this._analyserKBuffer = new Float32Array(this.nodes.analyserK.fftSize);

            this.nodes.analyserPeak = ctx.createAnalyser();
            this.nodes.analyserPeak.fftSize = ANALYSER_FFT;
            this.nodes.analyserPeak.smoothingTimeConstant = 0;
            this._analyserPeakBuffer = new Float32Array(this.nodes.analyserPeak.fftSize);

            this.nodes.muteSink = ctx.createGain();
            this.nodes.muteSink.gain.value = 0;

            this.nodes.autoGain = ctx.createGain();
            this.nodes.autoGain.gain.value = 1.0;

            this.nodes.compressor = ctx.createDynamicsCompressor();
            this.nodes.makeup = ctx.createGain();
            this.nodes.limiter = ctx.createDynamicsCompressor();

            this.nodes.output = ctx.createGain();
            this.nodes.output.gain.value = 1.0;

            this.source.connect(this.nodes.input);
            this.source.connect(this.nodes.kFilterShelf);
            this.source.connect(this.nodes.analyserPeak);
        }

        _connectAnalysisTaps() {
            const n = this.nodes;
            n.kFilterShelf.connect(n.kFilterHpf);
            n.kFilterHpf.connect(n.kFilterPerceptual);
            n.kFilterPerceptual.connect(n.kFilterPresence);
            n.kFilterPresence.connect(n.analyserK);
            n.analyserK.connect(n.muteSink);
            n.analyserPeak.connect(n.muteSink);
            n.muteSink.connect(this.context.destination);
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
            this._connectAnalysisTaps();
        }

        _routeBypass() {
            this._disconnectChain();
            this.nodes.input.connect(this.nodes.output);
            this.nodes.output.connect(this.context.destination);
            this._connectAnalysisTaps();
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
            let gains;
            if (eq && Array.isArray(eq.gains)) {
                gains = eq.gains;
            } else {
                const presets = root.YTMS && root.YTMS.Presets && root.YTMS.Presets.EQ_PRESETS;
                const id = (eq && eq.id) ? eq.id : 'flat';
                const preset = (presets && presets[id]) || (presets && presets.flat);
                gains = preset ? preset.gains : [0, 0, 0, 0, 0];
            }
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

        _applyPerceptual(p) {
            if (!this.nodes.kFilterPerceptual) return;
            const enabled = !p || p.enabled !== false;
            const rawDb = p && typeof p.bassAttenDb === 'number'
                ? p.bassAttenDb
                : PERCEPTUAL_SHELF_DEFAULT_DB;
            const atten = enabled ? Math.max(0, Math.min(12, rawDb)) : 0;
            this._smoothParam(this.nodes.kFilterPerceptual.gain, -atten, 0.05);
        }

        _applyAutoGain(ag) {
            if (!ag || !ag.enabled) {
                this._smoothParam(this.nodes.autoGain.gain, 1, 0.2);
                this._currentAutoGainDb = 0;
                this._resetScanState();
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

            const mode = (this.settings.autoGain && this.settings.autoGain.mode) || 'realtime';
            if (mode === 'scan') {
                this._scanAutoGainTick();
                return;
            }

            const sample = this._sampleAudio();
            if (sample === null) return;

            const instDb = 10 * Math.log10(Math.max(sample.meanSquare, 1e-12));

            const peakSquared = sample.peak * sample.peak;
            if (peakSquared > this._peakEnvelope) {
                this._peakEnvelope = peakSquared;
            } else {
                const decay = Math.exp(-AUTO_GAIN_TICK_MS / 2000);
                this._peakEnvelope = this._peakEnvelope * decay;
            }

            if (instDb < SILENCE_GATE_DB) {
                this._silenceTicks = (this._silenceTicks || 0) + 1;
                this._pushDebugLog(instDb);
                return;
            }

            const longSilence = (this._silenceTicks || 0) > (3000 / AUTO_GAIN_TICK_MS);
            if (longSilence || this._emaMeanSquare === 0) {
                if (this._emaMeanSquare > 0) {
                    this._emaMeanSquare = this._emaMeanSquare * 0.5 + sample.meanSquare * 0.5;
                } else {
                    this._emaMeanSquare = sample.meanSquare;
                }
                this._trackChangeBoost = true;
            } else {
                this._trackElapsedMs += AUTO_GAIN_TICK_MS;
                // Fast settling for the first 10s of each track (inter-song leveling),
                // then very slow to preserve intra-song dynamics without pumping.
                const alpha = this._trackElapsedMs < 10000
                    ? AUTO_GAIN_TICK_MS / 2000
                    : AUTO_GAIN_TICK_MS / 30000;
                this._emaMeanSquare =
                    this._emaMeanSquare * (1 - alpha) + sample.meanSquare * alpha;
            }
            this._silenceTicks = 0;

            const rmsDb = 10 * Math.log10(Math.max(this._emaMeanSquare, 1e-12));
            const peakDb = 10 * Math.log10(Math.max(this._peakEnvelope, 1e-12));
            this._currentCrestDb = Math.max(0, peakDb - rmsDb);

            this._applyAutoGainUpdate(rmsDb);
            this._applyAdaptiveUpdate(rmsDb);
            this._pushDebugLog(rmsDb);
        }

        _scanAutoGainTick() {
            const ag = this.settings.autoGain;
            if (!ag || !ag.enabled) {
                this._resetScanState();
                this._currentAutoGainDb = 0;
                return;
            }

            const sample = this._sampleAudio();
            if (sample === null) return;

            const instDb = 10 * Math.log10(Math.max(sample.meanSquare, 1e-12));

            const peakSquared = sample.peak * sample.peak;
            if (peakSquared > this._peakEnvelope) {
                this._peakEnvelope = peakSquared;
            } else {
                const decay = Math.exp(-AUTO_GAIN_TICK_MS / 2000);
                this._peakEnvelope = this._peakEnvelope * decay;
            }

            if (instDb < SILENCE_GATE_DB) {
                this._silenceTicks = (this._silenceTicks || 0) + 1;
                this._pushDebugLog(instDb);
                return;
            }
            this._silenceTicks = 0;

            this._currentScanBlock.sumMs += sample.meanSquare * AUTO_GAIN_TICK_MS;
            this._currentScanBlock.elapsedMs += AUTO_GAIN_TICK_MS;
            this._scanElapsedMs += AUTO_GAIN_TICK_MS;

            if (this._currentScanBlock.elapsedMs >= SCAN_BLOCK_MS) {
                const blockMs = this._currentScanBlock.sumMs / this._currentScanBlock.elapsedMs;
                this._scanBlocks.push(blockMs);
                this._currentScanBlock = { sumMs: 0, elapsedMs: 0 };
            }

            if (this._scanPhase !== 'scanning' && this._scanPhase !== 'locked') {
                this._scanPhase = 'scanning';
            }

            const integratedMs = this._computeGatedLoudness(this._scanBlocks);
            if (integratedMs === null) {
                this._pushDebugLog(instDb);
                return;
            }

            const integratedDb = 10 * Math.log10(Math.max(integratedMs, 1e-12));
            this._emaMeanSquare = integratedMs;
            const peakDb = 10 * Math.log10(Math.max(this._peakEnvelope, 1e-12));
            this._currentCrestDb = Math.max(0, peakDb - integratedDb);

            const crestAdjust = Math.max(0, (this._currentCrestDb - 12) * 0.45);
            let gainDb = (ag.targetDb - crestAdjust) - integratedDb;
            if (gainDb > ag.maxBoostDb) gainDb = ag.maxBoostDb;
            if (gainDb < -ag.maxCutDb) gainDb = -ag.maxCutDb;

            const headroom = TRUE_PEAK_CEILING_DB - peakDb + PEAK_LIMITER_TRUST_DB;
            if (gainDb > headroom) gainDb = headroom;

            if (this._scanPhase === 'locked') {
                if (this._scanElapsedMs <= SCAN_REFINE_UNTIL_MS) {
                    const blend = 0.05;
                    const refined = this._scanLockedGainDb * (1 - blend) + gainDb * blend;
                    this._scanLockedGainDb = refined;
                    this._currentAutoGainDb = refined;
                    const gain = Math.pow(10, refined / 20);
                    this._smoothParam(this.nodes.autoGain.gain, gain, 1.5);
                }
            } else if (this._scanElapsedMs >= SCAN_LOCK_MS) {
                this._currentAutoGainDb = gainDb;
                this._scanLockedGainDb = gainDb;
                const gain = Math.pow(10, gainDb / 20);
                this._smoothParam(this.nodes.autoGain.gain, gain, 0.3);
                this._scanPhase = 'locked';
            } else if (this._scanElapsedMs >= SCAN_PROVISIONAL_MS) {
                this._currentAutoGainDb = gainDb;
                const gain = Math.pow(10, gainDb / 20);
                this._smoothParam(this.nodes.autoGain.gain, gain, 0.5);
            }

            this._pushDebugLog(integratedDb);
        }

        _computeGatedLoudness(blocks) {
            if (!blocks || blocks.length === 0) return null;

            const absThresholdMs = Math.pow(10, ABSOLUTE_GATE_LUFS / 10);
            const stage1 = blocks.filter(b => b >= absThresholdMs);
            if (stage1.length === 0) {
                const sum = blocks.reduce((a, b) => a + b, 0);
                return sum / blocks.length;
            }

            const ungatedMean = stage1.reduce((a, b) => a + b, 0) / stage1.length;
            const ungatedDb = 10 * Math.log10(Math.max(ungatedMean, 1e-12));

            const relThresholdDb = ungatedDb + RELATIVE_GATE_LU;
            const relThresholdMs = Math.pow(10, relThresholdDb / 10);
            const stage2 = stage1.filter(b => b >= relThresholdMs);
            if (stage2.length === 0) return ungatedMean;

            return stage2.reduce((a, b) => a + b, 0) / stage2.length;
        }

        _pushDebugLog(rmsDb) {
            if (!this.debugLogs) this.debugLogs = [];
            const ag = this.settings ? this.settings.autoGain : null;
            const compRed = this.nodes.compressor ? this.nodes.compressor.reduction : 0;
            const limRed = this.nodes.limiter ? this.nodes.limiter.reduction : 0;
            const outDb = rmsDb + this._currentAutoGainDb + compRed + limRed;
            const fix = (v) => isFinite(v) ? Number(v.toFixed(2)) : v;
            const peakDb = this._peakEnvelope > 0
                ? 10 * Math.log10(this._peakEnvelope)
                : -Infinity;

            this.debugLogs.push({
                timestamp: Date.now(),
                elapsed: Date.now() - this.debugStartTime,
                inputDb: fix(rmsDb),
                targetDb: (ag && ag.enabled) ? ag.targetDb : null,
                appliedGainDb: fix(this._currentAutoGainDb),
                estimatedOutputDb: fix(outDb),
                truePeakDb: isFinite(peakDb) ? fix(peakDb) : null,
                crestDb: fix(this._currentCrestDb),
                adaptiveRatio: fix(this._currentAdaptiveRatio),
                adaptiveThresholdDb: fix(this._currentAdaptiveThresholdDb),
                scanPhase: this._scanPhase,
                scanBlocks: this._scanBlocks ? this._scanBlocks.length : 0,
                silenceTicks: this._silenceTicks,
                compressorReduction: fix(compRed),
                limiterReduction: fix(limRed)
            });
            if (this.debugLogs.length > 720000) {
                this.debugLogs.shift();
            }
        }

        getDebugLogs() {
            return this.debugLogs || [];
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

            const peakDb = this._peakEnvelope > 0
                ? 10 * Math.log10(this._peakEnvelope)
                : -Infinity;
            if (isFinite(peakDb)) {
                const headroom = TRUE_PEAK_CEILING_DB - peakDb + PEAK_LIMITER_TRUST_DB;
                if (gainDb > headroom) gainDb = headroom;
            }

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
            const analyserK = this.nodes.analyserK;
            const analyserPeak = this.nodes.analyserPeak;
            if (!analyserK || !analyserPeak || !this._analyserKBuffer || !this._analyserPeakBuffer) return null;

            analyserK.getFloatTimeDomainData(this._analyserKBuffer);
            analyserPeak.getFloatTimeDomainData(this._analyserPeakBuffer);

            let sumSquaresK = 0;
            const bufK = this._analyserKBuffer;
            for (let i = 0; i < bufK.length; i++) {
                sumSquaresK += bufK[i] * bufK[i];
            }

            let peak = 0;
            const bufP = this._analyserPeakBuffer;
            for (let i = 0; i < bufP.length; i++) {
                const v = bufP[i];
                const abs = v < 0 ? -v : v;
                if (abs > peak) peak = abs;
            }

            return {
                meanSquare: sumSquaresK / bufK.length,
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
            this._analyserKBuffer = null;
            this._analyserPeakBuffer = null;
            this._emaMeanSquare = 0;
            this._peakEnvelope = 0;
            this._silenceTicks = 0;
            this._trackChangeBoost = false;
            this._currentAutoGainDb = 0;
            this._currentCrestDb = 0;
            this._currentAdaptiveRatio = 0;
            this._currentAdaptiveThresholdDb = 0;
            this._currentRoute = null;
            this._trackElapsedMs = 0;
            this._resetScanState();
        }
    }

    root.YTMS = root.YTMS || {};
    root.YTMS.AudioEngine = AudioEngine;
})(typeof self !== 'undefined' ? self : window);
