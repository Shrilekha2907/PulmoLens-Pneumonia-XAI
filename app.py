"""
PulmoLens — Explainable AI Pneumonia Detection (Flask backend)
Run:  python app.py   ->  http://127.0.0.1:5000
"""
import os
import csv
import json
import time
import uuid
import threading
from collections import OrderedDict

from flask import Flask, jsonify, render_template, request

import xai_engine as xe

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
ALLOWED = {"png", "jpg", "jpeg", "bmp", "webp", "tif", "tiff"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

# --------------------------------------------------------------- session cache
_cache = OrderedDict()          # id -> {"x", "model", "lime_map", "shap_map", ...}
_cache_lock = threading.Lock()
MAX_CACHE = 30


def cache_put(item):
    sid = uuid.uuid4().hex[:12]
    with _cache_lock:
        _cache[sid] = item
        while len(_cache) > MAX_CACHE:
            _cache.popitem(last=False)
    return sid


def cache_get(sid):
    with _cache_lock:
        return _cache.get(sid)


# --------------------------------------------------------------- project data
def load_json(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)


def load_csv(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return list(csv.DictReader(f))


SUMMARY = load_json("project_summary.json")
YOUDEN = round(SUMMARY.get("youden_threshold_val", 0.763), 3)


def build_metrics():
    rows = load_csv("metrics_all_splits.csv")
    out = {}
    for r in rows:
        m = r["Model"]
        out.setdefault(m, {})[r["Split"]] = {
            k: (float(v) if k not in ("Model", "Split") else v) for k, v in r.items()
        }
    hist = load_json("training_histories.json")
    curves = {
        m: {k: h[k] for k in ("accuracy", "val_accuracy", "loss", "val_loss", "auc", "val_auc") if k in h}
        for m, h in hist.items()
    }
    return {
        "best_model": SUMMARY.get("best_model"),
        "splits": SUMMARY.get("split_images"),
        "metrics": out,
        "curves": curves,
        "youden": YOUDEN,
        "xai": {
            "spearman": SUMMARY.get("lime_shap_mean_spearman"),
            "iou": SUMMARY.get("lime_shap_mean_iou_top20"),
            "agreement": load_csv("lime_shap_agreement.csv"),
            "stability": load_csv("explanation_stability.csv"),
        },
        "dataset": load_json("data_validation_report.json"),
        "split_summary": load_csv("split_summary.csv"),
    }


METRICS = build_metrics()


# --------------------------------------------------------------- routes
@app.route("/")
def index():
    return render_template("index.html", youden=YOUDEN)


@app.get("/api/metrics")
def api_metrics():
    return jsonify(METRICS)


@app.post("/api/predict")
def api_predict():
    f = request.files.get("image")
    if not f or not f.filename:
        return jsonify(error="No image uploaded."), 400
    ext = f.filename.rsplit(".", 1)[-1].lower()
    if ext not in ALLOWED:
        return jsonify(error=f"Unsupported file type .{ext}"), 400

    model_key = request.form.get("model", "custom_cnn")
    threshold = YOUDEN if request.form.get("threshold") == "youden" else 0.5
    try:
        x = xe.preprocess(f.read())
    except Exception:
        return jsonify(error="Could not read that image."), 400

    t0 = time.time()
    res = xe.predict(model_key, x, threshold)
    res["latency_ms"] = round((time.time() - t0) * 1000)
    sid = cache_put({"x": x, "model": model_key})
    res.update(id=sid, image=xe.image_b64(x))
    return jsonify(res)


@app.post("/api/explain/<method>")
def api_explain(method):
    body = request.get_json(silent=True) or {}
    item = cache_get(body.get("id", ""))
    if item is None:
        return jsonify(error="Session expired — please upload the image again."), 404
    preset = body.get("preset", "balanced")

    t0 = time.time()
    if method == "lime":
        res = xe.explain_lime(item["model"], item["x"], preset)
    elif method == "shap":
        res = xe.explain_shap(item["model"], item["x"], preset)
    else:
        return jsonify(error="Unknown method"), 400
    item[f"{method}_map"] = res.pop("_map")
    res["seconds"] = round(time.time() - t0, 1)
    return jsonify(res)


@app.get("/api/agreement/<sid>")
def api_agreement(sid):
    item = cache_get(sid)
    if not item or "lime_map" not in item or "shap_map" not in item:
        return jsonify(error="Both explanations are needed first."), 400
    return jsonify(xe.agreement(item["lime_map"], item["shap_map"]))


@app.errorhandler(Exception)
def on_error(e):
    app.logger.exception(e)
    return jsonify(error=f"Server error: {e}"), 500


@app.errorhandler(413)
def too_big(_):
    return jsonify(error="File is larger than 16 MB."), 413


if __name__ == "__main__":
    print("Loading models ...")
    xe.get_model("custom_cnn")
    print("Ready ->  http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
