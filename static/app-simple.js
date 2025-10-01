// Simple, reliable voice AI - Push to talk
const micButton = document.getElementById('micButton');
const statusText = document.getElementById('statusText');
const transcriptText = document.getElementById('transcriptText');
const responseText = document.getElementById('responseText');
const responseAudio = document.getElementById('responseAudio');

let ws = null;
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

// Connect to WebSocket
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    
    ws.onopen = () => {
        console.log('✅ Connected');
        statusText.textContent = 'HOLD mic button to record';
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('📨 Received:', data.type);
        
        if (data.type === 'transcription') {
            transcriptText.textContent = data.text;
        } else if (data.type === 'response') {
            responseText.textContent = data.text;
        } else if (data.type === 'audio') {
            playAudio(data.audio);
        } else if (data.type === 'error') {
            statusText.textContent = 'Error: ' + data.message;
        }
    };
    
    ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        statusText.textContent = 'Connection error';
    };
    
    ws.onclose = () => {
        console.log('🔌 Disconnected');
        statusText.textContent = 'Disconnected - Refresh page';
    };
}

// Start recording on mouse/touch down
micButton.addEventListener('mousedown', startRecording);
micButton.addEventListener('touchstart', startRecording);

// Stop recording on mouse/touch up
micButton.addEventListener('mouseup', stopRecording);
micButton.addEventListener('touchend', stopRecording);
micButton.addEventListener('mouseleave', stopRecording);

async function startRecording(e) {
    e.preventDefault();
    
    if (isRecording) return;
    
    console.log('🎤 Starting recording...');
    statusText.textContent = 'Recording... (release to send)';
    micButton.classList.add('recording');
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            console.log('🛑 Recording stopped');
            statusText.textContent = 'Processing...';
            
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            console.log('📦 Audio blob:', audioBlob.size, 'bytes');
            
            if (audioBlob.size < 100) {
                statusText.textContent = 'Recording too short';
                micButton.classList.remove('recording');
                return;
            }
            
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64Audio = reader.result.split(',')[1];
                console.log('📤 Sending to server...');
                
                ws.send(JSON.stringify({
                    type: 'audio',
                    audio: base64Audio,
                    mime: 'audio/webm'
                }));
            };
            reader.readAsDataURL(audioBlob);
            
            stream.getTracks().forEach(track => track.stop());
            micButton.classList.remove('recording');
        };
        
        mediaRecorder.start();
        isRecording = true;
        console.log('✅ Recording started');
        
    } catch (error) {
        console.error('❌ Mic error:', error);
        statusText.textContent = 'Microphone error: ' + error.message;
        micButton.classList.remove('recording');
    }
}

function stopRecording(e) {
    e.preventDefault();
    
    if (!isRecording || !mediaRecorder) return;
    
    console.log('⏹️ Stopping recording...');
    mediaRecorder.stop();
    isRecording = false;
}

function playAudio(base64Audio) {
    console.log('🔊 Playing audio...');
    
    const audioBlob = base64ToBlob(base64Audio, 'audio/mpeg');
    const audioUrl = URL.createObjectURL(audioBlob);
    
    responseAudio.src = audioUrl;
    responseAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        statusText.textContent = 'HOLD mic button to record';
    };
    
    responseAudio.play()
        .then(() => console.log('✅ Audio playing'))
        .catch(err => {
            console.error('❌ Audio play error:', err);
            statusText.textContent = 'Click anywhere to enable audio';
            document.addEventListener('click', () => {
                responseAudio.play();
            }, { once: true });
        });
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

// Initialize
connectWebSocket();
console.log('🎙️ Simple Voice AI Ready - HOLD mic button to record');
