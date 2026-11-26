"""Private English-to-Chinese inference using an installed Argos model."""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import ctranslate2
import sentencepiece


class Translator:
    def __init__(self, package):
        metadata = json.loads((package / "metadata.json").read_text(encoding="utf-8"))
        if metadata["from_code"] != "en" or metadata["to_code"] != "zh":
            raise ValueError("Expected an English-to-Chinese Argos package")
        self.prefix = metadata.get("target_prefix", "")
        self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(package / "sentencepiece.model"))
        self.model = ctranslate2.Translator(str(package / "model"), device="cpu", compute_type="int8", intra_threads=2)

    def translate(self, source):
        paragraphs = re.split(r"\n[ \t]*\n+", source.strip())
        chunks = []
        ends = []
        for paragraph in paragraphs:
            normalized = " ".join(paragraph.split())
            for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z\"“])", normalized):
                pieces = self.tokenizer.encode(sentence, out_type=str)
                chunks.extend(pieces[start:start + 160] for start in range(0, len(pieces), 160))
            ends.append(len(chunks))
        prefix = [[self.prefix] for _ in chunks] if self.prefix else None
        batches = self.model.translate_batch(chunks, target_prefix=prefix, beam_size=3,
                                             max_batch_size=512, batch_type="tokens", replace_unknowns=True)
        translated = []
        for batch in batches:
            tokens = batch.hypotheses[0]
            if self.prefix and tokens and tokens[0] == self.prefix:
                tokens = tokens[1:]
            translated.append(self.tokenizer.decode(tokens).strip())
        start = 0
        output = []
        for end in ends:
            output.append("".join(translated[start:end]))
            start = end
        return "\n\n".join(output)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path == "/healthz":
            self.reply(200, {"status": "ready"})
        else:
            self.reply(404, {})

    def do_POST(self):
        if self.path != "/translate":
            self.reply(404, {})
            return
        self.connection.settimeout(5)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 32 * 1024:
                self.reply(413, {})
                return
            request = json.loads(self.rfile.read(size))
            text = request["text"]
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 4200:
                raise ValueError("text")
        except (TypeError, ValueError, KeyError, TimeoutError):
            self.reply(400, {})
            return
        try:
            self.reply(200, {"translation": self.server.translator.translate(text)})
        except (RuntimeError, ValueError):
            self.reply(503, {})


if __name__ == "__main__":
    options = argparse.ArgumentParser()
    options.add_argument("model", type=Path)
    options.add_argument("--port", type=int, default=8094)
    args = options.parse_args()
    translator = Translator(args.model)
    with HTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.translator = translator
        server.serve_forever()
