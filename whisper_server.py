from flask import Flask, request, jsonify
import whisper
import os
import tempfile
from pydub import AudioSegment

app = Flask(__name__)

# Whisperモデルをロードします。
print("Loading Whisper 'medium' model... (This may take a moment)")
try:
    model = whisper.load_model("medium")  # largeからmediumに戻す
    print("Whisper 'medium' model loaded successfully.")
except Exception as e:
    print(f"Error loading Whisper model: {e}")
    exit()

def preprocess_audio(audio_path: str) -> str:
    """音声の前処理を行い、文字起こし精度を向上させます"""
    try:
        # 音声をロード
        audio = AudioSegment.from_file(audio_path, format="wav")
        
        # 音量を正規化（-20dBFSに調整）
        target_dBFS = -20
        change_in_dBFS = target_dBFS - audio.dBFS
        audio = audio.apply_gain(change_in_dBFS)
        
        # 処理済み音声を保存
        processed_path = audio_path.replace('.wav', '_processed.wav')
        audio.export(processed_path, format="wav")
        
        return processed_path
    except Exception as e:
        print(f"Audio preprocessing failed: {e}")
        return audio_path

def is_quality_transcription(text: str) -> bool:
    """文字起こし結果の品質をチェックします"""
    if not text or len(text.strip()) == 0:
        return False
    
    # よくある不適切な定型文をチェック
    inappropriate_phrases = [
        "ご視聴ありがとうございました",
        "ありがとうございました",
        "お疲れ様でした",
        "失礼いたします",
        "よろしくお願いいたします"
    ]
    
    text_lower = text.lower()
    for phrase in inappropriate_phrases:
        if phrase in text_lower and len(text.strip()) <= len(phrase) + 5:
            return False
    
    # 短すぎる結果（1文字以下）は除外
    if len(text.strip()) <= 1:
        return False
    
    # 同じ文字の繰り返しが多い場合は除外
    if len(set(text)) <= 2 and len(text) > 3:
        return False
    
    return True

@app.route('/transcribe', methods=['POST'])
def transcribe_audio():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']

    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    temp_path = None
    processed_path = None
    try:
        # 一時ファイルに安全に保存
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_fp:
            file.save(temp_fp.name)
            temp_path = temp_fp.name
        
        # pydubを使って音声ファイルをロード
        audio = AudioSegment.from_file(temp_path, format="wav")

        # 音声の詳細情報をログ出力
        print(f"Audio info for {os.path.basename(temp_path)}: duration={len(audio)}ms, dBFS={audio.dBFS:.2f}, max_dBFS={audio.max_dBFS:.2f}")

        # ファイルサイズもチェック
        file_size = os.path.getsize(temp_path)
        print(f"File size: {file_size} bytes")

        # 音声が短すぎるか、ほぼ無音かチェック
        if len(audio) < 1000 or audio.dBFS < -60 or file_size < 4096:  # より厳しい条件に変更
            print(f"Skipping transcription for {os.path.basename(temp_path)}: audio too short/silent/small (duration: {len(audio)}ms, dBFS: {audio.dBFS:.2f}, size: {file_size} bytes)")
            return jsonify({"text": ""})
        
        # 音声の最大音量もチェック
        if audio.max_dBFS < -50:
            print(f"Skipping transcription for {os.path.basename(temp_path)}: audio too quiet (max_dBFS: {audio.max_dBFS:.2f})")
            return jsonify({"text": ""})

        # 音声の前処理
        processed_path = preprocess_audio(temp_path)
        
        # Whisperで文字起こしを実行
        result = model.transcribe(
            processed_path, 
            language="ja", 
            fp16=False,
            condition_on_previous_text=False,
            temperature=0.2,
            initial_prompt="",
            # より自然な結果のための設定
            compression_ratio_threshold=2.4,
            logprob_threshold=-1.0,
            no_speech_threshold=0.6
        )
        print(f"Transcription successful for {os.path.basename(temp_path)}: {result['text']}")
        if not is_quality_transcription(result['text']):
            return jsonify({"text": ""})
        return jsonify({"text": result["text"]})
    except Exception as whisper_e:
        print(f"Whisper model inference error: {whisper_e}. Returning empty text.")
        return jsonify({"text": ""})
    except Exception as e:
        print(f"Error during transcription process: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        # 一時ファイルを削除
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        if processed_path and os.path.exists(processed_path) and processed_path != temp_path:
            os.remove(processed_path)

if __name__ == '__main__':
    print("Starting Flask server...")
    app.run(host='0.0.0.0', port=5000, debug=True) 