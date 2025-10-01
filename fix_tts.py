# Read app.py
with open('app.py', 'r') as f:
    content = f.read()

# Add better error handling and retry logic for Edge TTS
old_tts = '''                    # Faster speech rate for lower latency
                    communicate = edge_tts.Communicate(ai_response, VOICE, rate="+25%")
                    await communicate.save(audio_output)'''

new_tts = '''                    # Faster speech rate for lower latency
                    # Add retry logic for Edge TTS
                    max_retries = 3
                    for attempt in range(max_retries):
                        try:
                            communicate = edge_tts.Communicate(
                                ai_response, 
                                VOICE, 
                                rate="+25%",
                                proxy=None  # Explicitly disable proxy
                            )
                            await communicate.save(audio_output)
                            break  # Success, exit retry loop
                        except Exception as tts_err:
                            logger.warning(f"TTS attempt {attempt + 1} failed: {tts_err}")
                            if attempt == max_retries - 1:
                                # Last attempt failed, create silent audio as fallback
                                logger.error("All TTS attempts failed, using fallback")
                                # Create a simple beep as fallback
                                import subprocess
                                subprocess.run([
                                    "ffmpeg", "-f", "lavfi", "-i", 
                                    "sine=frequency=800:duration=0.5", 
                                    "-y", audio_output
                                ], capture_output=True)
                            else:
                                await asyncio.sleep(1)  # Wait before retry'''

content = content.replace(old_tts, new_tts)

# Write back
with open('app.py', 'w') as f:
    f.write(content)

print("✅ Added TTS retry logic and fallback")
