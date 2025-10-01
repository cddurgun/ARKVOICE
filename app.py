import asyncio
import json
import base64
import os
import tempfile
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
import edge_tts
import logging
from dotenv import load_dotenv
import httpx

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")
groq_client = Groq(api_key=GROQ_API_KEY)
VOICE = "en-US-JennyNeural"

# Perplexity web search function
async def search_web_perplexity(query: str) -> str:
    """Search the web using Perplexity API"""
    if not PERPLEXITY_API_KEY:
        return "Web search is not configured."
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.perplexity.ai/chat/completions",
                headers={
                    "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "sonar",
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant. Provide concise, accurate answers based on current web information. Keep responses brief (2-3 sentences max). Do NOT include citation numbers, brackets, or reference markers in your response. Speak naturally without mentioning sources."
                        },
                        {
                            "role": "user",
                            "content": query
                        }
                    ],
                    "temperature": 0.2,
                    "max_tokens": 150
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"]
            else:
                logger.error(f"Perplexity error: {response.status_code}")
                return "Web search failed. Using local knowledge instead."
                
    except Exception as e:
        logger.error(f"Perplexity search error: {e}")
        return "Web search unavailable. Using local knowledge instead."

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    client_id = id(websocket)
    temp_dir = None
    
    try:
        await websocket.accept()
        logger.info(f"✅ Client {client_id} connected")
        
        conversation = [{"role": "system", "content": "You are a helpful AI assistant. Keep responses very brief (1-2 sentences max). Be concise and direct."}]
        temp_dir = tempfile.mkdtemp()
        
        while True:
            try:
                data = await websocket.receive_json()
            except Exception:
                # Client disconnected or error receiving
                break
            
            if data.get("type") == "audio":
                try:
                    request_start = time.time()
                    logger.info(f"⏱️ Request started at {request_start}")
                    
                    # Determine extension from MIME (WebM/Opus on Chromium/Firefox, MP4/AAC on Safari)
                    mime = data.get("mime") or "audio/webm"
                    ext = "webm"
                    if "mp4" in mime:
                        ext = "mp4"
                    elif "wav" in mime:
                        ext = "wav"
                    audio_path = os.path.join(temp_dir, f"input_{int(time.time())}.{ext}")
                    audio_data = base64.b64decode(data.get("audio"))
                    
                    # Check if audio data is valid
                    if len(audio_data) < 100:
                        raise ValueError("Audio data too short or empty")
                    
                    with open(audio_path, "wb") as f:
                        f.write(audio_data)
                    
                    # Transcribe with optimized settings
                    stt_start = time.time()
                    logger.info(f"📝 Starting transcription for: {audio_path}")
                    with open(audio_path, "rb") as audio_file:
                        audio_bytes = audio_file.read()
                        if len(audio_bytes) < 100:
                            raise ValueError("Audio file is empty or too short")
                        logger.info(f"Audio received: {len(audio_bytes)} bytes, path={audio_path}")
                        
                        try:
                            # Ensure minimum audio size
                            if len(audio_bytes) < 1000:
                                raise ValueError(f"Audio file too small: {len(audio_bytes)} bytes")
                            
                            transcription = groq_client.audio.transcriptions.create(
                                file=(f"audio.{ext}", audio_bytes),  # Use generic name with extension
                                model="whisper-large-v3-turbo",
                                response_format="text",
                                temperature=0.0,
                                language="en"
                            )
                            stt_time = time.time() - stt_start
                            logger.info(f"✅ Transcription successful in {stt_time:.2f}s")
                        except Exception as trans_err:
                            logger.error(f"❌ Transcription failed: {trans_err}")
                            raise
                    
                    user_text = transcription.strip()
                    logger.info(f"Transcribed: {user_text}")
                    
                    await websocket.send_json({
                        "type": "transcription",
                        "text": user_text
                    })
                    
                    conversation.append({"role": "user", "content": user_text})
                    
                    # Check if query needs web search
                    search_keywords = ["search", "look up", "find", "what is", "who is", "when did", "latest", "current", "news", "today", "weather", "stock", "price"]
                    needs_search = any(keyword in user_text.lower() for keyword in search_keywords)
                    
                    if needs_search and PERPLEXITY_API_KEY:
                        logger.info(f"🔍 Web search detected, using Perplexity")
                        
                        # Send search notification sound to client
                        await websocket.send_json({
                            "type": "search_started",
                            "message": "Searching the web..."
                        })
                        
                        llm_start = time.time()
                        ai_response = await search_web_perplexity(user_text)
                        llm_time = time.time() - llm_start
                        logger.info(f"✅ Web search completed in {llm_time:.2f}s")
                    else:
                        llm_start = time.time()
                        logger.info(f"🤖 Requesting AI response with model: llama-3.1-8b-instant")
                        try:
                            chat_completion = groq_client.chat.completions.create(
                                messages=conversation,
                                model="llama-3.1-8b-instant",
                                temperature=0.7,  # Medium effort
                                max_tokens=150,  # Increased from 100
                                top_p=0.95,
                                stream=False
                            )
                            llm_time = time.time() - llm_start
                            logger.info(f"✅ AI response received in {llm_time:.2f}s")
                        except Exception as ai_err:
                            logger.error(f"❌ AI completion failed: {ai_err}")
                            raise
                        
                        ai_response = chat_completion.choices[0].message.content
                    conversation.append({"role": "assistant", "content": ai_response})
                    
                    # Keep last 10 messages
                    if len(conversation) > 11:
                        conversation = [conversation[0]] + conversation[-10:]
                    
                    logger.info(f"AI: {ai_response}")
                    
                    await websocket.send_json({
                        "type": "response",
                        "text": ai_response
                    })
                    
                    # Generate voice with faster rate
                    tts_start = time.time()
                    audio_output = os.path.join(temp_dir, f"output_{int(time.time())}.mp3")
                    logger.info(f"🔊 Generating TTS audio to: {audio_output}")
                    
                    # Faster speech rate for lower latency
                    communicate = edge_tts.Communicate(ai_response, VOICE, rate="+25%")
                    await communicate.save(audio_output)
                    
                    # Check if file was created
                    if not os.path.exists(audio_output):
                        raise Exception("TTS audio file was not created")
                    
                    file_size = os.path.getsize(audio_output)
                    tts_time = time.time() - tts_start
                    logger.info(f"✅ TTS generated: {file_size} bytes in {tts_time:.2f}s")
                    
                    with open(audio_output, "rb") as f:
                        audio_bytes = f.read()
                        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
                    
                    total_time = time.time() - request_start
                    logger.info(f"📤 Sending audio to client: {len(audio_base64)} base64 chars")
                    logger.info(f"⏱️ TOTAL BACKEND TIME: {total_time:.2f}s (STT: {stt_time:.2f}s, LLM: {llm_time:.2f}s, TTS: {tts_time:.2f}s)")
                    await websocket.send_json({
                        "type": "audio",
                        "audio": audio_base64
                    })
                    logger.info("✅ Audio sent successfully")
                    
                except Exception as e:
                    logger.error(f"❌ Processing error for client {client_id}: {e}")
                    try:
                        await websocket.send_json({
                            "type": "error",
                            "message": str(e)
                        })
                    except:
                        logger.error("Failed to send error message to client")
                        break
                    
    except WebSocketDisconnect:
        logger.info(f"🔌 Client {client_id} disconnected")
    except Exception as e:
        logger.error(f"❌ Client {client_id} error: {e}")
    finally:
        # Cleanup
        import shutil
        if temp_dir and os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except:
                pass
        
        try:
            await websocket.close()
        except:
            pass
        
        logger.info(f"✅ Client {client_id} cleaned up")

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    print("="*60)
    print("🎙️  FREE Groq Voice AI")
    print("="*60)
    print("✅ Model: llama-3.1-8b-instant")
    print("✅ Whisper: whisper-large-v3-turbo")
    print("✅ TTS: Edge TTS (en-US-JennyNeural)")
    print("🌐 Server: http://localhost:8000")
    print("💰 Cost: $0.00")
    print("="*60)
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
