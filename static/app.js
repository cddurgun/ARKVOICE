// DOM Elements
const canvas = document.getElementById('waveformCanvas');
const ctx = canvas.getContext('2d');
const micButton = document.getElementById('micButton');
const micGlow = document.getElementById('micGlow');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const transcriptText = document.getElementById('transcriptText');
const responseText = document.getElementById('responseText');
const transcriptBox = document.querySelector('.transcript-box');
const responseBox = document.querySelector('.response-box');
const responseAudio = document.getElementById('responseAudio');

// State
let ws = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let animationId = null;
let isActive = false;
let stream = null;
let silenceTimeout = null;
let audioContext = null;
let analyser = null;
let isSpeaking = false;
let silenceStart = null;
let speechStart = null;
let aiSpeaking = false; // pause VAD while AI is talking
let audioMime = null;   // selected recording MIME type
let requestStartTime = null; // Track latency
const SILENCE_THRESHOLD = 0.015; // Adjust sensitivity (higher = less sensitive)
const SILENCE_DURATION = 400; // 0.4 seconds of silence to stop (FASTER)
const MIN_SPEECH_DURATION = 300; // Minimum 0.3s of speech required
const AMP_THRESHOLD = 0.006; // Time-domain RMS threshold for VAD (more sensitive)
// Dynamic VAD thresholds (adaptive noise floor + hysteresis)
const BASE_NOISE_FLOOR = 0.004; // starting baseline
let noiseFloor = BASE_NOISE_FLOOR;
const NOISE_ADAPT = 0.05; // 0..1 (higher adapts faster)
const START_DELTA = 0.018; // start when above noise floor + delta
const STOP_DELTA = 0.01; // stop when below noise floor + delta
const BARGE_DELTA = 0.025; // additional margin to trigger barge-in while AI speaking

