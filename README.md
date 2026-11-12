# PulmoLens — Explainable AI Pneumonia Detection (Web App)

Flask backend + HTML/Tailwind CSS frontend for the chest X-ray pneumonia
mini project (Custom CNN & DenseNet121 with LIME and SHAP explanations).

## Run

**Windows:** double-click `run_windows.bat`
**Linux / macOS:** `./run_linux_mac.sh`

Or manually:

```bash
python -m venv venv
venv\Scripts\activate          # Windows  (source venv/bin/activate on Linux/macOS)
pip install -r requirements.txt
python app.py
```

Then open **http://127.0.0.1:5000**. Python 3.10–3.12 recommended.

## What the app does

| Section | Content |
|---|---|
| Analyze | Upload/drag-drop an X-ray or pick a sample, choose model (Custom CNN / DenseNet121), threshold (0.50 or Youden 0.763) and explanation detail |
| Explain | LIME superpixel heatmap + top-region outlines, SHAP Partition attribution map, side-by-side view, wipe slider, opacity control, live LIME–SHAP agreement (Spearman ρ, IoU top-20%) |
| Performance | Test metrics, confusion matrix and training curves for both models (from `data/`) |
| Gallery | Figures from the notebook (click to enlarge) |

Explanation detail presets: Fast (LIME 250 samples / SHAP 200 evals), Balanced (500/400),
Detailed (1000/800). On a laptop CPU, Balanced takes roughly 15–45 s.

## Folder layout

```
app.py              Flask routes  (/api/predict, /api/explain/<lime|shap>, /api/agreement, /api/metrics)
xai_engine.py       preprocessing, prediction, LIME, SHAP, agreement metrics
models/             custom_cnn_final.keras, densenet121_final.keras
data/               metrics, training histories, XAI agreement CSVs from the notebook
templates/index.html
static/css/         app.css (animations, components) + tailwind.css (compiled)
static/js/app.js    UI logic and animations
static/vendor/      Chart.js (bundled, works offline)
static/samples/     sample test X-rays
static/plots/       notebook figures for the gallery
tailwind/           Tailwind config, to rebuild tailwind.css after editing classes
```

Tailwind is precompiled, so the app works offline. If you add new Tailwind classes, rebuild:

```bash
npx tailwindcss@3.4.5 -c tailwind/tailwind.config.js -i tailwind/input.css -o static/css/tailwind.css --minify
```

## Implementation notes

- Preprocessing matches training: grayscale → 224×224 → [0,1] → 3 channels.
- LIME uses SLIC superpixels (~60 segments) with black as the hide colour.
- SHAP uses the Partition explainer in log-odds space with a black baseline; in
  probability space the sigmoid saturates near 0/1 and attributions collapse to ~0.

For education and research only, not a medical device.
