"""
XAI engine: model loading, preprocessing, prediction, LIME and SHAP explanations.
Preprocessing mirrors the training notebook: grayscale -> 224x224 -> [0,1] -> 3 channels.
"""
import os
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")

import io
import base64
import threading

import numpy as np
from PIL import Image
import keras
import matplotlib
matplotlib.use("Agg")
from matplotlib import colormaps
from scipy.stats import spearmanr
from skimage.segmentation import slic, mark_boundaries
from lime import lime_image
import shap

IMG_SIZE = 224
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")

MODEL_FILES = {
    "custom_cnn": ("Custom CNN", "custom_cnn_final.keras"),
    "densenet121": ("DenseNet121", "densenet121_final.keras"),
}

# Explanation quality presets: (LIME samples, SHAP max evals)
PRESETS = {
    "fast": (250, 200),
    "balanced": (500, 400),
    "detailed": (1000, 800),
}

_models = {}
_model_lock = threading.Lock()


def get_model(key):
    if key not in MODEL_FILES:
        key = "custom_cnn"
    with _model_lock:
        if key not in _models:
            path = os.path.join(MODEL_DIR, MODEL_FILES[key][1])
            _models[key] = keras.models.load_model(path, compile=False)
        return _models[key]


def predict_batch(model, batch):
    """Return P(pneumonia) for a batch of (n,224,224,3) float images in [0,1]."""
    batch = np.asarray(batch, dtype=np.float32)
    out = []
    for i in range(0, len(batch), 32):
        out.append(model(batch[i:i + 32], training=False).numpy().reshape(-1))
    return np.concatenate(out)


# ------------------------------------------------------------------ images
def preprocess(file_bytes):
    img = Image.open(io.BytesIO(file_bytes)).convert("L")
    img = img.resize((IMG_SIZE, IMG_SIZE), Image.BILINEAR)
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return np.repeat(arr[..., None], 3, axis=-1)


def to_b64_png(arr):
    """arr: uint8 HxW, HxWx3 or HxWx4."""
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def image_b64(x):
    return to_b64_png((np.clip(x, 0, 1) * 255).astype(np.uint8))


# ------------------------------------------------------------------ predict
def predict(model_key, x, threshold=0.5):
    model = get_model(model_key)
    p = float(predict_batch(model, x[None])[0])
    label = "PNEUMONIA" if p >= threshold else "NORMAL"
    conf = p if label == "PNEUMONIA" else 1 - p
    return {
        "probability": p,
        "label": label,
        "confidence": conf,
        "threshold": threshold,
        "model": MODEL_FILES.get(model_key, MODEL_FILES["custom_cnn"])[0],
    }


# ------------------------------------------------------------------ LIME
def explain_lime(model_key, x, preset="balanced", seed=42):
    model = get_model(model_key)
    n_samples = PRESETS.get(preset, PRESETS["balanced"])[0]

    def classifier_fn(imgs):
        p = predict_batch(model, imgs)
        return np.stack([1 - p, p], axis=1)

    def seg_fn(img):
        return slic(img, n_segments=60, compactness=10, sigma=1, start_label=0, channel_axis=-1)

    explainer = lime_image.LimeImageExplainer(random_state=seed)
    exp = explainer.explain_instance(
        x.astype(np.double), classifier_fn, labels=(1,), hide_color=0,
        num_samples=n_samples, segmentation_fn=seg_fn, random_seed=seed,
    )
    segments = exp.segments
    weights = dict(exp.local_exp[1])

    # per-pixel weight map
    wmap = np.zeros(segments.shape, dtype=np.float32)
    for seg_id, w in weights.items():
        wmap[segments == seg_id] = w

    vmax = max(abs(wmap).max(), 1e-8)
    # RGBA overlay: teal-green = supports pneumonia, rose = supports normal
    rgba = np.zeros((*wmap.shape, 4), dtype=np.uint8)
    pos = wmap > 0
    neg = wmap < 0
    rgba[pos, :3] = (16, 185, 129)
    rgba[neg, :3] = (244, 63, 94)
    rgba[..., 3] = (np.clip(abs(wmap) / vmax, 0, 1) ** 0.8 * 210).astype(np.uint8)

    # boundary composite of top positive superpixels
    top = sorted([k for k, v in weights.items() if v > 0], key=lambda k: -weights[k])[:6]
    mask = np.isin(segments, top)
    bound = mark_boundaries(x, mask.astype(int), color=(0.2, 0.95, 0.75), mode="thick")

    top_list = sorted(weights.items(), key=lambda kv: -abs(kv[1]))[:8]
    return {
        "overlay": to_b64_png(rgba),
        "boundaries": image_b64(bound),
        "top_segments": [{"id": int(k), "weight": float(v)} for k, v in top_list],
        "n_segments": int(segments.max() + 1),
        "n_samples": n_samples,
        "score": float(exp.score),
        "_map": wmap,
    }


# ------------------------------------------------------------------ SHAP
def explain_shap(model_key, x, preset="balanced"):
    model = get_model(model_key)
    max_evals = PRESETS.get(preset, PRESETS["balanced"])[1]

    # Explain in log-odds space: the sigmoid saturates near 0/1, which would squash
    # every attribution to ~0. Hidden regions are set to black, same as LIME.
    def f(imgs):
        p = np.clip(predict_batch(model, imgs), 1e-7, 1 - 1e-7)
        return np.log(p / (1 - p)).reshape(-1, 1)

    masker = shap.maskers.Image(np.zeros(x.shape, dtype=np.float32), x.shape)
    explainer = shap.Explainer(f, masker, output_names=["PNEUMONIA"])
    sv = explainer(x[None], max_evals=max_evals, batch_size=50, silent=True)
    vals = np.asarray(sv.values)[0]          # (224,224,3,1)
    smap = vals.reshape(IMG_SIZE, IMG_SIZE, -1).sum(axis=-1).astype(np.float32)

    vmax = max(np.percentile(abs(smap), 99.5), 1e-8)
    norm = np.clip(smap / vmax, -1, 1)
    cmap = colormaps["RdBu_r"]
    rgba = (cmap((norm + 1) / 2) * 255).astype(np.uint8)
    rgba[..., 3] = (np.abs(norm) ** 0.7 * 220).astype(np.uint8)

    base_logit = float(np.asarray(sv.base_values).reshape(-1)[0])
    return {
        "overlay": to_b64_png(rgba),
        "base_value": float(1 / (1 + np.exp(-base_logit))),
        "base_logit": base_logit,
        "out_logit": base_logit + float(smap.sum()),
        "positive_mass": float(smap[smap > 0].sum()),
        "negative_mass": float(smap[smap < 0].sum()),
        "max_evals": max_evals,
        "_map": smap,
    }


# ------------------------------------------------------------------ agreement
def agreement(lime_map, shap_map, top_frac=0.2):
    a, b = lime_map.ravel(), shap_map.ravel()
    rho = spearmanr(a, b).correlation
    k = int(len(a) * top_frac)
    ta = set(np.argsort(-a)[:k]); tb = set(np.argsort(-b)[:k])
    iou = len(ta & tb) / max(len(ta | tb), 1)
    return {
        "spearman": float(0.0 if np.isnan(rho) else rho),
        "iou_top20": float(iou),
    }