// Canvas setup
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// Pick a supported MediaRecorder MIME (WebM on Chromium/Firefox, MP4 on Safari)
function pickAudioOptions() {
    const candidates = [
        { mimeType: 'audio/webm;codecs=opus' },
        { mimeType: 'audio/webm' },
        { mimeType: 'audio/mp4;codecs=mp4a.40.2' },
        { mimeType: 'audio/mp4' },
        {}
    ];
    for (const opt of candidates) {
        if (!opt.mimeType || (window.MediaRecorder && MediaRecorder.isTypeSupported(opt.mimeType))) {
            return opt;
        }
    }
    return {};
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Waveform animation
class Waveform {
    constructor() {
        this.waves = [];
        this.particles = [];
        this.time = 0;
        
        // Create waves
        for (let i = 0; i < 3; i++) {
            this.waves.push({
                amplitude: 50 + i * 30,
                frequency: 0.01 + i * 0.005,
                phase: i * Math.PI / 3,
                color: `rgba(${100 + i * 50}, ${150 + i * 30}, 255, ${0.3 - i * 0.1})`
            });
        }
    }
    
    update() {
        this.time += 0.02;
    }
    
    draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        const centerY = canvas.height / 2;
        const centerX = canvas.width / 2;
        
        // Draw waves
        this.waves.forEach((wave, index) => {
            ctx.beginPath();
            ctx.strokeStyle = wave.color;
            ctx.lineWidth = 3;
            
            for (let x = 0; x < canvas.width; x += 5) {
                const distanceFromCenter = Math.abs(x - centerX);
                const fadeOut = Math.max(0, 1 - distanceFromCenter / (canvas.width / 2));
                
                const y = centerY + Math.sin(x * wave.frequency + this.time + wave.phase) * 
                          wave.amplitude * fadeOut;
                
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            
            ctx.stroke();
        });
        
        // Draw particles when recording
        if (isRecording) {
            this.drawParticles();
        }
    }
    
    drawParticles() {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        
        // Add new particles
        if (Math.random() > 0.7) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 3;
            this.particles.push({
                x: centerX,
                y: centerY,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1
            });
        }
        
        // Update and draw particles
        this.particles = this.particles.filter(p => {
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.02;
            
            if (p.life > 0) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(100, 200, 255, ${p.life})`;
                ctx.fill();
                return true;
            }
            return false;
        });
    }
}

const waveform = new Waveform();

function animate() {
    waveform.update();
    waveform.draw();
    animationId = requestAnimationFrame(animate);
}
animate();

// WebSocket connection
let reconnectTimer = null;

function connect() {
    // Clear any existing reconnect timer
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    
    // Close existing connection if any
    if (ws) {
        console.log('🔌 Closing existing WebSocket...');
        try {
            ws.close();
        } catch (e) {
            console.warn('⚠️ Error closing old WebSocket:', e);
        }
        ws = null;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    console.log('🔌 Connecting to WebSocket:', wsUrl);
    
    try {
        ws = new WebSocket(wsUrl);
    } catch (error) {
        console.error('❌ WebSocket creation failed:', error);
        statusText.textContent = '❌ Connection error. Refresh page.';
        return;
    }
    
    ws.onopen = () => {
        console.log('✅ WebSocket connected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Connected – click the mic to start';
        reconnectAttempts = 0;
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'search_started') {
            // Play search sound (like OpenAI Voice)
            playSearchSound();
            statusText.textContent = '🔍 Searching the web...';
            console.log('🔍 Web search initiated');
        } else if (data.type === 'transcription') {
            transcriptText.textContent = data.text;
            transcriptBox.classList.add('show');
            const transcriptionTime = Date.now() - requestStartTime;
            console.log(`⏱️ Transcription time: ${transcriptionTime}ms`);
        } else if (data.type === 'response') {
            const aiResponseTime = Date.now() - requestStartTime;
            console.log(`⏱️ AI response time: ${aiResponseTime}ms`);
            responseText.textContent = data.text;
            responseBox.classList.add('show');
            
            // Stop recording while AI is speaking
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                isSpeaking = false;
            }
            statusText.textContent = 'AI is speaking...'
            
        } else if (data.type === 'audio') {
            const totalLatency = Date.now() - requestStartTime;
            console.log(`⏱️ TOTAL LATENCY: ${totalLatency}ms (${(totalLatency/1000).toFixed(2)}s)`);
            // AI is about to speak; pause VAD triggers
            aiSpeaking = true;
            // Play response audio
            playAudio(data.audio);
            // Update status text
            statusText.textContent = 'AI is speaking...';
        
        } else if (data.type === 'error') {
            console.error('Server error:', data.message);
            statusText.textContent = 'Error: ' + data.message;
            if (isActive) {
                // gently resume listening state after showing the error
                setTimeout(() => {
                    statusText.textContent = 'Ready - Start speaking...';
                }, 2000);
            }
        }
    };
    
    ws.onerror = () => {
        statusText.textContent = 'Connection error';
        statusDot.classList.remove('connected');
    };
    
    ws.onclose = (event) => {
        console.log(`🔌 WebSocket closed: code=${event.code}, clean=${event.wasClean}`);
        statusDot.classList.remove('connected', 'listening');
        
        // Deactivate mic if it was active
        if (isActive) {
            console.log('🛑 Deactivating due to WebSocket close');
            deactivateConversation();
        }
        
        // Auto-reconnect if page is still active
        if (!event.wasClean && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 5000);
            console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            statusText.textContent = `Reconnecting in ${(delay/1000).toFixed(1)}s...`;
            reconnectTimer = setTimeout(() => {
                reconnectAttempts++;
                connect();
            }, delay);
        } else {
            statusText.textContent = 'Disconnected - Refresh page';
        }
    };
}

// Ensure WS is OPEN before proceeding
function ensureWebSocketOpen(timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        if (!ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
            console.log('🔄 WebSocket not open, reconnecting...');
            connect();
        }

        const check = () => {
            if (ws && ws.readyState === WebSocket.OPEN) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error('WebSocket open timeout'));
            setTimeout(check, 100);
        };
        check();
    });
}

// Audio recording - Click to toggle conversational mode
micButton.addEventListener('click', async () => {
    console.log('🖱️ Mic button clicked, isActive:', isActive);
    
    if (isActive) {
        console.log('🛑 Deactivating...');
        await deactivateConversation();
    } else {
        console.log('▶️ Activating...');
        await activateConversation();
    }
});

async function activateConversation() {
    console.log('🎤 Activating VOICE AI...');
    
    // Prevent double activation
    if (isActive) {
        console.log('⚠️ Already active, ignoring');
        return;
    }
    
    try {
        // CRITICAL: Ensure WebSocket is ready
        console.log('🔌 Checking WebSocket state:', ws ? ws.readyState : 'null');
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log('⚠️ WebSocket not ready, connecting...');
            statusText.textContent = 'Connecting to server...';
            
            try {
                await ensureWebSocketOpen();
                console.log('✅ WebSocket connected');
            } catch (wsError) {
                console.error('❌ WebSocket connection failed:', wsError);
                statusText.textContent = '❌ Connection failed. Refresh page.';
                return; // Don't proceed without WebSocket
            }
        }
        
        // Reset ALL state for clean activation
        console.log('♻️ Resetting state...');
        isSpeaking = false;
        isRecording = false;
        aiSpeaking = false;
        silenceStart = null;
        speechStart = null;
        audioChunks = [];
        noiseFloor = BASE_NOISE_FLOOR;

        // Clean up old audio context
        if (audioContext) {
            console.log('🧹 Cleaning up old audio context');
            try { 
                if (audioContext.state !== 'closed') {
                    await audioContext.close();
                }
            } catch (e) {
                console.warn('⚠️ Error closing audio context:', e);
            }
            audioContext = null;
            analyser = null;
        }
        
        // Clean up old stream
        if (stream) {
            console.log('🧹 Cleaning up old stream');
            stream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
            stream = null;
        }
        
        // Enable audio playback (critical for autoplay)
        try {
            console.log('🔊 Unlocking audio playback...');
            await responseAudio.play();
            responseAudio.pause();
            responseAudio.currentTime = 0;
            console.log('✅ Audio element unlocked');
        } catch (e) {
            console.warn('⚠️ Audio autoplay blocked:', e);
        }
        
        // Request microphone access
        console.log('🎤 Requesting microphone access...');
        statusText.textContent = 'Allow microphone access...';
        
        // Check if getUserMedia is supported
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            console.error('❌ getUserMedia not supported');
            statusText.textContent = '❌ Browser does not support microphone access';
            return;
        }
        
        try {
            console.log('📞 Calling getUserMedia...');
            stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            console.log('✅ Microphone access granted');
            
            // Verify we got tracks
            const tracks = stream.getAudioTracks();
            console.log(`📊 Audio tracks received: ${tracks.length}`);
            
            if (tracks.length === 0) {
                throw new Error('No audio tracks in stream');
            }
            
            const track = tracks[0];
            console.log(`🎤 Using: ${track.label || 'Default microphone'}`);
            console.log(`🎤 Track state: ${track.readyState}, enabled: ${track.enabled}`);
            
        } catch (micError) {
            console.error('❌ Microphone error:', micError);
            console.error('Error name:', micError.name);
            console.error('Error message:', micError.message);
            
            if (micError.name === 'NotAllowedError') {
                statusText.textContent = '❌ Microphone denied. Allow in browser and click again.';
            } else if (micError.name === 'NotFoundError') {
                statusText.textContent = '❌ No microphone found. Connect one and try again.';
            } else if (micError.name === 'NotReadableError') {
                statusText.textContent = '❌ Microphone in use. Close other apps and try again.';
            } else {
                statusText.textContent = `❌ Mic error: ${micError.message}`;
            }
            await deactivateConversation();
            return;
        }
        
        // Setup audio processing
        console.log('🔧 Setting up audio processing...');
        statusText.textContent = 'Initializing audio...';
        
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('🔊 AudioContext state:', audioContext.state);
            
            if (audioContext.state === 'suspended') {
                console.log('⏸️ AudioContext suspended, resuming...');
                await audioContext.resume();
                console.log('▶️ AudioContext resumed');
            }
            
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.3;
            
            const source = audioContext.createMediaStreamSource(stream);
            source.connect(analyser);
            console.log('✅ Audio pipeline connected');
            
        } catch (audioError) {
            console.error('❌ Audio processing error:', audioError);
            statusText.textContent = `❌ Audio setup failed: ${audioError.message}`;
            await deactivateConversation();
            return;
        }
        
        // Activate UI and state
        isActive = true;
        micButton.classList.add('recording');
        micGlow.classList.add('active');
        statusDot.classList.add('listening');
        statusText.textContent = '✅ Listening... Speak now!';
        console.log('✅ VOICE AI FULLY ACTIVE');
        
        // Start VAD monitoring
        monitorVoiceActivity();
            
    } catch (error) {
        console.error('❌ Activation failed:', error);
        statusText.textContent = `❌ Error: ${error.message}`;
        await deactivateConversation();
    }
}

function monitorVoiceActivity() {
    if (!isActive || !analyser) return;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    function checkAudio() {
        if (!isActive || !analyser) return;

        // Get time-domain data and compute RMS
        analyser.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < bufferLength; i++) {
            const v = (dataArray[i] - 128) / 128; // normalize -1..1
            sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / bufferLength); // 0..~1
        
        // Debug: Log audio levels every 30 frames (~500ms)
        if (Math.random() < 0.033) {
            console.log(`🎚️ Audio level: ${(rms * 100).toFixed(1)}% | Noise: ${(noiseFloor * 100).toFixed(1)}% | Speaking: ${isSpeaking}`);
        }

        // Adapt noise floor when not currently speaking and AI not speaking
        if (!isSpeaking && !aiSpeaking) {
            noiseFloor = (1 - NOISE_ADAPT) * noiseFloor + NOISE_ADAPT * rms;
            // clamp
            if (noiseFloor < 0.001) noiseFloor = 0.001;
            if (noiseFloor > 0.05) noiseFloor = 0.05;
        }

        const startThresh = Math.min(noiseFloor + START_DELTA, 0.2);
        const stopThresh = Math.min(noiseFloor + STOP_DELTA, 0.2);

        // Detect speech using adaptive thresholds + hysteresis
        const bargeThresh = startThresh + BARGE_DELTA;
        const crossed = (!aiSpeaking && rms > startThresh) || (aiSpeaking && rms > bargeThresh);
        
        // Debug when speech detected
        if (crossed && !isSpeaking) {
            console.log(`🎤 SPEECH DETECTED! RMS: ${(rms * 100).toFixed(1)}% > Threshold: ${(startThresh * 100).toFixed(1)}%`);
        }
        if (crossed) {
            // Barge-in: if AI is speaking, pause it immediately and give priority to the user
            if (responseAudio && !responseAudio.paused && !responseAudio.ended) {
                try { responseAudio.pause(); } catch (e) { console.log('Pause audio error:', e); }
                aiSpeaking = false;
            }
            if (!isSpeaking && !isRecording) {
                // Speech started!
                isSpeaking = true;
                silenceStart = null;
                speechStart = Date.now();
                startRecording();
                statusText.textContent = '🎤 Listening...';
            } else if (isSpeaking) {
                // Still speaking, reset silence timer
                silenceStart = null;
            }
        } else {
            // Silence detected
            if (isSpeaking && isRecording) {
                if (rms < stopThresh) {
                    if (!silenceStart) {
                        silenceStart = Date.now();
                    } else if (Date.now() - silenceStart > SILENCE_DURATION) {
                        // Check if speech was long enough
                        const speechDuration = Date.now() - speechStart;
                        if (speechDuration >= MIN_SPEECH_DURATION) {
                            // Silence long enough, stop recording
                            isSpeaking = false;
                            stopRecording();
                            statusText.textContent = '⚡ Processing...';
                        } else {
                            // Too short, ignore
                            isSpeaking = false;
                            if (mediaRecorder && mediaRecorder.state === 'recording') {
                                mediaRecorder.stop();
                            }
                            isRecording = false;
                            statusText.textContent = 'Ready - Start speaking...';
                        }
                    }
                }
            }
        }

        requestAnimationFrame(checkAudio);
    }

    checkAudio();
}

async function deactivateConversation() {
    console.log('🛑 Deactivating conversation...');

    // Reset ALL state flags immediately
    isActive = false;
    isSpeaking = false;
    isRecording = false;
    aiSpeaking = false;
    silenceStart = null;
    speechStart = null;
    noiseFloor = BASE_NOISE_FLOOR;
    requestStartTime = null;

    // Stop audio playback
    if (responseAudio) {
        try {
            responseAudio.pause();
            responseAudio.currentTime = 0;
            responseAudio.src = '';
            console.log('🔇 Audio element reset');
        } catch (error) {
            console.warn('⚠️ Audio reset error:', error);
        }
    }

    // Stop media recorder
    if (mediaRecorder) {
        try {
            if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                console.log('⏹️ MediaRecorder stopped');
            }
        } catch (error) {
            console.warn('⚠️ MediaRecorder stop error:', error);
        }
        mediaRecorder = null;
        audioMime = null;
    }

    // Clear any timeouts
    if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
    }

    // Stop microphone stream
    if (stream) {
        console.log('🎤 Stopping microphone stream...');
        try {
            stream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
                console.log(`  Stopped track: ${track.label}`);
            });
        } catch (error) {
            console.warn('⚠️ Stream stop error:', error);
        }
        stream = null;
    }

    // Close audio context
    if (audioContext) {
        console.log('🔊 Closing audio context...');
        try {
            if (audioContext.state !== 'closed') {
                await audioContext.close();
                console.log('  AudioContext closed');
            }
        } catch (error) {
            console.warn('⚠️ AudioContext close error:', error);
        }
        audioContext = null;
    }

    analyser = null;
    audioChunks = [];

    // Reset UI
    micButton.classList.remove('recording');
    micGlow.classList.remove('active');
    statusDot.classList.remove('listening');
    statusText.textContent = 'Connected – click the mic to start';
    
    console.log('✅ Conversation deactivated, ready for reactivation');
}

function startRecording() {
    if (isRecording || !stream) return;
    
    // Use higher quality codec if available
    const options = pickAudioOptions();
    audioMime = options.mimeType || 'audio/webm';
    console.log('🎬 startRecording() with MIME:', audioMime);
    
    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];
    isRecording = true;
    console.log('✅ MediaRecorder started');
    
    mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
            audioChunks.push(event.data);
            console.log('📦 Chunk received:', event.data.size, 'bytes');
        }
    };
    
    mediaRecorder.onstop = async () => {
        isRecording = false;
        console.log('🛑 MediaRecorder stopped');
        
        const audioBlob = new Blob(audioChunks, { type: audioMime || 'audio/webm' });
        console.log('🎧 Audio blob size:', audioBlob.size);
        
        // Check if we have audio data (reduced threshold)
        if (audioBlob.size < 200) {
            console.log('Audio too short, waiting for more speech...');
            if (isActive) {
                statusText.textContent = 'Ready - Start speaking...';
            }
            return;
        }
        
        // Send immediately without waiting
        requestStartTime = Date.now();
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            console.log('🚀 Sending audio to server, base64 length:', base64Audio ? base64Audio.length : 0);
            if (base64Audio && base64Audio.length > 100) {
                ws.send(JSON.stringify({
                    type: 'audio',
                    audio: base64Audio,
                    mime: audioMime
                }));
            }
        };
        reader.readAsDataURL(audioBlob);
    };
    
    // Start recording with timeslice for faster processing
    mediaRecorder.start(25); // 25ms chunks for ultra-low latency
}

function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    console.log('⏹️ stopRecording() invoked');
    
    if (mediaRecorder.state === 'recording') {
        console.log('📨 Requesting MediaRecorder.stop()');
        mediaRecorder.stop();
    }
}

// Removed old startRecording and stopRecording functions

function playAudio(base64Audio) {
    try {
        console.log('🔊 Attempting to play audio, length:', base64Audio.length);
        
        const audioBlob = base64ToBlob(base64Audio, 'audio/mpeg');
        console.log('🔊 Audio blob created, size:', audioBlob.size, 'bytes');
        
        if (audioBlob.size < 100) {
            console.error('Audio blob too small:', audioBlob.size);
            resumeAfterAudio();
            return;
        }
        
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Clear previous audio
        responseAudio.pause();
        responseAudio.currentTime = 0;
        
        // Set new audio
        responseAudio.src = audioUrl;
        
        // When audio starts/ends, manage aiSpeaking and VAD state
        responseAudio.onplay = () => {
            aiSpeaking = true;
            statusText.textContent = '🔊 AI speaking...';
        };
        responseAudio.onended = () => {
            console.log('Audio playback ended');
            URL.revokeObjectURL(audioUrl); // Clean up
            resumeAfterAudio();
        };
        
        responseAudio.onerror = (e) => {
            console.error('Audio element error:', e);
            URL.revokeObjectURL(audioUrl);
            resumeAfterAudio();
        };
        
        // Ensure audio element is ready
        responseAudio.load();
        
        // Play with error handling
        const playPromise = responseAudio.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('✅ Audio playing successfully');
                    statusText.textContent = '🔊 AI speaking...';
                })
                .catch(err => {
                    console.error('❌ Audio play error:', err.name, ':', err.message);
                    
                    // Try to enable audio by user interaction
                    if (err.name === 'NotAllowedError') {
                        statusText.textContent = '⚠️ Click anywhere to enable audio';
                        
                        // Add one-time click listener to enable audio
                        const enableAudio = () => {
                            responseAudio.play()
                                .then(() => {
                                    console.log('Audio enabled after click');
                                    statusText.textContent = '🔊 AI speaking...';
                                })
                                .catch(e => console.error('Still failed:', e));
                            document.removeEventListener('click', enableAudio);
                        };
                        document.addEventListener('click', enableAudio, { once: true });
                    }
                    
                    // Resume VAD even if audio fails
                    setTimeout(() => resumeAfterAudio(), 2000);
                });
        }
    } catch (error) {
        console.error('Error in playAudio:', error);
        resumeAfterAudio();
    }
}

function resumeAfterAudio() {
    if (isActive) {
        statusText.textContent = '✅ Ready - Start speaking...';
        isSpeaking = false;
        silenceStart = null;
        speechStart = null;
        aiSpeaking = false;
    }
}

function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

// Cleanup on page unload - simplified
window.addEventListener('beforeunload', () => {
    console.log('🚪 Page unloading...');
    // Let browser handle cleanup naturally
});

// Cleanup on visibility change (tab switch/minimize)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('👁️ Page hidden');
    } else {
        console.log('👁️ Page visible');
        // Reconnect if needed
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.log('🔄 Reconnecting WebSocket...');
            connect();
        }
    }
});

// Search sound effect (1 second increasing tone)
function playSearchSound() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Create a 1-second increasing tone (500Hz -> 1200Hz)
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(500, audioContext.currentTime); // Start at 500Hz
    oscillator.frequency.linearRampToValueAtTime(1200, audioContext.currentTime + 1.0); // Rise to 1200Hz over 1 second
    
    // Smooth volume envelope
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.25, audioContext.currentTime + 0.1); // Fade in
    gainNode.gain.setValueAtTime(0.25, audioContext.currentTime + 0.9); // Hold
    gainNode.gain.linearRampToValueAtTime(0.01, audioContext.currentTime + 1.0); // Fade out
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 1.0);
}

// Initialize on page load
connect();
console.log('🎙️ Voice AI loaded - Click mic to start');
